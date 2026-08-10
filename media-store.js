const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDatabase } = require('./account-store');
const { normalizeComparable } = require('./media-utils');

const CATALOG_SCHEMA_VERSION = 4;

function now() {
  return Date.now();
}

function createStableId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (err) {
    return fallback;
  }
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
  if (!columns.has(columnName)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function migrateCatalogSchema(db = ensureDatabase()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL UNIQUE CHECK(kind IN ('movies', 'tv')),
      root_path TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 0,
      last_scan_started_at INTEGER,
      last_scan_finished_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shows (
      id TEXT PRIMARY KEY,
      stable_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source_title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      tmdb_id INTEGER,
      poster_path TEXT,
      backdrop_path TEXT,
      overview TEXT,
      first_air_date TEXT,
      genres_json TEXT,
      rating REAL,
      runtime_minutes INTEGER,
      metadata_locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      source_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'episode')),
      show_id TEXT,
      file_path TEXT NOT NULL UNIQUE,
      relative_path TEXT,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      source_title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      season_number INTEGER,
      episode_number INTEGER,
      episode_end_number INTEGER,
      available INTEGER NOT NULL DEFAULT 1,
      file_size INTEGER,
      modified_at REAL,
      duration_seconds REAL,
      container TEXT,
      video_codec TEXT,
      audio_codec TEXT,
      width INTEGER,
      height INTEGER,
      tmdb_id INTEGER,
      poster_path TEXT,
      backdrop_path TEXT,
      overview TEXT,
      release_date TEXT,
      genres_json TEXT,
      rating REAL,
      runtime_minutes INTEGER,
      metadata_locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      FOREIGN KEY (source_id) REFERENCES media_sources(id),
      FOREIGN KEY (show_id) REFERENCES shows(id)
    );

    CREATE TABLE IF NOT EXISTS subtitles (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      relative_path TEXT,
      display_name TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      format TEXT NOT NULL,
      modified_at REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(media_id, file_path),
      FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_watch_progress (
      user_id INTEGER NOT NULL,
      media_id TEXT NOT NULL,
      position REAL NOT NULL,
      duration REAL NOT NULL,
      percent REAL NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_favorites (
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('movie', 'show')),
      target_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, target_type, target_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_poster_overrides (
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('movie', 'show')),
      target_id TEXT NOT NULL,
      tmdb_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, target_type, target_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id);
    CREATE INDEX IF NOT EXISTS idx_media_items_show_episode ON media_items(show_id, season_number, episode_number);
    CREATE INDEX IF NOT EXISTS idx_media_items_available ON media_items(available);
    CREATE INDEX IF NOT EXISTS idx_media_items_identity ON media_items(media_type, normalized_title, file_size);
    CREATE INDEX IF NOT EXISTS idx_subtitles_media ON subtitles(media_id);
  `);

  ensureColumn(db, 'shows', 'source_title', 'TEXT');
  ensureColumn(db, 'media_items', 'source_title', 'TEXT');
  db.exec(`
    UPDATE shows SET source_title = title WHERE source_title IS NULL OR source_title = '';
    UPDATE media_items SET source_title = title WHERE source_title IS NULL OR source_title = '';
  `);

  const currentVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  if (currentVersion < CATALOG_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION};`);
  }
  return db;
}

function getDb() {
  return migrateCatalogSchema(ensureDatabase());
}

function getSetting(key) {
  return getDb().prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(key)?.setting_value || '';
}

function setSetting(key, value) {
  getDb().prepare(`
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `).run(key, String(value ?? ''), now());
}

function upsertMediaSource(kind, rootPath) {
  const db = getDb();
  const timestamp = now();
  const resolvedRoot = path.resolve(rootPath);
  db.prepare(`
    INSERT INTO media_sources (kind, root_path, available, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(kind) DO UPDATE SET root_path = excluded.root_path, updated_at = excluded.updated_at
  `).run(kind, resolvedRoot, timestamp, timestamp);
  return db.prepare('SELECT * FROM media_sources WHERE kind = ?').get(kind);
}

function getMediaSources() {
  return getDb().prepare('SELECT * FROM media_sources ORDER BY id').all();
}

function updateSourceScanState(sourceId, values = {}) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM media_sources WHERE id = ?').get(sourceId);
  if (!current) return null;
  db.prepare(`
    UPDATE media_sources SET
      available = ?,
      last_scan_started_at = ?,
      last_scan_finished_at = ?,
      last_error = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    values.available === undefined ? current.available : (values.available ? 1 : 0),
    values.startedAt === undefined ? current.last_scan_started_at : values.startedAt,
    values.finishedAt === undefined ? current.last_scan_finished_at : values.finishedAt,
    values.error === undefined ? current.last_error : values.error,
    now(),
    sourceId
  );
  return db.prepare('SELECT * FROM media_sources WHERE id = ?').get(sourceId);
}

function getCatalogCounts() {
  const db = getDb();
  const movies = db.prepare("SELECT COUNT(*) AS count FROM media_items WHERE media_type = 'movie'").get().count;
  const episodes = db.prepare("SELECT COUNT(*) AS count FROM media_items WHERE media_type = 'episode'").get().count;
  const shows = db.prepare('SELECT COUNT(*) AS count FROM shows').get().count;
  const available = db.prepare('SELECT COUNT(*) AS count FROM media_items WHERE available = 1').get().count;
  return { movies: Number(movies), shows: Number(shows), episodes: Number(episodes), available: Number(available) };
}

function upsertShow(title, metadata = {}) {
  const db = getDb();
  const sourceTitle = String(metadata.sourceTitle || title || 'Unknown Show').trim();
  const displayTitle = String(metadata.title || title || sourceTitle).trim();
  const normalizedTitle = normalizeComparable(sourceTitle) || 'unknown show';
  const stableKey = metadata.tmdbId ? `tmdb:${metadata.tmdbId}` : `title:${normalizedTitle}`;
  let row = metadata.tmdbId
    ? db.prepare('SELECT * FROM shows WHERE tmdb_id = ? OR normalized_title = ? OR stable_key = ? LIMIT 1')
      .get(metadata.tmdbId, normalizedTitle, stableKey)
    : db.prepare('SELECT * FROM shows WHERE normalized_title = ? LIMIT 1').get(normalizedTitle);
  const timestamp = now();
  if (!row) {
    const id = createStableId('show');
    db.prepare(`
      INSERT INTO shows (
        id, stable_key, title, source_title, normalized_title, tmdb_id, poster_path, backdrop_path,
        overview, first_air_date, genres_json, rating, runtime_minutes, metadata_locked,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, stableKey, displayTitle, sourceTitle, normalizedTitle, metadata.tmdbId || null, metadata.posterPath || null,
      metadata.backdropPath || null, metadata.overview || null, metadata.releaseDate || null,
      JSON.stringify(metadata.genres || []), metadata.rating ?? null, metadata.runtimeMinutes ?? null,
      metadata.metadataLocked ? 1 : 0, timestamp, timestamp
    );
    row = db.prepare('SELECT * FROM shows WHERE id = ?').get(id);
  } else if (row.metadata_locked) {
    db.prepare('UPDATE shows SET source_title = ?, normalized_title = ?, updated_at = ? WHERE id = ?')
      .run(sourceTitle, normalizedTitle, timestamp, row.id);
    row = db.prepare('SELECT * FROM shows WHERE id = ?').get(row.id);
  } else if (Object.keys(metadata).length) {
    db.prepare(`
      UPDATE shows SET
        title = ?, source_title = ?, normalized_title = ?, tmdb_id = COALESCE(?, tmdb_id),
        poster_path = COALESCE(?, poster_path), backdrop_path = COALESCE(?, backdrop_path),
        overview = COALESCE(?, overview), first_air_date = COALESCE(?, first_air_date),
        genres_json = CASE WHEN ? != '[]' THEN ? ELSE genres_json END,
        rating = COALESCE(?, rating), runtime_minutes = COALESCE(?, runtime_minutes), updated_at = ?
      WHERE id = ?
    `).run(
      displayTitle, sourceTitle, normalizedTitle, metadata.tmdbId || null, metadata.posterPath || null,
      metadata.backdropPath || null, metadata.overview || null, metadata.releaseDate || null,
      JSON.stringify(metadata.genres || []), JSON.stringify(metadata.genres || []),
      metadata.rating ?? null, metadata.runtimeMinutes ?? null, timestamp, row.id
    );
    row = db.prepare('SELECT * FROM shows WHERE id = ?').get(row.id);
  }
  return row;
}

function findMediaByPath(filePath) {
  return getDb().prepare('SELECT * FROM media_items WHERE file_path = ?').get(path.resolve(filePath)) || null;
}

function findRelinkCandidate(identity) {
  const db = getDb();
  const params = [identity.sourceId, identity.mediaType, identity.normalizedTitle];
  let sql = `
    SELECT * FROM media_items
    WHERE source_id = ? AND media_type = ? AND normalized_title = ?
  `;
  if (identity.mediaType === 'episode') {
    sql += ' AND show_id = ? AND season_number = ? AND episode_number = ?';
    params.push(identity.showId, identity.seasonNumber, identity.episodeNumber);
  }
  if (Number.isFinite(identity.fileSize)) {
    sql += ' AND (file_size = ? OR file_size IS NULL)';
    params.push(identity.fileSize);
  }
  const rows = db.prepare(`${sql} ORDER BY available ASC, updated_at DESC`).all(...params);
  return rows.find((row) => row.available === 0 || !fs.existsSync(row.file_path)) || null;
}

function saveScannedMedia(record, existing = null) {
  const db = getDb();
  const timestamp = now();
  const id = existing?.id || createStableId('media');
  const values = {
    ...existing,
    ...record,
    id,
    sourceId: record.sourceId ?? existing?.source_id,
    mediaType: record.mediaType ?? existing?.media_type,
    showId: record.showId ?? existing?.show_id,
    filePath: record.filePath ?? existing?.file_path,
    relativePath: record.relativePath ?? existing?.relative_path,
    sourceTitle: record.sourceTitle ?? record.title ?? existing?.source_title ?? existing?.title,
    normalizedTitle: record.normalizedTitle ?? existing?.normalized_title,
    seasonNumber: record.seasonNumber ?? existing?.season_number,
    episodeNumber: record.episodeNumber ?? existing?.episode_number,
    episodeEndNumber: record.episodeEndNumber ?? existing?.episode_end_number,
    fileSize: record.fileSize ?? existing?.file_size,
    modifiedAt: record.modifiedAt ?? existing?.modified_at,
    durationSeconds: record.durationSeconds ?? existing?.duration_seconds,
    videoCodec: record.videoCodec ?? existing?.video_codec,
    audioCodec: record.audioCodec ?? existing?.audio_codec,
    tmdbId: record.tmdbId ?? existing?.tmdb_id,
    posterPath: record.posterPath ?? existing?.poster_path,
    backdropPath: record.backdropPath ?? existing?.backdrop_path,
    releaseDate: record.releaseDate ?? existing?.release_date,
    runtimeMinutes: record.runtimeMinutes ?? existing?.runtime_minutes,
    metadataLocked: record.metadataLocked ?? existing?.metadata_locked,
    genres: record.genres ?? parseJson(existing?.genres_json, []),
    available: 1,
    updatedAt: timestamp,
    createdAt: existing?.created_at || timestamp,
    lastSeenAt: timestamp,
  };
  values.normalizedTitle = normalizeComparable(values.sourceTitle) || values.normalizedTitle;
  if (existing?.metadata_locked) {
    values.title = existing.title;
    values.tmdbId = existing.tmdb_id;
    values.posterPath = existing.poster_path;
    values.backdropPath = existing.backdrop_path;
    values.overview = existing.overview;
    values.releaseDate = existing.release_date;
    values.genres = parseJson(existing.genres_json, []);
    values.rating = existing.rating;
    values.runtimeMinutes = existing.runtime_minutes;
    values.metadataLocked = 1;
  }
  if (existing) {
    db.prepare(`
      UPDATE media_items SET
        source_id = ?, media_type = ?, show_id = ?, file_path = ?, relative_path = ?,
        filename = ?, title = ?, source_title = ?, normalized_title = ?, season_number = ?, episode_number = ?,
        episode_end_number = ?, available = 1, file_size = ?, modified_at = ?, duration_seconds = ?,
        container = ?, video_codec = ?, audio_codec = ?, width = ?, height = ?,
        tmdb_id = COALESCE(?, tmdb_id), poster_path = COALESCE(?, poster_path),
        backdrop_path = COALESCE(?, backdrop_path), overview = COALESCE(?, overview),
        release_date = COALESCE(?, release_date),
        genres_json = CASE WHEN ? != '[]' THEN ? ELSE genres_json END,
        rating = COALESCE(?, rating), runtime_minutes = COALESCE(?, runtime_minutes),
        updated_at = ?, last_seen_at = ?
      WHERE id = ?
    `).run(
      values.sourceId, values.mediaType, values.showId || null, path.resolve(values.filePath),
      values.relativePath || null, values.filename, values.title, values.sourceTitle, values.normalizedTitle,
      values.seasonNumber || null, values.episodeNumber || null, values.episodeEndNumber || null,
      values.fileSize ?? null, values.modifiedAt ?? null, values.durationSeconds ?? null,
      values.container || null, values.videoCodec || null, values.audioCodec || null,
      values.width || null, values.height || null, values.tmdbId || null, values.posterPath || null,
      values.backdropPath || null, values.overview || null, values.releaseDate || null,
      JSON.stringify(values.genres || []), JSON.stringify(values.genres || []), values.rating ?? null,
      values.runtimeMinutes ?? null, timestamp, timestamp, id
    );
  } else {
    db.prepare(`
      INSERT INTO media_items (
        id, source_id, media_type, show_id, file_path, relative_path, filename, title,
        source_title, normalized_title, season_number, episode_number, episode_end_number, available,
        file_size, modified_at, duration_seconds, container, video_codec, audio_codec, width,
        height, tmdb_id, poster_path, backdrop_path, overview, release_date, genres_json,
        rating, runtime_minutes, metadata_locked, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, values.sourceId, values.mediaType, values.showId || null, path.resolve(values.filePath),
      values.relativePath || null, values.filename, values.title, values.sourceTitle, values.normalizedTitle,
      values.seasonNumber || null, values.episodeNumber || null, values.episodeEndNumber || null,
      values.fileSize ?? null, values.modifiedAt ?? null, values.durationSeconds ?? null,
      values.container || null, values.videoCodec || null, values.audioCodec || null,
      values.width || null, values.height || null, values.tmdbId || null, values.posterPath || null,
      values.backdropPath || null, values.overview || null, values.releaseDate || null,
      JSON.stringify(values.genres || []), values.rating ?? null, values.runtimeMinutes ?? null,
      values.metadataLocked ? 1 : 0, values.createdAt, values.updatedAt, values.lastSeenAt
    );
  }
  return db.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
}

function markUnseenUnavailable(sourceId, seenPaths) {
  const db = getDb();
  const rows = db.prepare('SELECT id, file_path FROM media_items WHERE source_id = ?').all(sourceId);
  const statement = db.prepare('UPDATE media_items SET available = 0, updated_at = ? WHERE id = ?');
  let unavailable = 0;
  for (const row of rows) {
    if (seenPaths.has(path.resolve(row.file_path))) continue;
    statement.run(now(), row.id);
    unavailable += 1;
  }
  return unavailable;
}

function replaceSubtitles(mediaId, entries) {
  const db = getDb();
  const keepPaths = new Set(entries.map((entry) => path.resolve(entry.filePath)));
  const existing = db.prepare('SELECT id, file_path FROM subtitles WHERE media_id = ?').all(mediaId);
  for (const row of existing) {
    if (!keepPaths.has(path.resolve(row.file_path))) {
      db.prepare('DELETE FROM subtitles WHERE id = ?').run(row.id);
    }
  }
  for (const entry of entries) {
    const timestamp = now();
    db.prepare(`
      INSERT INTO subtitles (
        id, media_id, file_path, relative_path, display_name, language, format,
        modified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id, file_path) DO UPDATE SET
        display_name = excluded.display_name, language = excluded.language,
        format = excluded.format, modified_at = excluded.modified_at, updated_at = excluded.updated_at
    `).run(
      createStableId('sub'), mediaId, path.resolve(entry.filePath), entry.relativePath || null,
      entry.displayName, entry.language || 'en', entry.format, entry.modifiedAt ?? null,
      timestamp, timestamp
    );
  }
}

function getPrivateMedia(mediaId) {
  return getDb().prepare(`
    SELECT media_items.*, media_sources.root_path AS source_root, media_sources.available AS source_available
    FROM media_items
    JOIN media_sources ON media_sources.id = media_items.source_id
    WHERE media_items.id = ?
  `).get(mediaId) || null;
}

function getPrivateShow(showId) {
  const db = getDb();
  const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(showId);
  if (!show) return null;
  const episode = db.prepare(`
    SELECT filename, relative_path FROM media_items
    WHERE show_id = ? ORDER BY season_number, episode_number LIMIT 1
  `).get(showId);
  const relativeParts = String(episode?.relative_path || '').split(/[\\/]+/).filter(Boolean);
  const lookupTitle = relativeParts.length > 1
    ? relativeParts[0]
    : String(episode?.filename || '').replace(/S\d{1,3}E\d{1,3}.*$/i, '');
  return { ...show, lookup_title: lookupTitle || show.source_title || show.title };
}

function getMetadataTarget(targetType, targetId) {
  if (targetType === 'show') return getPrivateShow(targetId);
  const item = getPrivateMedia(targetId);
  return item?.media_type === 'movie' ? item : null;
}

function getEpisodesForShow(showId) {
  return getDb().prepare(`
    SELECT * FROM media_items
    WHERE media_type = 'episode' AND show_id = ?
    ORDER BY season_number, episode_number
  `).all(showId);
}

function listMissingMetadataTargets() {
  const db = getDb();
  const shows = db.prepare(`
    SELECT 'show' AS target_type, * FROM shows
    WHERE metadata_locked = 0 AND (tmdb_id IS NULL OR poster_path IS NULL OR poster_path = '')
    ORDER BY title
  `).all();
  const movies = db.prepare(`
    SELECT 'movie' AS target_type, * FROM media_items
    WHERE media_type = 'movie' AND metadata_locked = 0
      AND (tmdb_id IS NULL OR poster_path IS NULL OR poster_path = '')
    ORDER BY title
  `).all();
  return [...shows, ...movies];
}

function getPrivateSubtitle(mediaId, subtitleId) {
  return getDb().prepare(`
    SELECT subtitles.*, media_items.source_id, media_sources.root_path AS source_root
    FROM subtitles
    JOIN media_items ON media_items.id = subtitles.media_id
    JOIN media_sources ON media_sources.id = media_items.source_id
    WHERE subtitles.id = ? AND subtitles.media_id = ?
  `).get(subtitleId, mediaId) || null;
}

function qualityTagsForRow(row) {
  const height = Number(row.height);
  if (height >= 2000) return ['4K'];
  if (height >= 1400) return ['1440p'];
  if (height >= 1000) return ['1080p'];
  if (height >= 700) return ['720p'];
  if (height >= 460) return ['480p'];
  return [];
}

function getPublicLibrary(userId = null) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      media_items.*,
      shows.title AS show_title,
      shows.tmdb_id AS show_tmdb_id,
      shows.poster_path AS show_poster_path,
      shows.backdrop_path AS show_backdrop_path,
      shows.overview AS show_overview,
      shows.first_air_date AS show_release_date,
      shows.genres_json AS show_genres_json,
      shows.rating AS show_rating,
      shows.runtime_minutes AS show_runtime_minutes
      ,shows.metadata_locked AS show_metadata_locked
    FROM media_items
    LEFT JOIN shows ON shows.id = media_items.show_id
    ORDER BY media_items.media_type, media_items.title, media_items.season_number, media_items.episode_number
  `).all();
  const subtitles = db.prepare('SELECT id, media_id, display_name, language FROM subtitles ORDER BY display_name').all();
  const subtitlesByMedia = new Map();
  for (const subtitle of subtitles) {
    if (!subtitlesByMedia.has(subtitle.media_id)) subtitlesByMedia.set(subtitle.media_id, []);
    subtitlesByMedia.get(subtitle.media_id).push({
      id: subtitle.id,
      name: subtitle.display_name,
      language: subtitle.language,
      src: `/api/media/${subtitle.media_id}/subtitles/${subtitle.id}`,
    });
  }

  const progress = new Map();
  const favorites = new Set();
  const overrides = new Map();
  if (userId) {
    for (const row of db.prepare('SELECT * FROM media_watch_progress WHERE user_id = ?').all(userId)) {
      progress.set(row.media_id, row);
    }
    for (const row of db.prepare('SELECT target_type, target_id FROM media_favorites WHERE user_id = ?').all(userId)) {
      favorites.add(`${row.target_type}:${row.target_id}`);
    }
    for (const row of db.prepare('SELECT target_type, target_id, tmdb_path FROM media_poster_overrides WHERE user_id = ?').all(userId)) {
      overrides.set(`${row.target_type}:${row.target_id}`, row.tmdb_path);
    }
  }

  return rows.map((row) => {
    const isShow = row.media_type === 'episode';
    const favoriteKey = isShow ? `show:${row.show_id}` : `movie:${row.id}`;
    const override = overrides.get(favoriteKey) || null;
    const watch = progress.get(row.id);
    const genres = parseJson(isShow ? row.show_genres_json : row.genres_json, []);
    return {
      id: row.id,
      name: row.title,
      title: row.title,
      isShow,
      showId: row.show_id || null,
      showKey: row.show_id ? `show:${row.show_id}` : null,
      showName: row.show_title || null,
      episode: isShow ? {
        season: row.season_number,
        episode: row.episode_number,
        ...(row.episode_end_number ? { episodeEnd: row.episode_end_number } : {}),
      } : null,
      tmdbId: isShow ? row.show_tmdb_id : row.tmdb_id,
      metadataLocked: !!(isShow ? row.show_metadata_locked : row.metadata_locked),
      posterPath: override || (isShow ? row.show_poster_path : row.poster_path),
      customPosterTmdbPath: override,
      backdropPath: isShow ? (row.backdrop_path || row.show_backdrop_path) : row.backdrop_path,
      overview: isShow ? (row.overview || row.show_overview) : row.overview,
      releaseDate: isShow ? row.show_release_date : row.release_date,
      rating: isShow ? (row.rating ?? row.show_rating) : row.rating,
      runtime: row.runtime_minutes || (row.duration_seconds ? Math.max(1, Math.round(row.duration_seconds / 60)) : null),
      genreNames: genres.map((genre) => typeof genre === 'string' ? genre : genre?.name).filter(Boolean),
      qualityTags: qualityTagsForRow(row),
      mimeType: getMimeType(row.filename),
      available: !!row.available,
      compatibility: {
        container: row.container || null,
        videoCodec: row.video_codec || null,
        audioCodec: row.audio_codec || null,
      },
      streamUrl: row.available ? `/api/media/${row.id}/stream` : null,
      subtitles: subtitlesByMedia.get(row.id) || [],
      isFavorite: favorites.has(favoriteKey),
      watchProgress: watch ? {
        position: watch.position,
        duration: watch.duration,
        percent: watch.percent,
        updatedAt: watch.updated_at,
      } : null,
    };
  });
}

function getMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg', '.vob': 'video/dvd', '.webm': 'video/webm',
  }[ext] || 'application/octet-stream';
}

function saveMediaProgress(userId, mediaId, input) {
  const db = getDb();
  if (!userId || !getPrivateMedia(mediaId)) return null;
  const duration = Number(input?.duration);
  const position = Number(input?.position);
  if (!(duration > 0)) return null;
  const safePosition = Math.max(0, Math.min(Number.isFinite(position) ? position : 0, duration));
  let percent = Number.isFinite(Number(input?.percent)) ? Number(input.percent) : (safePosition / duration) * 100;
  percent = Math.max(0, Math.min(100, percent));
  if (input?.completed || percent >= 92 || safePosition >= duration - 2) percent = 100;
  const updatedAt = Number.isFinite(Number(input?.updatedAt)) ? Number(input.updatedAt) : now();
  db.prepare(`
    INSERT INTO media_watch_progress (user_id, media_id, position, duration, percent, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_id) DO UPDATE SET
      position = excluded.position, duration = excluded.duration, percent = excluded.percent,
      completed = excluded.completed, updated_at = excluded.updated_at
  `).run(userId, mediaId, safePosition, duration, percent, percent >= 100 ? 1 : 0, updatedAt);
  return { position: safePosition, duration, percent, updatedAt };
}

function resolveFavoriteTarget(input) {
  if (input?.showId) return { type: 'show', id: String(input.showId) };
  if (input?.mediaId) return { type: 'movie', id: String(input.mediaId) };
  return null;
}

function validateFavoriteTarget(target) {
  if (!target) return false;
  const db = getDb();
  return target.type === 'show'
    ? !!db.prepare('SELECT id FROM shows WHERE id = ?').get(target.id)
    : !!db.prepare("SELECT id FROM media_items WHERE id = ? AND media_type = 'movie'").get(target.id);
}

function setMediaFavorite(userId, input, enabled) {
  const target = resolveFavoriteTarget(input);
  if (!userId || !validateFavoriteTarget(target)) return false;
  const db = getDb();
  if (enabled) {
    db.prepare(`
      INSERT INTO media_favorites (user_id, target_type, target_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(userId, target.type, target.id, now());
  } else {
    db.prepare('DELETE FROM media_favorites WHERE user_id = ? AND target_type = ? AND target_id = ?')
      .run(userId, target.type, target.id);
  }
  return true;
}

function setMediaPosterOverride(userId, input, enabled) {
  const target = resolveFavoriteTarget(input);
  if (!userId || !validateFavoriteTarget(target)) return false;
  const db = getDb();
  if (!enabled) {
    db.prepare('DELETE FROM media_poster_overrides WHERE user_id = ? AND target_type = ? AND target_id = ?')
      .run(userId, target.type, target.id);
    return true;
  }
  const tmdbPath = String(input?.tmdbPath || '').trim();
  if (!/^\/[^/]/.test(tmdbPath)) return false;
  db.prepare(`
    INSERT INTO media_poster_overrides (user_id, target_type, target_id, tmdb_path, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
      tmdb_path = excluded.tmdb_path, updated_at = excluded.updated_at
  `).run(userId, target.type, target.id, tmdbPath, now());
  return true;
}

function applyAdminMetadata(targetType, targetId, input, { locked = true } = {}) {
  const db = getDb();
  const target = getMetadataTarget(targetType, targetId);
  if (!target) return false;
  const title = String(input?.title || target.title).trim();
  const genres = JSON.stringify(Array.isArray(input?.genres) ? input.genres : []);
  if (targetType === 'show') {
    db.prepare(`
      UPDATE shows SET
        title = ?, tmdb_id = ?, poster_path = ?, backdrop_path = ?, overview = ?,
        first_air_date = ?, genres_json = ?, rating = ?, runtime_minutes = ?,
        metadata_locked = ?, updated_at = ?
      WHERE id = ?
    `).run(
      title, input?.tmdbId || null, input?.posterPath || null, input?.backdropPath || null,
      input?.overview || null, input?.releaseDate || null, genres, input?.rating ?? null,
      input?.runtimeMinutes ?? null, locked ? 1 : 0, now(), targetId
    );
  } else {
    db.prepare(`
      UPDATE media_items SET
        title = ?, tmdb_id = ?, poster_path = ?, backdrop_path = ?, overview = ?,
        release_date = ?, genres_json = ?, rating = ?, runtime_minutes = ?,
        metadata_locked = ?, updated_at = ?
      WHERE id = ?
    `).run(
      title, input?.tmdbId || null, input?.posterPath || null, input?.backdropPath || null,
      input?.overview || null, input?.releaseDate || null, genres, input?.rating ?? null,
      input?.runtimeMinutes ?? null, locked ? 1 : 0, now(), targetId
    );
  }
  return true;
}

function clearAdminMetadata(targetType, targetId) {
  const db = getDb();
  const target = getMetadataTarget(targetType, targetId);
  if (!target) return false;
  if (targetType === 'show') {
    db.prepare(`
      UPDATE shows SET
        title = COALESCE(NULLIF(source_title, ''), title), tmdb_id = NULL, poster_path = NULL,
        backdrop_path = NULL, overview = NULL, first_air_date = NULL, genres_json = '[]',
        rating = NULL, runtime_minutes = NULL, metadata_locked = 0, updated_at = ?
      WHERE id = ?
    `).run(now(), targetId);
    db.prepare(`
      UPDATE media_items SET
        title = COALESCE(NULLIF(source_title, ''), title), tmdb_id = NULL, poster_path = NULL,
        backdrop_path = NULL, overview = NULL, release_date = NULL, genres_json = '[]',
        rating = NULL, runtime_minutes = NULL, metadata_locked = 0, updated_at = ?
      WHERE show_id = ? AND metadata_locked = 0
    `).run(now(), targetId);
  } else {
    db.prepare(`
      UPDATE media_items SET
        title = COALESCE(NULLIF(source_title, ''), title), tmdb_id = NULL, poster_path = NULL,
        backdrop_path = NULL, overview = NULL, release_date = NULL, genres_json = '[]',
        rating = NULL, runtime_minutes = NULL, metadata_locked = 0, updated_at = ?
      WHERE id = ?
    `).run(now(), targetId);
  }
  return true;
}

function updateEpisodeMetadata(mediaId, input) {
  const db = getDb();
  const item = db.prepare("SELECT * FROM media_items WHERE id = ? AND media_type = 'episode'").get(mediaId);
  if (!item || item.metadata_locked) return false;
  const title = String(input?.title || item.title).trim();
  db.prepare(`
    UPDATE media_items SET
      title = ?, tmdb_id = COALESCE(?, tmdb_id), backdrop_path = COALESCE(?, backdrop_path),
      overview = COALESCE(?, overview), rating = COALESCE(?, rating),
      runtime_minutes = COALESCE(?, runtime_minutes), updated_at = ?
    WHERE id = ?
  `).run(
    title, input?.tmdbId || null, input?.backdropPath || null, input?.overview || null,
    input?.rating ?? null, input?.runtimeMinutes ?? null, now(), mediaId
  );
  return true;
}

function updateAdminMetadata(mediaId, input) {
  return applyAdminMetadata('movie', mediaId, input, { locked: true });
}

function migrateLegacyAccountState() {
  const db = getDb();
  db.exec(`
    INSERT OR IGNORE INTO media_watch_progress (
      user_id, media_id, position, duration, percent, completed, updated_at
    )
    SELECT wp.user_id, mi.id, wp.position, wp.duration, wp.percent, wp.completed, wp.updated_at
    FROM watch_progress wp
    JOIN media_items mi ON mi.file_path = wp.media_path;

    INSERT OR IGNORE INTO media_favorites (user_id, target_type, target_id, updated_at)
    SELECT f.user_id, 'movie', mi.id, f.updated_at
    FROM favorites f
    JOIN media_items mi ON mi.file_path = f.media_path
    WHERE f.is_show = 0;
  `);
}

module.exports = {
  applyAdminMetadata,
  clearAdminMetadata,
  findMediaByPath,
  findRelinkCandidate,
  getCatalogCounts,
  getDb,
  getEpisodesForShow,
  getMediaSources,
  getMetadataTarget,
  getMimeType,
  getPrivateMedia,
  getPrivateShow,
  getPrivateSubtitle,
  getPublicLibrary,
  getSetting,
  markUnseenUnavailable,
  migrateCatalogSchema,
  migrateLegacyAccountState,
  listMissingMetadataTargets,
  replaceSubtitles,
  saveMediaProgress,
  saveScannedMedia,
  setMediaFavorite,
  setMediaPosterOverride,
  setSetting,
  updateAdminMetadata,
  updateEpisodeMetadata,
  updateSourceScanState,
  upsertMediaSource,
  upsertShow,
};
