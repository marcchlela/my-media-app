const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDatabase } = require('./account-store');
const { normalizeComparable } = require('./media-utils');

const CATALOG_SCHEMA_VERSION = 7;

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
      hidden INTEGER NOT NULL DEFAULT 0,
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
      hidden INTEGER NOT NULL DEFAULT 0,
      intro_start REAL,
      intro_end REAL,
      credits_start REAL,
      marker_source TEXT,
      marker_scan_version INTEGER NOT NULL DEFAULT 0,
      intro_confidence REAL,
      credits_confidence REAL,
      marker_analyzed_at INTEGER,
      marker_analysis_version INTEGER NOT NULL DEFAULT 0,
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
      enabled INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS media_suggestions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'show')),
      title TEXT NOT NULL,
      tmdb_id INTEGER,
      poster_path TEXT,
      release_date TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'declined')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id);
    CREATE INDEX IF NOT EXISTS idx_media_items_show_episode ON media_items(show_id, season_number, episode_number);
    CREATE INDEX IF NOT EXISTS idx_media_items_available ON media_items(available);
    CREATE INDEX IF NOT EXISTS idx_media_items_identity ON media_items(media_type, normalized_title, file_size);
    CREATE INDEX IF NOT EXISTS idx_subtitles_media ON subtitles(media_id);
  `);

  ensureColumn(db, 'shows', 'source_title', 'TEXT');
  ensureColumn(db, 'shows', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'media_items', 'source_title', 'TEXT');
  ensureColumn(db, 'media_items', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'media_items', 'intro_start', 'REAL');
  ensureColumn(db, 'media_items', 'intro_end', 'REAL');
  ensureColumn(db, 'media_items', 'credits_start', 'REAL');
  ensureColumn(db, 'media_items', 'marker_source', 'TEXT');
  ensureColumn(db, 'media_items', 'marker_scan_version', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'media_items', 'intro_confidence', 'REAL');
  ensureColumn(db, 'media_items', 'credits_confidence', 'REAL');
  ensureColumn(db, 'media_items', 'marker_analyzed_at', 'INTEGER');
  ensureColumn(db, 'media_items', 'marker_analysis_version', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'subtitles', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
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
  const movies = db.prepare("SELECT COUNT(*) AS count FROM media_items WHERE media_type = 'movie' AND hidden = 0").get().count;
  const episodes = db.prepare("SELECT COUNT(*) AS count FROM media_items WHERE media_type = 'episode' AND hidden = 0").get().count;
  const shows = db.prepare('SELECT COUNT(*) AS count FROM shows WHERE hidden = 0').get().count;
  const available = db.prepare('SELECT COUNT(*) AS count FROM media_items WHERE available = 1 AND hidden = 0').get().count;
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
    introStart: record.introStart ?? existing?.intro_start,
    introEnd: record.introEnd ?? existing?.intro_end,
    creditsStart: record.creditsStart ?? existing?.credits_start,
    introConfidence: record.introConfidence ?? existing?.intro_confidence,
    creditsConfidence: record.creditsConfidence ?? existing?.credits_confidence,
    markerSource: record.markerSource ?? existing?.marker_source,
    markerScanVersion: record.markerScanVersion ?? existing?.marker_scan_version ?? 0,
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
        intro_start = COALESCE(intro_start, ?), intro_end = COALESCE(intro_end, ?),
        credits_start = COALESCE(credits_start, ?), intro_confidence = COALESCE(intro_confidence, ?),
        credits_confidence = COALESCE(credits_confidence, ?), marker_source = COALESCE(marker_source, ?),
        marker_scan_version = MAX(marker_scan_version, ?),
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
      values.runtimeMinutes ?? null, values.introStart ?? null, values.introEnd ?? null,
      values.creditsStart ?? null, values.introConfidence ?? null, values.creditsConfidence ?? null,
      values.markerSource || null, values.markerScanVersion || 0,
      timestamp, timestamp, id
    );
  } else {
    db.prepare(`
      INSERT INTO media_items (
        id, source_id, media_type, show_id, file_path, relative_path, filename, title,
        source_title, normalized_title, season_number, episode_number, episode_end_number, available,
        file_size, modified_at, duration_seconds, container, video_codec, audio_codec, width,
        height, tmdb_id, poster_path, backdrop_path, overview, release_date, genres_json,
        rating, runtime_minutes, metadata_locked, intro_start, intro_end, credits_start,
        intro_confidence, credits_confidence, marker_source, marker_scan_version, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, values.sourceId, values.mediaType, values.showId || null, path.resolve(values.filePath),
      values.relativePath || null, values.filename, values.title, values.sourceTitle, values.normalizedTitle,
      values.seasonNumber || null, values.episodeNumber || null, values.episodeEndNumber || null,
      values.fileSize ?? null, values.modifiedAt ?? null, values.durationSeconds ?? null,
      values.container || null, values.videoCodec || null, values.audioCodec || null,
      values.width || null, values.height || null, values.tmdbId || null, values.posterPath || null,
      values.backdropPath || null, values.overview || null, values.releaseDate || null,
      JSON.stringify(values.genres || []), values.rating ?? null, values.runtimeMinutes ?? null,
      values.metadataLocked ? 1 : 0, values.introStart ?? null, values.introEnd ?? null,
      values.creditsStart ?? null, values.introConfidence ?? null, values.creditsConfidence ?? null,
      values.markerSource || null, values.markerScanVersion || 0,
      values.createdAt, values.updatedAt, values.lastSeenAt
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
    WHERE media_items.hidden = 0 AND (media_items.media_type = 'movie' OR COALESCE(shows.hidden, 0) = 0)
    ORDER BY media_items.media_type, media_items.title, media_items.season_number, media_items.episode_number
  `).all();
  const subtitles = db.prepare('SELECT id, media_id, display_name, language FROM subtitles WHERE enabled = 1 ORDER BY display_name').all();
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
      playbackMarkers: isShow ? {
        introStart: row.intro_start,
        introEnd: row.intro_end,
        creditsStart: row.credits_start,
        introConfidence: row.intro_confidence,
        creditsConfidence: row.credits_confidence,
        source: row.marker_source || null,
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

function getViewingStats(userId) {
  if (!userId) return null;
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(MIN(progress.position, progress.duration)), 0) AS watched_seconds,
      COUNT(DISTINCT CASE WHEN items.media_type = 'movie' AND progress.completed = 1 THEN items.id END) AS movies_watched,
      COUNT(DISTINCT CASE WHEN items.media_type = 'episode' AND progress.completed = 1 THEN items.id END) AS episodes_watched,
      COUNT(DISTINCT CASE WHEN items.media_type = 'episode' THEN items.show_id END) AS shows_started
    FROM media_watch_progress progress
    JOIN media_items items ON items.id = progress.media_id
    WHERE progress.user_id = ?
  `).get(userId);
  const watchedSeconds = Number(row?.watched_seconds) || 0;
  return {
    watchedSeconds,
    watchedHours: Math.round((watchedSeconds / 3600) * 10) / 10,
    moviesWatched: Number(row?.movies_watched) || 0,
    episodesWatched: Number(row?.episodes_watched) || 0,
    showsStarted: Number(row?.shows_started) || 0,
  };
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

function getAdminLibraryTree() {
  const db = getDb();
  const subtitlesByMedia = new Map();
  for (const row of db.prepare('SELECT id, media_id, display_name, language, format, enabled FROM subtitles ORDER BY display_name').all()) {
    if (!subtitlesByMedia.has(row.media_id)) subtitlesByMedia.set(row.media_id, []);
    subtitlesByMedia.get(row.media_id).push({
      id: row.id,
      name: row.display_name,
      language: row.language,
      format: row.format,
      enabled: !!row.enabled,
    });
  }
  const movies = db.prepare(`
    SELECT id, title, hidden, available, tmdb_id, poster_path, file_size, duration_seconds,
           CASE WHEN tmdb_id IS NULL THEN 1 ELSE 0 END AS unmatched
    FROM media_items WHERE media_type = 'movie' ORDER BY title
  `).all().map((row) => ({ ...row, hidden: !!row.hidden, available: !!row.available, unmatched: !!row.unmatched, subtitles: subtitlesByMedia.get(row.id) || [], subtitleCount: (subtitlesByMedia.get(row.id) || []).length }));
  const shows = db.prepare(`
    SELECT id, title, hidden, tmdb_id, poster_path, CASE WHEN tmdb_id IS NULL THEN 1 ELSE 0 END AS unmatched
    FROM shows ORDER BY title
  `).all().map((show) => ({
    ...show,
    hidden: !!show.hidden,
    unmatched: !!show.unmatched,
    seasons: [],
  }));
  const showsById = new Map(shows.map((show) => [show.id, show]));
  const seasonsByKey = new Map();
  for (const row of db.prepare(`
    SELECT id, show_id, title, season_number, episode_number, episode_end_number, hidden,
           intro_start, intro_end, credits_start, intro_confidence, credits_confidence,
           marker_source, marker_analyzed_at, marker_analysis_version, available, file_size
    FROM media_items WHERE media_type = 'episode'
    ORDER BY show_id, season_number, episode_number
  `).all()) {
    const show = showsById.get(row.show_id);
    if (!show) continue;
    const key = `${row.show_id}:${row.season_number || 0}`;
    let season = seasonsByKey.get(key);
    if (!season) {
      season = { number: row.season_number || 0, episodes: [] };
      seasonsByKey.set(key, season);
      show.seasons.push(season);
    }
    season.episodes.push({
      id: row.id,
      title: row.title,
      episode: row.episode_number,
      episodeEnd: row.episode_end_number,
      hidden: !!row.hidden,
      available: !!row.available,
      fileSize: row.file_size,
      subtitles: subtitlesByMedia.get(row.id) || [],
      subtitleCount: (subtitlesByMedia.get(row.id) || []).length,
      playbackMarkers: {
        introStart: row.intro_start,
        introEnd: row.intro_end,
        creditsStart: row.credits_start,
        introConfidence: row.intro_confidence,
        creditsConfidence: row.credits_confidence,
        source: row.marker_source,
        analyzedAt: row.marker_analyzed_at,
        analysisVersion: row.marker_analysis_version,
      },
    });
  }
  return { movies, shows };
}

function setCatalogVisibility(input, hidden) {
  const db = getDb();
  const scope = String(input?.scope || '');
  const value = hidden ? 1 : 0;
  const timestamp = now();
  if (scope === 'all') {
    db.prepare('UPDATE shows SET hidden = ?, updated_at = ?').run(value, timestamp);
    db.prepare('UPDATE media_items SET hidden = ?, updated_at = ?').run(value, timestamp);
    return true;
  }
  if (scope === 'movie') {
    return !!db.prepare("UPDATE media_items SET hidden = ?, updated_at = ? WHERE id = ? AND media_type = 'movie'")
      .run(value, timestamp, String(input?.id || '')).changes;
  }
  if (scope === 'episode') {
    return !!db.prepare("UPDATE media_items SET hidden = ?, updated_at = ? WHERE id = ? AND media_type = 'episode'")
      .run(value, timestamp, String(input?.id || '')).changes;
  }
  if (scope === 'season') {
    const season = Number.parseInt(String(input?.season), 10);
    if (!Number.isInteger(season)) return false;
    return !!db.prepare(`
      UPDATE media_items SET hidden = ?, updated_at = ?
      WHERE show_id = ? AND media_type = 'episode' AND season_number = ?
    `).run(value, timestamp, String(input?.showId || ''), season).changes;
  }
  if (scope === 'show') {
    const showId = String(input?.id || '');
    const result = db.prepare('UPDATE shows SET hidden = ?, updated_at = ? WHERE id = ?')
      .run(value, timestamp, showId);
    if (!result.changes) return false;
    db.prepare("UPDATE media_items SET hidden = ?, updated_at = ? WHERE show_id = ? AND media_type = 'episode'")
      .run(value, timestamp, showId);
    return true;
  }
  return false;
}

function deleteCatalogEntry(input = {}) {
  const db = getDb();
  const scope = String(input.scope || '');
  const id = String(input.id || '');
  if (!['movie', 'episode', 'season', 'show'].includes(scope)) return false;
  if (scope === 'season') {
    const showId = String(input.showId || '');
    const season = Number.parseInt(String(input.season), 10);
    if (!showId || !Number.isInteger(season)) return false;
    return !!db.prepare("DELETE FROM media_items WHERE show_id = ? AND media_type = 'episode' AND season_number = ?")
      .run(showId, season).changes;
  }
  if (!id) return false;
  if (scope === 'show') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("DELETE FROM media_favorites WHERE target_type = 'show' AND target_id = ?").run(id);
      db.prepare("DELETE FROM media_poster_overrides WHERE target_type = 'show' AND target_id = ?").run(id);
      const episodes = db.prepare("SELECT id FROM media_items WHERE show_id = ? AND media_type = 'episode'").all(id);
      const removeItem = db.prepare('DELETE FROM media_items WHERE id = ?');
      episodes.forEach((episode) => removeItem.run(episode.id));
      const changes = db.prepare('DELETE FROM shows WHERE id = ?').run(id).changes;
      db.exec('COMMIT');
      return !!changes;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  const mediaType = scope === 'movie' ? 'movie' : 'episode';
  if (scope === 'movie') {
    db.prepare("DELETE FROM media_favorites WHERE target_type = 'movie' AND target_id = ?").run(id);
    db.prepare("DELETE FROM media_poster_overrides WHERE target_type = 'movie' AND target_id = ?").run(id);
  }
  return !!db.prepare('DELETE FROM media_items WHERE id = ? AND media_type = ?').run(id, mediaType).changes;
}

function updatePlaybackMarkers(mediaId, input) {
  const parse = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : NaN;
  };
  const introStart = parse(input?.introStart);
  const introEnd = parse(input?.introEnd);
  const creditsStart = parse(input?.creditsStart);
  if ([introStart, introEnd, creditsStart].some(Number.isNaN)) return false;
  if ((introStart === null) !== (introEnd === null)) return false;
  if (introStart !== null && introEnd <= introStart) return false;
  const db = getDb();
  const result = db.prepare(`
    UPDATE media_items SET intro_start = ?, intro_end = ?, credits_start = ?,
      intro_confidence = CASE WHEN ? IS NULL THEN NULL ELSE 1 END,
      credits_confidence = CASE WHEN ? IS NULL THEN NULL ELSE 1 END,
      marker_source = 'manual', marker_scan_version = 1, marker_analyzed_at = ?, updated_at = ?
    WHERE id = ? AND media_type = 'episode'
  `).run(introStart, introEnd, creditsStart, introEnd, creditsStart, now(), now(), mediaId);
  return !!result.changes;
}

function updateAutomaticPlaybackMarkers(mediaId, input = {}) {
  const db = getDb();
  const item = db.prepare("SELECT marker_source FROM media_items WHERE id = ? AND media_type = 'episode'").get(mediaId);
  if (!item) return false;
  const manual = item.marker_source === 'manual';
  const result = db.prepare(`
    UPDATE media_items SET
      intro_start = CASE WHEN ? OR ? IS NULL THEN intro_start ELSE ? END,
      intro_end = CASE WHEN ? OR ? IS NULL THEN intro_end ELSE ? END,
      intro_confidence = CASE WHEN ? OR ? IS NULL THEN intro_confidence ELSE ? END,
      credits_start = CASE WHEN ? OR ? IS NULL THEN credits_start ELSE ? END,
      credits_confidence = CASE WHEN ? OR ? IS NULL THEN credits_confidence ELSE ? END,
      marker_source = CASE WHEN ? OR ? IS NULL THEN marker_source ELSE ? END,
      marker_analyzed_at = CASE WHEN ? THEN ? ELSE marker_analyzed_at END,
      marker_analysis_version = MAX(marker_analysis_version, ?),
      updated_at = ?
    WHERE id = ? AND media_type = 'episode'
  `).run(
    manual ? 1 : 0, input.introStart ?? null, input.introStart ?? null,
    manual ? 1 : 0, input.introEnd ?? null, input.introEnd ?? null,
    manual ? 1 : 0, input.introConfidence ?? null, input.introConfidence ?? null,
    manual ? 1 : 0, input.creditsStart ?? null, input.creditsStart ?? null,
    manual ? 1 : 0, input.creditsConfidence ?? null, input.creditsConfidence ?? null,
    manual ? 1 : 0, input.source || null, input.source || null,
    input.analyzed ? 1 : 0, now(), Number(input.analysisVersion) || 0, now(), mediaId
  );
  return !!result.changes;
}

function setSubtitleEnabled(subtitleId, enabled) {
  return !!getDb().prepare('UPDATE subtitles SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, now(), String(subtitleId || '')).changes;
}

function createMediaSuggestion(userId, input = {}) {
  const mediaType = input.mediaType === 'show' ? 'show' : input.mediaType === 'movie' ? 'movie' : '';
  const title = String(input.title || '').trim().slice(0, 180);
  const tmdbId = Number.parseInt(String(input.tmdbId || ''), 10);
  const note = String(input.note || '').trim().slice(0, 500);
  if (!userId || !mediaType || !title || !Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM media_suggestions
    WHERE user_id = ? AND media_type = ? AND tmdb_id = ? AND status = 'pending'
  `).get(userId, mediaType, tmdbId);
  if (existing) return db.prepare('SELECT * FROM media_suggestions WHERE id = ?').get(existing.id);
  const id = createStableId('suggestion');
  const timestamp = now();
  db.prepare(`
    INSERT INTO media_suggestions (
      id, user_id, media_type, title, tmdb_id, poster_path, release_date, note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, mediaType, title, tmdbId, input.posterPath || null, input.releaseDate || null, note || null, timestamp, timestamp);
  return db.prepare('SELECT * FROM media_suggestions WHERE id = ?').get(id);
}

function listMediaSuggestions(userId = null) {
  const db = getDb();
  const sql = `
    SELECT suggestions.*, users.first_name, users.last_name, users.email
    FROM media_suggestions suggestions
    JOIN users ON users.id = suggestions.user_id
    ${userId ? 'WHERE suggestions.user_id = ?' : ''}
    ORDER BY CASE suggestions.status WHEN 'pending' THEN 0 ELSE 1 END, suggestions.created_at DESC
  `;
  return db.prepare(sql).all(...(userId ? [userId] : [])).map((row) => ({
    id: row.id,
    mediaType: row.media_type,
    title: row.title,
    tmdbId: row.tmdb_id,
    posterPath: row.poster_path,
    releaseDate: row.release_date,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    user: { id: row.user_id, name: `${row.first_name} ${row.last_name}`.trim(), email: row.email },
  }));
}

function updateMediaSuggestionStatus(id, status) {
  if (!['pending', 'approved', 'declined'].includes(status)) return false;
  return !!getDb().prepare('UPDATE media_suggestions SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), String(id || '')).changes;
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
  createMediaSuggestion,
  deleteCatalogEntry,
  findMediaByPath,
  findRelinkCandidate,
  getCatalogCounts,
  getAdminLibraryTree,
  getDb,
  getEpisodesForShow,
  getMediaSources,
  getViewingStats,
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
  listMediaSuggestions,
  replaceSubtitles,
  saveMediaProgress,
  saveScannedMedia,
  setMediaFavorite,
  setMediaPosterOverride,
  setCatalogVisibility,
  setSubtitleEnabled,
  setSetting,
  updateAdminMetadata,
  updateAutomaticPlaybackMarkers,
  updateEpisodeMetadata,
  updateMediaSuggestionStatus,
  updatePlaybackMarkers,
  updateSourceScanState,
  upsertMediaSource,
  upsertShow,
};
