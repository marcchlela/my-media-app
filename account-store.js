const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { resolveAdminEmails, resolveDataDirectory } = require('./env-config');

const WATCH_COMPLETE_THRESHOLD_PERCENT = 92;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const APP_NAME = 'my-media-app';
const LEGACY_DATA_DIR = path.join(__dirname, '.data');
const LEGACY_DB_PATH = path.join(LEGACY_DATA_DIR, 'my-media-app.sqlite');
const PREFERRED_DATA_DIR = resolveDataDir();

let dbInstance = null;
let activeDbPath = path.join(PREFERRED_DATA_DIR, 'my-media-app.sqlite');
const configuredAdminEmails = new Set(resolveAdminEmails());

function getTableColumns(database, tableName) {
  try {
    return database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  } catch (err) {
    return [];
  }
}

function hasAdminColumn(database) {
  return getTableColumns(database, 'users').includes('is_admin');
}

function resolveDataDir() {
  const configured = resolveDataDirectory();
  if (configured) return path.resolve(configured);

  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, APP_NAME);
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) {
    return path.join(home, 'AppData', 'Roaming', APP_NAME);
  }

  return LEGACY_DATA_DIR;
}

function copyRows(sourceDbPath, targetDb) {
  if (!fs.existsSync(sourceDbPath)) return;

  const source = new DatabaseSync(sourceDbPath);
  try {
    const userColumns = new Set(getTableColumns(source, 'users'));
    const users = source.prepare(`
      SELECT id, first_name, last_name, email, password_salt, password_hash, created_at, updated_at${userColumns.has('is_admin') ? ', is_admin' : ''}
      FROM users
    `).all();
    const sessions = source.prepare(`
      SELECT token, user_id, created_at, last_seen_at
      FROM sessions
    `).all();
    const watchProgress = source.prepare(`
      SELECT user_id, media_path, media_name, is_show, position, duration, percent, completed, updated_at
      FROM watch_progress
    `).all();
    const posterOverrideColumns = new Set(getTableColumns(source, 'poster_overrides'));
    const posterOverrides = posterOverrideColumns.size
      ? source.prepare(`
        SELECT user_id, media_key, local_path, tmdb_path, updated_at
        FROM poster_overrides
      `).all()
      : [];
    const favoriteColumns = new Set(getTableColumns(source, 'favorites'));
    const favorites = favoriteColumns.size
      ? source.prepare(`
        SELECT user_id, media_key, media_path, media_name, is_show, updated_at
        FROM favorites
      `).all()
      : [];

    for (const row of users) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO users (
          id, first_name, last_name, email, password_salt, password_hash, is_admin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.first_name,
        row.last_name,
        row.email,
        row.password_salt,
        row.password_hash,
        row.is_admin ? 1 : 0,
        row.created_at,
        row.updated_at
      );
    }

    for (const row of sessions) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO sessions (token, user_id, created_at, last_seen_at)
        VALUES (?, ?, ?, ?)
      `).run(
        row.token,
        row.user_id,
        row.created_at,
        row.last_seen_at
      );
    }

    for (const row of watchProgress) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO watch_progress (
          user_id, media_path, media_name, is_show, position, duration, percent, completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.user_id,
        row.media_path,
        row.media_name,
        row.is_show,
        row.position,
        row.duration,
        row.percent,
        row.completed,
        row.updated_at
      );
    }

    for (const row of posterOverrides) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO poster_overrides (
          user_id, media_key, local_path, tmdb_path, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        row.user_id,
        row.media_key,
        row.local_path,
        row.tmdb_path,
        row.updated_at
      );
    }

    for (const row of favorites) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO favorites (
          user_id, media_key, media_path, media_name, is_show, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        row.user_id,
        row.media_key,
        row.media_path,
        row.media_name,
        row.is_show,
        row.updated_at
      );
    }
  } catch (err) {
    // Ignore migration problems and keep using the new DB.
  } finally {
    source.close();
  }
}

function maybeMigrateLegacyDatabase(targetDb, targetDbPath) {
  if (targetDbPath === LEGACY_DB_PATH) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  copyRows(LEGACY_DB_PATH, targetDb);
}

function ensureDatabase() {
  if (dbInstance) return dbInstance;

  const candidateDirs = [PREFERRED_DATA_DIR, LEGACY_DATA_DIR];
  let db = null;

  for (const dir of candidateDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const candidatePath = path.join(dir, 'my-media-app.sqlite');
      db = new DatabaseSync(candidatePath);
      activeDbPath = candidatePath;
      break;
    } catch (err) {
      db = null;
    }
  }

  if (!db) {
    throw new Error('Unable to open account database.');
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      user_id INTEGER NOT NULL,
      media_path TEXT NOT NULL,
      media_name TEXT,
      is_show INTEGER NOT NULL DEFAULT 0,
      position REAL NOT NULL,
      duration REAL NOT NULL,
      percent REAL NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_path),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS poster_overrides (
      user_id INTEGER NOT NULL,
      media_key TEXT NOT NULL,
      local_path TEXT,
      tmdb_path TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      media_key TEXT NOT NULL,
      media_path TEXT,
      media_name TEXT,
      is_show INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;');
  } catch (err) {
    // Column already exists on current databases.
  }

  try {
    db.exec('ALTER TABLE sessions ADD COLUMN expires_at INTEGER;');
  } catch (err) {
    // Column already exists on current databases.
  }
  db.prepare('UPDATE sessions SET expires_at = created_at + ? WHERE expires_at IS NULL')
    .run(SESSION_MAX_AGE_MS);

  maybeMigrateLegacyDatabase(db, activeDbPath);
  ensureAdminBootstrap(db);

  dbInstance = db;
  return dbInstance;
}

function ensureAdminBootstrap(db) {
  if (!hasAdminColumn(db)) return;
  if (configuredAdminEmails.size) {
    const placeholders = Array.from(configuredAdminEmails).map(() => '?').join(', ');
    db.prepare(`UPDATE users SET is_admin = 1, updated_at = ? WHERE lower(email) IN (${placeholders})`)
      .run(Date.now(), ...Array.from(configuredAdminEmails));
  }

}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };
}

function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const hashHex = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), 64).toString('hex');
  return { saltHex, hashHex };
}

function verifyPassword(password, saltHex, expectedHashHex) {
  try {
    const actual = Buffer.from(hashPassword(password, saltHex).hashHex, 'hex');
    const expected = Buffer.from(String(expectedHashHex || ''), 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (err) {
    return false;
  }
}

function createSessionToken(userId) {
  const db = ensureDatabase();
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, now, now, now + SESSION_MAX_AGE_MS);
  return token;
}

function touchSessionToken(token) {
  if (!token) return;
  const db = ensureDatabase();
  const now = Date.now();
  db.prepare(`
    UPDATE sessions
    SET last_seen_at = ?
    WHERE token = ? AND last_seen_at < ? AND expires_at > ?
  `).run(now, token, now - SESSION_TOUCH_INTERVAL_MS, now);
}

function deleteSessionToken(token) {
  if (!token) return;
  const db = ensureDatabase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserBySessionToken(token) {
  if (!token) return null;
  const db = ensureDatabase();
  const adminSelect = hasAdminColumn(db) ? 'users.is_admin' : '0 AS is_admin';
  const now = Date.now();
  const row = db.prepare(`
    SELECT
      users.id,
      users.first_name,
      users.last_name,
      users.email,
      ${adminSelect},
      users.created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
      AND sessions.expires_at > ?
      AND sessions.last_seen_at > ?
  `).get(token, now, now - SESSION_IDLE_TIMEOUT_MS);
  if (!row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return publicUser(row);
}

function pruneExpiredSessions() {
  const db = ensureDatabase();
  const now = Date.now();
  return Number(db.prepare(`
    DELETE FROM sessions
    WHERE expires_at <= ? OR last_seen_at <= ?
  `).run(now, now - SESSION_IDLE_TIMEOUT_MS).changes || 0);
}

function validateSignupInput(input) {
  const fieldErrors = {};
  const firstName = String(input?.firstName || '').trim();
  const lastName = String(input?.lastName || '').trim();
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || '');
  const confirmPassword = String(input?.confirmPassword || '');

  if (!firstName) fieldErrors.firstName = 'First name is required.';
  if (!lastName) fieldErrors.lastName = 'Last name is required.';
  if (!email) fieldErrors.email = 'Email is required.';
  if (!password) fieldErrors.password = 'Password is required.';
  if (!confirmPassword) fieldErrors.confirmPassword = 'Confirm password is required.';

  if (email && !isValidEmail(email)) {
    fieldErrors.email = 'Enter a valid email address.';
  }
  if (password && password.length < 10) {
    fieldErrors.password = 'Password must be at least 10 characters.';
  }
  if (password && confirmPassword && password !== confirmPassword) {
    fieldErrors.confirmPassword = 'Passwords do not match.';
  }

  return {
    firstName,
    lastName,
    email,
    password,
    confirmPassword,
    fieldErrors,
  };
}

function createUserAccount(input) {
  const db = ensureDatabase();
  const parsed = validateSignupInput(input);
  if (Object.keys(parsed.fieldErrors).length) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.email);
  if (existing) {
    return {
      ok: false,
      fieldErrors: {
        email: 'An account with this email already exists.',
      },
    };
  }

  const now = Date.now();
  const { saltHex, hashHex } = hashPassword(parsed.password);
  const canUseAdminColumn = hasAdminColumn(db);
  const isConfiguredAdmin = configuredAdminEmails.has(parsed.email);
  const isAdmin = isConfiguredAdmin ? 1 : 0;
  const result = canUseAdminColumn
    ? db.prepare(`
      INSERT INTO users (first_name, last_name, email, password_salt, password_hash, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(parsed.firstName, parsed.lastName, parsed.email, saltHex, hashHex, isAdmin, now, now)
    : db.prepare(`
      INSERT INTO users (first_name, last_name, email, password_salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(parsed.firstName, parsed.lastName, parsed.email, saltHex, hashHex, now, now);

  const userId = Number(result.lastInsertRowid);
  const token = createSessionToken(userId);
  const user = getUserBySessionToken(token);
  return { ok: true, user, sessionToken: token };
}

function validateLoginInput(input) {
  const fieldErrors = {};
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || '');

  if (!email) fieldErrors.email = 'Email is required.';
  if (!password) fieldErrors.password = 'Password is required.';

  return { email, password, fieldErrors };
}

function loginUserAccount(input) {
  const db = ensureDatabase();
  const parsed = validateLoginInput(input);
  if (Object.keys(parsed.fieldErrors).length) {
    return { ok: false, fieldErrors: parsed.fieldErrors };
  }

  const adminSelect = hasAdminColumn(db) ? 'is_admin' : '0 AS is_admin';
  const row = db.prepare(`
    SELECT id, first_name, last_name, email, password_salt, password_hash, ${adminSelect}, created_at
    FROM users
    WHERE email = ?
  `).get(parsed.email);

  if (!row || !verifyPassword(parsed.password, row.password_salt, row.password_hash)) {
    return { ok: false, authError: 'Invalid email or password.' };
  }

  const token = createSessionToken(row.id);
  const user = getUserBySessionToken(token);
  return { ok: true, user, sessionToken: token };
}

function updateUserProfile(userId, input) {
  const firstName = String(input?.firstName || '').trim();
  const lastName = String(input?.lastName || '').trim();
  const fieldErrors = {};
  if (!firstName) fieldErrors.firstName = 'First name is required.';
  if (!lastName) fieldErrors.lastName = 'Last name is required.';
  if (firstName.length > 80) fieldErrors.firstName = 'First name is too long.';
  if (lastName.length > 80) fieldErrors.lastName = 'Last name is too long.';
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const db = ensureDatabase();
  const result = db.prepare(`
    UPDATE users SET first_name = ?, last_name = ?, updated_at = ? WHERE id = ?
  `).run(firstName, lastName, Date.now(), userId);
  if (!result.changes) return { ok: false, error: 'Account was not found.' };
  const adminSelect = hasAdminColumn(db) ? 'is_admin' : '0 AS is_admin';
  const row = db.prepare(`
    SELECT id, first_name, last_name, email, ${adminSelect}, created_at FROM users WHERE id = ?
  `).get(userId);
  return { ok: true, user: publicUser(row) };
}

function changeUserPassword(userId, input, currentSessionToken = '') {
  const currentPassword = String(input?.currentPassword || '');
  const newPassword = String(input?.newPassword || '');
  const confirmPassword = String(input?.confirmPassword || '');
  const fieldErrors = {};
  if (!currentPassword) fieldErrors.currentPassword = 'Current password is required.';
  if (!newPassword) fieldErrors.newPassword = 'New password is required.';
  if (!confirmPassword) fieldErrors.confirmPassword = 'Confirm password is required.';
  if (newPassword && newPassword.length < 10) fieldErrors.newPassword = 'Password must be at least 10 characters.';
  if (newPassword && confirmPassword && newPassword !== confirmPassword) fieldErrors.confirmPassword = 'Passwords do not match.';
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const db = ensureDatabase();
  const user = db.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
    return { ok: false, fieldErrors: { currentPassword: 'Current password is incorrect.' } };
  }
  if (verifyPassword(newPassword, user.password_salt, user.password_hash)) {
    return { ok: false, fieldErrors: { newPassword: 'Choose a password you have not already been using.' } };
  }

  const { saltHex, hashHex } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(saltHex, hashHex, Date.now(), userId);
  if (currentSessionToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, currentSessionToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  return { ok: true };
}

function normalizeWatchProgress(input) {
  const duration = Number(input?.duration);
  const position = Number(input?.position);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const safePosition = Math.max(0, Math.min(Number.isFinite(position) ? position : 0, duration));
  const derivedPercent = (safePosition / duration) * 100;
  let percent = Number.isFinite(Number(input?.percent))
    ? Math.max(0, Math.min(100, Number(input.percent)))
    : derivedPercent;

  if (
    input?.completed
    || safePosition >= Math.max(duration - 2, 0)
    || percent >= WATCH_COMPLETE_THRESHOLD_PERCENT
  ) {
    percent = 100;
  }

  return {
    position: safePosition,
    duration,
    percent,
    completed: percent >= 100 ? 1 : 0,
    updatedAt: Number.isFinite(Number(input?.updatedAt)) ? Number(input.updatedAt) : Date.now(),
  };
}

function normalizeMediaKeyPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .replace(/[^\w\s:]/g, '')
    .trim();
}

function buildPosterOverrideKey(input) {
  if (input?.isShow) {
    const tmdbId = Number.parseInt(String(input?.tmdbId ?? input?.showTmdbId ?? ''), 10);
    if (tmdbId > 0) {
      return `show:tmdb:${tmdbId}`;
    }

    const showKey = String(
      input?.showKey
      || input?.mediaKey
      || input?.mediaPath
      || input?.mediaName
      || ''
    ).trim();
    if (!showKey) return '';
    return `show:${normalizeMediaKeyPart(showKey)}`;
  }

  const mediaPath = String(input?.mediaPath || input?.path || '').trim();
  if (!mediaPath) return '';
  return `movie:${mediaPath}`;
}

function buildFavoriteKey(input) {
  if (input?.isShow) {
    const tmdbId = Number.parseInt(String(input?.tmdbId ?? input?.showTmdbId ?? ''), 10);
    if (tmdbId > 0) {
      return `show:tmdb:${tmdbId}`;
    }

    const showKey = String(
      input?.showKey
      || input?.mediaKey
      || input?.mediaPath
      || input?.mediaName
      || ''
    ).trim();
    if (!showKey) return '';
    return `show:${normalizeMediaKeyPart(showKey)}`;
  }

  const mediaPath = String(input?.mediaPath || input?.path || '').trim();
  if (!mediaPath) return '';
  return `movie:${mediaPath}`;
}

function upsertWatchProgress(userId, input) {
  const db = ensureDatabase();
  const mediaPath = String(input?.mediaPath || '').trim();
  if (!userId || !mediaPath) return null;

  const progress = normalizeWatchProgress(input);
  if (!progress) return null;

  db.prepare(`
    INSERT INTO watch_progress (
      user_id,
      media_path,
      media_name,
      is_show,
      position,
      duration,
      percent,
      completed,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_path) DO UPDATE SET
      media_name = excluded.media_name,
      is_show = excluded.is_show,
      position = excluded.position,
      duration = excluded.duration,
      percent = excluded.percent,
      completed = excluded.completed,
      updated_at = excluded.updated_at
  `).run(
    userId,
    mediaPath,
    input?.mediaName ? String(input.mediaName) : null,
    input?.isShow ? 1 : 0,
    progress.position,
    progress.duration,
    progress.percent,
    progress.completed,
    progress.updatedAt
  );

  return {
    position: progress.position,
    duration: progress.duration,
    percent: progress.percent,
    updatedAt: progress.updatedAt,
  };
}

function getWatchProgressMapForUser(userId) {
  const db = ensureDatabase();
  const map = new Map();
  if (!userId) return map;

  const rows = db.prepare(`
    SELECT media_path, position, duration, percent, updated_at
    FROM watch_progress
    WHERE user_id = ?
  `).all(userId);

  for (const row of rows) {
    map.set(row.media_path, {
      position: row.position,
      duration: row.duration,
      percent: row.percent,
      updatedAt: row.updated_at,
    });
  }
  return map;
}

function pickLatestWatchProgress(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  const existingUpdatedAt = Number(existing?.updatedAt) || 0;
  const incomingUpdatedAt = Number(incoming?.updatedAt) || 0;
  return incomingUpdatedAt >= existingUpdatedAt ? incoming : existing;
}

function mergeWatchProgressIntoLibrary(items, progressMap) {
  const input = Array.isArray(items) ? items : [];
  return input.map((item) => {
    const synced = item?.path ? progressMap?.get(item.path) : null;
    const watchProgress = pickLatestWatchProgress(item?.watchProgress, synced);
    if (!watchProgress) return item;
    return { ...item, watchProgress };
  });
}

function mergeWatchProgressForUser(items, userId) {
  return mergeWatchProgressIntoLibrary(items, getWatchProgressMapForUser(userId));
}

function getPosterOverrideMapForUser(userId) {
  const db = ensureDatabase();
  const map = new Map();
  if (!userId) return map;

  const rows = db.prepare(`
    SELECT media_key, local_path, tmdb_path, updated_at
    FROM poster_overrides
    WHERE user_id = ?
  `).all(userId);

  for (const row of rows) {
    map.set(row.media_key, {
      localPath: row.local_path || '',
      tmdbPath: row.tmdb_path || '',
      updatedAt: Number(row.updated_at) || 0,
    });
  }
  return map;
}

function applyPosterOverrideToItem(item, override) {
  if (!item || !override) return item;
  const next = { ...item };

  if (override.localPath) {
    next.customPosterPath = override.localPath;
  } else {
    delete next.customPosterPath;
  }

  if (override.tmdbPath) {
    next.customPosterTmdbPath = override.tmdbPath;
    if (Object.prototype.hasOwnProperty.call(next, 'posterPath')) {
      next.posterPath = override.tmdbPath;
    }
  } else {
    delete next.customPosterTmdbPath;
  }

  return next;
}

function mergePosterOverridesIntoLibrary(items, overrideMap) {
  const input = Array.isArray(items) ? items : [];
  return input.map((item) => {
    const mediaKey = buildPosterOverrideKey({
      isShow: !!item?.isShow,
      showKey: item?.showKey,
      tmdbId: item?.tmdbId ?? item?.data?.id,
      mediaPath: item?.path,
      mediaName: item?.showName || item?.title || item?.name,
    });
    const override = overrideMap.get(mediaKey);
    if (!override) {
      if (!item?.customPosterPath && !item?.customPosterTmdbPath) return item;
      const next = { ...item };
      delete next.customPosterPath;
      delete next.customPosterTmdbPath;
      return next;
    }
    return applyPosterOverrideToItem(item, override);
  });
}

function mergePosterOverridesForUser(items, userId) {
  return mergePosterOverridesIntoLibrary(items, getPosterOverrideMapForUser(userId));
}

function getFavoriteKeyMapForUser(userId) {
  const db = ensureDatabase();
  const map = new Map();
  if (!userId) return map;

  const rows = db.prepare(`
    SELECT media_key, media_path, media_name, is_show, updated_at
    FROM favorites
    WHERE user_id = ?
  `).all(userId);

  for (const row of rows) {
    map.set(row.media_key, {
      mediaPath: row.media_path || '',
      mediaName: row.media_name || '',
      isShow: !!row.is_show,
      updatedAt: Number(row.updated_at) || 0,
    });
  }
  return map;
}

function mergeFavoritesIntoLibrary(items, favoriteMap) {
  const input = Array.isArray(items) ? items : [];
  return input.map((item) => {
    const mediaKey = buildFavoriteKey({
      isShow: !!item?.isShow,
      showKey: item?.showKey,
      tmdbId: item?.tmdbId ?? item?.data?.id,
      mediaPath: item?.path,
      mediaName: item?.showName || item?.title || item?.name,
    });
    const isFavorite = favoriteMap.has(mediaKey);
    if (!!item?.isFavorite === isFavorite) return item;
    const next = { ...item };
    if (isFavorite) {
      next.isFavorite = true;
    } else {
      delete next.isFavorite;
    }
    return next;
  });
}

function mergeFavoritesForUser(items, userId) {
  return mergeFavoritesIntoLibrary(items, getFavoriteKeyMapForUser(userId));
}

function addFavoriteForUser(userId, input) {
  const db = ensureDatabase();
  const mediaKey = buildFavoriteKey(input);
  if (!userId || !mediaKey) return null;

  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO favorites (
      user_id,
      media_key,
      media_path,
      media_name,
      is_show,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_key) DO UPDATE SET
      media_path = excluded.media_path,
      media_name = excluded.media_name,
      is_show = excluded.is_show,
      updated_at = excluded.updated_at
  `).run(
    userId,
    mediaKey,
    input?.mediaPath ? String(input.mediaPath) : null,
    input?.mediaName ? String(input.mediaName) : null,
    input?.isShow ? 1 : 0,
    updatedAt
  );

  return { mediaKey, updatedAt };
}

function removeFavoriteForUser(userId, input) {
  const db = ensureDatabase();
  const mediaKey = buildFavoriteKey(input);
  if (!userId || !mediaKey) return false;
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND media_key = ?').run(userId, mediaKey);
  return true;
}

function upsertPosterOverrideForUser(userId, input) {
  const db = ensureDatabase();
  const mediaKey = buildPosterOverrideKey(input);
  if (!userId || !mediaKey) return null;

  const localPath = String(input?.localPath || '').trim();
  const tmdbPath = String(input?.tmdbPath || '').trim();
  if (!localPath && !tmdbPath) return null;

  const updatedAt = Date.now();
  db.prepare(`
    INSERT INTO poster_overrides (
      user_id,
      media_key,
      local_path,
      tmdb_path,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_key) DO UPDATE SET
      local_path = excluded.local_path,
      tmdb_path = excluded.tmdb_path,
      updated_at = excluded.updated_at
  `).run(
    userId,
    mediaKey,
    localPath || null,
    tmdbPath || null,
    updatedAt
  );

  return {
    mediaKey,
    localPath,
    tmdbPath,
    updatedAt,
  };
}

function clearPosterOverrideForUser(userId, input) {
  const db = ensureDatabase();
  const mediaKey = buildPosterOverrideKey(input);
  if (!userId || !mediaKey) return false;
  db.prepare('DELETE FROM poster_overrides WHERE user_id = ? AND media_key = ?').run(userId, mediaKey);
  return true;
}

function syncLibraryProgressForUser(userId, items) {
  if (!userId || !Array.isArray(items)) return 0;
  let synced = 0;
  for (const item of items) {
    if (!item?.path || !item?.watchProgress) continue;
    const result = upsertWatchProgress(userId, {
      mediaPath: item.path,
      mediaName: item.name || item.data?.title || item.data?.name || '',
      isShow: !!item.isShow,
      ...item.watchProgress,
    });
    if (result) synced += 1;
  }
  return synced;
}

function closeDatabase() {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
}

function getDatabaseInfo() {
  ensureDatabase();
  const files = [activeDbPath, `${activeDbPath}-wal`, `${activeDbPath}-shm`];
  return {
    path: activeDbPath,
    sizeBytes: files.reduce((sum, filePath) => {
      try { return sum + fs.statSync(filePath).size; } catch (err) { return sum; }
    }, 0),
  };
}

function createDatabaseBackup(backupDirectory) {
  const db = ensureDatabase();
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupDirectory, `my-media-app-${stamp}.sqlite`);
  const escaped = destination.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return { path: destination, filename: path.basename(destination), sizeBytes: fs.statSync(destination).size, createdAt: Date.now() };
}

function listDatabaseBackups(backupDirectory) {
  try {
    return fs.readdirSync(backupDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^my-media-app-.*\.sqlite$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(backupDirectory, entry.name);
        const stats = fs.statSync(filePath);
        return { filename: entry.name, sizeBytes: stats.size, createdAt: stats.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    return [];
  }
}

module.exports = {
  WATCH_COMPLETE_THRESHOLD_PERCENT,
  addFavoriteForUser,
  clearPosterOverrideForUser,
  changeUserPassword,
  createDatabaseBackup,
  closeDatabase,
  createUserAccount,
  deleteSessionToken,
  getFavoriteKeyMapForUser,
  getDatabaseInfo,
  getPosterOverrideMapForUser,
  getUserBySessionToken,
  getWatchProgressMapForUser,
  loginUserAccount,
  listDatabaseBackups,
  mergeFavoritesForUser,
  mergeFavoritesIntoLibrary,
  mergePosterOverridesForUser,
  mergePosterOverridesIntoLibrary,
  mergeWatchProgressForUser,
  mergeWatchProgressIntoLibrary,
  pruneExpiredSessions,
  removeFavoriteForUser,
  syncLibraryProgressForUser,
  touchSessionToken,
  updateUserProfile,
  upsertPosterOverrideForUser,
  upsertWatchProgress,
  ensureDatabase,
};
