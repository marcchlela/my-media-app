const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  changeUserPassword,
  closeDatabase,
  createDatabaseBackup,
  createUserAccount,
  deleteSessionToken,
  getDatabaseInfo,
  getUserBySessionToken,
  loginUserAccount,
  listDatabaseBackups,
  pruneExpiredSessions,
  touchSessionToken,
  updateUserProfile,
} = require('./account-store');
const {
  resolveAllowedOrigins,
  resolveBoolean,
  resolveDataDirectory,
  resolveEnvValue,
  resolveMediaDirectories,
  resolveTmdbApiKey,
} = require('./env-config');
const { MediaScanner } = require('./media-scanner');
const { HlsManager } = require('./hls-manager');
const { IntroDetector } = require('./intro-detector');
const { JobManager } = require('./job-manager');
const { StreamManager } = require('./stream-manager');
const { detectMediaTools, directorySize, storageSnapshot, systemSnapshot } = require('./system-monitor');
const {
  createMediaSuggestion,
  deleteCatalogEntry,
  getCatalogCounts,
  getAdminLibraryTree,
  getDb,
  getMediaSources,
  getMimeType,
  getPrivateMedia,
  getPrivateSubtitle,
  getPublicLibrary,
  getViewingStats,
  listMediaSuggestions,
  migrateCatalogSchema,
  saveMediaProgress,
  setCatalogVisibility,
  setMediaFavorite,
  setMediaPosterOverride,
  setSubtitleEnabled,
  updateAdminMetadata,
  updateMediaSuggestionStatus,
  updatePlaybackMarkers,
} = require('./media-store');
const { isPathInsideRoot } = require('./media-utils');
const { serveMediaFile, serveSubtitleFile } = require('./streaming');

const PORT = Number(resolveEnvValue('PORT', '3000')) || 3000;
const NODE_ENV = resolveEnvValue('NODE_ENV', process.env.NODE_ENV || 'development');
const DATA_DIR = path.resolve(resolveDataDirectory() || path.join(__dirname, '.data'));
const configuredMedia = resolveMediaDirectories();
const MOVIES_DIR = path.resolve(configuredMedia.movies || '/media/Movies');
const TV_SHOWS_DIR = path.resolve(configuredMedia.tvShows || '/media/TV Shows');
const ALLOW_SIGNUP = resolveBoolean('ALLOW_SIGNUP', NODE_ENV !== 'production');
const REQUIRE_AUTH = resolveBoolean('REQUIRE_AUTH', false);
const COOKIE_SECURE = resolveBoolean('COOKIE_SECURE', false);
const LEGACY_PATH_ROUTES = resolveBoolean('ENABLE_LEGACY_PATH_ROUTES', false);
const SCAN_ON_STARTUP = resolveBoolean('SCAN_ON_STARTUP', true);
const ALLOWED_ORIGINS = new Set(resolveAllowedOrigins());
const SESSION_COOKIE_NAME = 'my_media_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const WEB_DIR = path.join(__dirname, 'web');
const ELECTRIC_ASSET_DIR = path.join(__dirname, 'myflix-electric', 'assets', 'generated-3d');
const SUBTITLE_CACHE_DIR = path.join(DATA_DIR, 'cache', 'subtitles');
const HLS_CACHE_DIR = path.join(DATA_DIR, 'cache', 'hls');
const CUSTOM_POSTER_DIR = path.join(DATA_DIR, 'custom-posters');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = resolveTmdbApiKey();
const SERVER_VERSION = require('./package.json').version;

function parseCookies(headerValue) {
  const cookies = {};
  for (const pair of String(headerValue || '').split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    try {
      cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
    } catch (err) {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

function getSessionToken(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  const headerToken = String(req.headers['x-session-token'] || '').trim();
  return headerToken || parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || '';
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE_SECONDS) {
  const values = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (COOKIE_SECURE) values.push('Secure');
  return values.join('; ');
}

function requireAccount(req, res, next) {
  if (!req.account?.user?.id) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.account?.user?.id) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  if (!req.account.user.isAdmin) return res.status(403).json({ ok: false, error: 'Administrator access required.' });
  next();
}

function createLoginLimiter() {
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;
  const limit = 6;
  return function loginLimiter(req, res, next) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`;
    const timestamp = Date.now();
    if (attempts.size > 1000) {
      for (const [attemptKey, values] of attempts) {
        if (!values.some((value) => value > timestamp - windowMs)) attempts.delete(attemptKey);
      }
    }
    const recent = (attempts.get(key) || []).filter((value) => value > timestamp - windowMs);
    if (recent.length >= limit) {
      res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - timestamp) / 1000)));
      return res.status(429).json({ ok: false, authError: 'Too many login attempts. Try again later.' });
    }
    recent.push(timestamp);
    attempts.set(key, recent);
    res.on('finish', () => {
      if (res.statusCode < 400) attempts.delete(key);
    });
    next();
  };
}

function safeSourceStatus() {
  return getMediaSources().map((source) => ({
    kind: source.kind,
    available: !!source.available,
    lastScanFinishedAt: source.last_scan_finished_at || null,
    error: source.last_error || null,
  }));
}

function requireTmdbKey(res) {
  if (TMDB_API_KEY) return true;
  res.status(503).json({ error: 'TMDB is not configured on this server.' });
  return false;
}

async function tmdbGet(endpoint, query = {}) {
  const url = new URL(`${TMDB_API_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.status_message || `TMDB request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function installTmdbRoutes(app) {
  app.get('/api/tmdb/health', (_req, res) => res.json({ configured: !!TMDB_API_KEY }));
  app.get('/api/tmdb/movie/search', async (req, res) => {
    if (!requireTmdbKey(res)) return;
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing search query.' });
    try { return res.json(await tmdbGet('/search/movie', { query })); }
    catch (err) { return res.status(err.status || 502).json({ error: err.message }); }
  });
  app.get('/api/tmdb/tv/search', async (req, res) => {
    if (!requireTmdbKey(res)) return;
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing search query.' });
    try { return res.json(await tmdbGet('/search/tv', { query })); }
    catch (err) { return res.status(err.status || 502).json({ error: err.message }); }
  });
  const detailRoutes = [
    ['/api/tmdb/movie/:id', (id) => `/movie/${id}`],
    ['/api/tmdb/movie/:id/credits', (id) => `/movie/${id}/credits`],
    ['/api/tmdb/movie/:id/videos', (id) => `/movie/${id}/videos`],
    ['/api/tmdb/movie/:id/images', (id) => `/movie/${id}/images`],
    ['/api/tmdb/tv/:id', (id) => `/tv/${id}`],
    ['/api/tmdb/tv/:id/credits', (id) => `/tv/${id}/credits`],
    ['/api/tmdb/tv/:id/images', (id) => `/tv/${id}/images`],
  ];
  for (const [route, endpoint] of detailRoutes) {
    app.get(route, async (req, res) => {
      if (!requireTmdbKey(res)) return;
      const id = positiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid TMDB ID.' });
      try { return res.json(await tmdbGet(endpoint(id))); }
      catch (err) { return res.status(err.status || 502).json({ error: err.message }); }
    });
  }
  app.get('/api/tmdb/tv/:id/season/:season/episode/:episode', async (req, res) => {
    if (!requireTmdbKey(res)) return;
    const id = positiveInteger(req.params.id);
    const season = positiveInteger(req.params.season);
    const episode = positiveInteger(req.params.episode);
    if (!id || !season || !episode) return res.status(400).json({ error: 'Invalid episode identifier.' });
    try { return res.json(await tmdbGet(`/tv/${id}/season/${season}/episode/${episode}`)); }
    catch (err) { return res.status(err.status || 502).json({ error: err.message }); }
  });
}

function createApp(options = {}) {
  migrateCatalogSchema();
  const scanner = options.scanner || new MediaScanner({ moviesDir: MOVIES_DIR, tvShowsDir: TV_SHOWS_DIR });
  const jobManager = options.jobManager || new JobManager();
  const streamManager = options.streamManager || new StreamManager();
  const tools = options.tools || detectMediaTools();
  const hlsManager = options.hlsManager || new HlsManager({
    cacheDir: HLS_CACHE_DIR,
    ffmpegPath: tools.ffmpeg?.path,
    jobManager,
    tools,
  });
  const introDetector = options.introDetector || new IntroDetector({
    fpcalcPath: tools.fingerprint?.path,
    jobManager,
    tools,
  });
  let activeScanJobId = null;

  function startLibraryScan({ analyzeIntros = true } = {}) {
    if (scanner.getStatus().running || activeScanJobId) return { started: false, jobId: activeScanJobId, status: scanner.getStatus() };
    const job = jobManager.start('library-scan', 'Scan media library', async ({ update }) => {
      const progressTimer = setInterval(() => {
        const status = scanner.getStatus();
        update({
          progress: status.running ? Math.min(92, 5 + Number(status.filesScanned || 0)) : 96,
          message: status.running ? `Scanning library: ${status.filesScanned || 0} files inspected` : 'Finalizing catalog',
        });
      }, 750);
      progressTimer.unref?.();
      try {
        const result = await scanner.scan();
        if (analyzeIntros && tools.fingerprint?.available) introDetector.start();
        return result.status;
      } finally {
        clearInterval(progressTimer);
        activeScanJobId = null;
      }
    });
    activeScanJobId = job.id;
    return { started: true, jobId: job.id, status: scanner.getStatus() };
  }

  function getStorageDetails() {
    const database = getDatabaseInfo();
    const mediaRows = getDb().prepare(`
      SELECT media_type, COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS bytes,
             SUM(CASE WHEN available = 0 THEN 1 ELSE 0 END) AS missing
      FROM media_items GROUP BY media_type
    `).all();
    return {
      volumes: {
        data: storageSnapshot(DATA_DIR),
        movies: storageSnapshot(MOVIES_DIR),
        tvShows: storageSnapshot(TV_SHOWS_DIR),
      },
      usage: {
        media: mediaRows,
        hlsCacheBytes: directorySize(HLS_CACHE_DIR),
        subtitleCacheBytes: directorySize(SUBTITLE_CACHE_DIR),
        customPosterBytes: directorySize(CUSTOM_POSTER_DIR),
        databaseBytes: database.sizeBytes,
      },
      database,
      backups: listDatabaseBackups(BACKUP_DIR),
    };
  }

  function getWarnings() {
    const warnings = [];
    const sources = safeSourceStatus();
    sources.filter((source) => !source.available).forEach((source) => warnings.push({ level: 'critical', title: `${source.kind} source unavailable`, detail: source.error || 'The configured media folder cannot be read.' }));
    const missing = Number(getDb().prepare('SELECT COUNT(*) AS count FROM media_items WHERE available = 0').get().count || 0);
    const unmatched = Number(getDb().prepare(`SELECT
      (SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND tmdb_id IS NULL)
      + (SELECT COUNT(*) FROM shows WHERE tmdb_id IS NULL) AS count`).get().count || 0);
    const pendingSuggestions = Number(getDb().prepare("SELECT COUNT(*) AS count FROM media_suggestions WHERE status = 'pending'").get().count || 0);
    if (missing) warnings.push({ level: 'warning', title: `${missing} missing catalog file${missing === 1 ? '' : 's'}`, detail: 'Review storage mounts or remove stale catalog records.' });
    if (unmatched) warnings.push({ level: 'notice', title: `${unmatched} unmatched title${unmatched === 1 ? '' : 's'}`, detail: 'Metadata needs a manual TMDB match.' });
    if (pendingSuggestions) warnings.push({ level: 'notice', title: `${pendingSuggestions} pending suggestion${pendingSuggestions === 1 ? '' : 's'}`, detail: 'Viewers are waiting for a library decision.' });
    if (!tools.ffmpeg?.available) warnings.push({ level: 'warning', title: 'FFmpeg unavailable', detail: 'Adaptive quality generation is disabled.' });
    if (!tools.fingerprint?.available) warnings.push({ level: 'warning', title: 'Chromaprint unavailable', detail: 'Automatic audio-fingerprint intro detection is disabled.' });
    return warnings;
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveBoolean('TRUST_PROXY', false) ? 1 : false);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://image.tmdb.org; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    });
    const origin = String(req.headers.origin || '');
    if (!origin) return next();
    const ownOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin !== ownOrigin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      Vary: 'Origin',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.post('/api/account/poster-upload', express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '8mb',
  }), async (req, res) => {
    const token = getSessionToken(req);
    const user = token ? getUserBySessionToken(token) : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in is required.' });
    const targetType = req.query.type === 'show' ? 'show' : req.query.type === 'movie' ? 'movie' : '';
    const targetId = String(req.query.id || '');
    if (!targetType || !/^[a-z0-9_]+$/i.test(targetId) || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ ok: false, error: 'Invalid poster upload.' });
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
    const validSignature = extension === 'jpg'
      ? req.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : extension === 'png'
        ? req.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : req.body.subarray(0, 4).toString('ascii') === 'RIFF' && req.body.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!extension || !validSignature) return res.status(400).json({ ok: false, error: 'Unsupported poster image.' });
    const userDir = path.join(CUSTOM_POSTER_DIR, String(user.id));
    const baseName = `${targetType}-${targetId}`;
    try {
      await fs.promises.mkdir(userDir, { recursive: true });
      await Promise.all(['jpg', 'png', 'webp'].map((candidate) => (
        fs.promises.rm(path.join(userDir, `${baseName}.${candidate}`), { force: true })
      )));
      const filename = `${baseName}.${extension}`;
      await fs.promises.writeFile(path.join(userDir, filename), req.body, { flag: 'wx' });
      const posterPath = `/api/account/poster-file/${user.id}/${filename}`;
      const target = targetType === 'show' ? { showId: targetId } : { mediaId: targetId };
      if (!setMediaPosterOverride(user.id, { ...target, tmdbPath: posterPath }, true)) {
        await fs.promises.rm(path.join(userDir, filename), { force: true });
        return res.status(400).json({ ok: false, error: 'Invalid poster target.' });
      }
      return res.json({ ok: true, posterPath });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Could not save the poster.' });
    }
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use((req, _res, next) => {
    const token = getSessionToken(req);
    const user = token ? getUserBySessionToken(token) : null;
    if (user) touchSessionToken(token);
    req.account = user ? { token, user } : null;
    next();
  });
  app.use('/web', express.static(WEB_DIR, { fallthrough: true, maxAge: NODE_ENV === 'production' ? '1h' : 0 }));
  app.get('/apple-touch-icon.png', (_req, res) => res.sendFile(path.join(WEB_DIR, 'icons', 'apple-touch-icon-v2.png')));
  app.get('/vendor/hls.min.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'hls.js', 'dist', 'hls.min.js')));
  app.use('/electric-assets', express.static(ELECTRIC_ASSET_DIR, {
    fallthrough: false,
    immutable: NODE_ENV === 'production',
    maxAge: NODE_ENV === 'production' ? '7d' : 0,
  }));

  app.get('/', (_req, res) => {
    const counts = getCatalogCounts();
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyFlix Server</title></head><body><h1>MyFlix</h1><p>Server ready.</p><p>${counts.movies} movies, ${counts.shows} shows, ${counts.episodes} episodes.</p><p><a href="/desktop">Desktop</a> | <a href="/mobile">Mobile</a> | <a href="/health">Health</a></p></body></html>`);
  });
  app.get('/desktop', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
  app.get(['/mobile', '/mobile/'], (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
  app.get('/app', (_req, res) => res.redirect(302, '/mobile'));
  app.get('/admin', (req, res) => {
    if (!req.account?.user) return res.redirect(302, '/desktop#account');
    if (!req.account.user.isAdmin) return res.status(403).type('html').send('<h1>Administrator access required</h1>');
    return res.sendFile(path.join(WEB_DIR, 'admin.html'));
  });

  app.get('/health', (_req, res) => {
    try {
      const counts = getCatalogCounts();
      return res.json({ ok: true, database: true, catalog: counts, mediaSources: safeSourceStatus(), tools: {
        ffmpeg: !!tools.ffmpeg?.available,
        fingerprint: !!tools.fingerprint?.available,
      } });
    } catch (err) {
      return res.status(503).json({ ok: false, database: false });
    }
  });

  app.get('/api/capabilities', (_req, res) => res.json({
    ok: true,
    serverVersion: SERVER_VERSION,
    hlsAvailable: !!tools.ffmpeg?.available,
    ffmpegAvailable: !!tools.ffmpeg?.available,
    signupAllowed: ALLOW_SIGNUP,
    authRequired: REQUIRE_AUTH,
    playback: { default: 'direct', compatibilityFallback: !!tools.ffmpeg?.available },
  }));

  app.get('/api/account/me', (req, res) => res.json({
    ok: true,
    authenticated: !!req.account?.user,
    user: req.account?.user || null,
    allowSignup: ALLOW_SIGNUP,
  }));
  app.post('/api/account/signup', (req, res) => {
    if (!ALLOW_SIGNUP) return res.status(403).json({ ok: false, error: 'Account creation is disabled.' });
    const result = createUserAccount(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    res.set('Set-Cookie', sessionCookie(result.sessionToken));
    return res.status(201).json({ ok: true, user: result.user, sessionToken: result.sessionToken });
  });
  app.post('/api/account/login', createLoginLimiter(), (req, res) => {
    const result = loginUserAccount(req.body || {});
    if (!result.ok) return res.status(401).json(result);
    res.set('Set-Cookie', sessionCookie(result.sessionToken));
    return res.json({ ok: true, user: result.user, sessionToken: result.sessionToken });
  });
  app.post('/api/account/logout', (req, res) => {
    if (req.account?.token) deleteSessionToken(req.account.token);
    res.set('Set-Cookie', sessionCookie('', 0));
    return res.json({ ok: true });
  });
  app.patch('/api/account/profile', requireAccount, (req, res) => {
    const result = updateUserProfile(req.account.user.id, req.body || {});
    return res.status(result.ok ? 200 : 400).json(result);
  });
  app.patch('/api/account/password', requireAccount, (req, res) => {
    const result = changeUserPassword(req.account.user.id, req.body || {}, req.account.token);
    return res.status(result.ok ? 200 : 400).json(result);
  });
  app.get('/api/account/stats', requireAccount, (req, res) => (
    res.json({ ok: true, stats: getViewingStats(req.account.user.id) })
  ));
  app.get('/api/account/suggestions', requireAccount, (req, res) => (
    res.json({ ok: true, suggestions: listMediaSuggestions(req.account.user.id) })
  ));
  app.post('/api/account/suggestions', requireAccount, (req, res) => {
    const suggestion = createMediaSuggestion(req.account.user.id, req.body || {});
    if (!suggestion) return res.status(400).json({ ok: false, error: 'Choose a valid TMDB movie or show.' });
    return res.status(201).json({ ok: true, suggestion });
  });
  app.get('/api/account/poster-file/:userId/:filename', requireAccount, (req, res) => {
    if (String(req.account.user.id) !== String(req.params.userId)) return res.sendStatus(403);
    const filename = String(req.params.filename || '');
    if (!/^(?:movie|show)-[a-z0-9_]+\.(?:jpg|png|webp)$/i.test(filename)) return res.sendStatus(400);
    return res.sendFile(path.join(CUSTOM_POSTER_DIR, String(req.account.user.id), filename));
  });

  const optionalLibraryAuth = REQUIRE_AUTH ? requireAccount : (_req, _res, next) => next();
  const sendLibrary = (req, res) => res.json(getPublicLibrary(req.account?.user?.id || null));
  app.get('/api/library', optionalLibraryAuth, sendLibrary);
  app.get('/library', optionalLibraryAuth, sendLibrary);

  app.post('/api/account/progress', requireAccount, (req, res) => {
    const saved = saveMediaProgress(req.account.user.id, String(req.body?.mediaId || ''), req.body || {});
    if (!saved) return res.status(400).json({ ok: false, error: 'Invalid media progress payload.' });
    return res.json({ ok: true, watchProgress: saved });
  });
  app.post('/api/account/favorite', requireAccount, (req, res) => {
    if (!setMediaFavorite(req.account.user.id, req.body || {}, true)) return res.status(400).json({ ok: false, error: 'Invalid favorite target.' });
    return res.json({ ok: true });
  });
  app.delete('/api/account/favorite', requireAccount, (req, res) => {
    if (!setMediaFavorite(req.account.user.id, req.body || {}, false)) return res.status(400).json({ ok: false, error: 'Invalid favorite target.' });
    return res.json({ ok: true });
  });
  app.post('/api/account/poster', requireAccount, (req, res) => {
    if (!setMediaPosterOverride(req.account.user.id, req.body || {}, true)) return res.status(400).json({ ok: false, error: 'Invalid poster override.' });
    return res.json({ ok: true });
  });
  app.delete('/api/account/poster', requireAccount, async (req, res) => {
    if (!setMediaPosterOverride(req.account.user.id, req.body || {}, false)) return res.status(400).json({ ok: false, error: 'Invalid poster override.' });
    const targetType = req.body?.showId ? 'show' : 'movie';
    const targetId = String(req.body?.showId || req.body?.mediaId || '');
    if (/^[a-z0-9_]+$/i.test(targetId)) {
      const userDir = path.join(CUSTOM_POSTER_DIR, String(req.account.user.id));
      await Promise.all(['jpg', 'png', 'webp'].map((extension) => (
        fs.promises.rm(path.join(userDir, `${targetType}-${targetId}.${extension}`), { force: true }).catch(() => {})
      )));
    }
    return res.json({ ok: true });
  });

  async function streamMedia(req, res) {
    const item = getPrivateMedia(String(req.params.id || ''));
    if (!item) return res.sendStatus(404);
    if (!item.available || !item.source_available) return res.status(503).json({ error: 'Media source is currently unavailable.' });
    if (!isPathInsideRoot(item.file_path, item.source_root)) return res.status(403).json({ error: 'Invalid catalog path.' });
    return serveMediaFile(item.file_path, getMimeType(item.filename), req, res);
  }
  app.get('/api/media/:id/stream', optionalLibraryAuth, streamMedia);
  app.head('/api/media/:id/stream', optionalLibraryAuth, streamMedia);
  app.get('/video/:id', optionalLibraryAuth, streamMedia);
  app.head('/video/:id', optionalLibraryAuth, streamMedia);

  app.get('/api/media/:id/subtitles/:subtitleId', optionalLibraryAuth, async (req, res) => {
    const subtitle = getPrivateSubtitle(String(req.params.id || ''), String(req.params.subtitleId || ''));
    if (!subtitle) return res.sendStatus(404);
    if (!isPathInsideRoot(subtitle.file_path, subtitle.source_root)) return res.status(403).json({ error: 'Invalid subtitle path.' });
    return serveSubtitleFile(subtitle.file_path, SUBTITLE_CACHE_DIR, res);
  });

  app.get('/api/media/:id/playback-options', optionalLibraryAuth, (req, res) => {
    const item = getPrivateMedia(String(req.params.id || ''));
    if (!item || !item.available || !item.source_available) return res.sendStatus(404);
    return res.json({ ok: true, ...hlsManager.playbackOptions(item) });
  });
  app.post('/api/media/:id/hls', optionalLibraryAuth, (req, res) => {
    const item = getPrivateMedia(String(req.params.id || ''));
    if (!item || !item.available || !item.source_available) return res.sendStatus(404);
    if (!isPathInsideRoot(item.file_path, item.source_root)) return res.status(403).json({ error: 'Invalid catalog path.' });
    try {
      const status = hlsManager.start(item, req.body || {});
      return res.status(status.state === 'ready' ? 200 : 202).json({ ok: true, status });
    } catch (err) {
      return res.status(503).json({ ok: false, error: err.message });
    }
  });
  app.get('/api/media/:id/hls/status', optionalLibraryAuth, (req, res) => {
    const item = getPrivateMedia(String(req.params.id || ''));
    if (!item) return res.sendStatus(404);
    return res.json({ ok: true, status: hlsManager.getStatus(item.id, req.query || {}) });
  });
  app.get('/api/media/:id/hls/master.m3u8', optionalLibraryAuth, (req, res) => {
    const item = getPrivateMedia(String(req.params.id || ''));
    const asset = item && hlsManager.resolveAsset(item.id, ['master.m3u8']);
    if (!asset) return res.sendStatus(404);
    return res.type('application/vnd.apple.mpegurl').sendFile(asset);
  });
  app.get('/api/media/:id/hls/:cacheKey/master.m3u8', optionalLibraryAuth, (req, res) => {
    const item = getPrivateMedia(String(req.params.id || ''));
    const asset = item && hlsManager.resolveAsset(item.id, req.params.cacheKey, ['master.m3u8']);
    if (!asset) return res.sendStatus(404);
    return res.type('application/vnd.apple.mpegurl').sendFile(asset);
  });
  app.get('/api/media/:id/hls/:cacheKey/:quality/:asset', optionalLibraryAuth, (req, res) => {
    if (!/^\d+p$/.test(String(req.params.quality || '')) || !/^(?:index\.m3u8|segment_\d{5}\.ts)$/.test(String(req.params.asset || ''))) return res.sendStatus(400);
    const item = getPrivateMedia(String(req.params.id || ''));
    const asset = item && hlsManager.resolveAsset(item.id, req.params.cacheKey, [req.params.quality, req.params.asset]);
    if (!asset) return res.sendStatus(404);
    const contentType = req.params.asset.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
    return res.type(contentType).sendFile(asset);
  });
  app.get('/api/media/:id/hls/:quality/:asset', optionalLibraryAuth, (req, res) => {
    if (!/^\d+p$/.test(String(req.params.quality || '')) || !/^(?:index\.m3u8|segment_\d{5}\.ts)$/.test(String(req.params.asset || ''))) return res.sendStatus(400);
    const item = getPrivateMedia(String(req.params.id || ''));
    const asset = item && hlsManager.resolveAsset(item.id, [req.params.quality, req.params.asset]);
    if (!asset) return res.sendStatus(404);
    const contentType = req.params.asset.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
    return res.type(contentType).sendFile(asset);
  });

  app.post('/api/playback/session', optionalLibraryAuth, (req, res) => {
    const session = streamManager.touch(req.body || {}, {
      userId: req.account?.user?.id || null,
      userName: req.account?.user ? `${req.account.user.firstName} ${req.account.user.lastName}`.trim() : 'Guest',
      ip: req.ip || req.socket.remoteAddress || '',
    });
    return res.json({ ok: true, sessionId: session.sessionId });
  });
  app.delete('/api/playback/session/:id', optionalLibraryAuth, (req, res) => {
    streamManager.close(req.params.id);
    return res.json({ ok: true });
  });

  if (LEGACY_PATH_ROUTES) {
    app.get('/video', requireAdmin, async (req, res) => {
      const filePath = String(req.query.path || '');
      if (![MOVIES_DIR, TV_SHOWS_DIR].some((root) => isPathInsideRoot(filePath, root))) return res.status(403).json({ error: 'Path is outside media roots.' });
      return serveMediaFile(filePath, null, req, res);
    });
  }

  app.post('/api/admin/library/scan', requireAdmin, (req, res) => {
    const result = startLibraryScan({ analyzeIntros: req.body?.analyzeIntros !== false });
    if (!result.started) return res.status(409).json({ ok: false, error: 'A library scan is already running.', ...result });
    return res.status(202).json({ ok: true, ...result });
  });
  app.get('/api/admin/library/scan/status', requireAdmin, (_req, res) => res.json({ ok: true, status: scanner.getStatus() }));
  app.get('/api/admin/library/manage', requireAdmin, (_req, res) => (
    res.json({ ok: true, library: getAdminLibraryTree() })
  ));
  app.patch('/api/admin/library/visibility', requireAdmin, (req, res) => {
    const hidden = req.body?.hidden !== false;
    if (!setCatalogVisibility(req.body || {}, hidden)) return res.status(400).json({ ok: false, error: 'Invalid catalog selection.' });
    return res.json({ ok: true, catalog: getCatalogCounts() });
  });
  app.delete('/api/admin/library/catalog', requireAdmin, (req, res) => {
    if (!deleteCatalogEntry(req.body || {})) return res.status(400).json({ ok: false, error: 'Catalog item was not found.' });
    return res.json({ ok: true, catalog: getCatalogCounts() });
  });
  app.patch('/api/admin/subtitles/:id', requireAdmin, (req, res) => {
    if (!setSubtitleEnabled(req.params.id, req.body?.enabled !== false)) return res.status(404).json({ ok: false, error: 'Subtitle was not found.' });
    return res.json({ ok: true });
  });
  app.patch('/api/admin/media/:id/playback-markers', requireAdmin, (req, res) => {
    if (!updatePlaybackMarkers(String(req.params.id || ''), req.body || {})) {
      return res.status(400).json({ ok: false, error: 'Invalid playback markers.' });
    }
    return res.json({ ok: true });
  });
  app.post('/api/admin/library/metadata/refresh', requireAdmin, (_req, res) => {
    const result = scanner.refreshMissingMetadata();
    return res.status(result.started ? 202 : 409).json({ ok: result.started, ...result });
  });
  app.get('/api/admin/library/metadata/status', requireAdmin, (_req, res) => (
    res.json({ ok: true, status: scanner.getMetadataStatus() })
  ));
  app.get('/api/admin/metadata/search', requireAdmin, async (req, res) => {
    const targetType = req.query.type === 'show' ? 'show' : req.query.type === 'movie' ? 'movie' : '';
    const targetId = String(req.query.id || '');
    if (!targetType || !targetId) return res.status(400).json({ ok: false, error: 'Invalid metadata target.' });
    try {
      const result = await scanner.metadataManager.search(targetType, targetId, String(req.query.q || ''));
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(/not configured/i.test(err.message) ? 503 : 400).json({ ok: false, error: err.message });
    }
  });
  app.post('/api/admin/metadata/match', requireAdmin, async (req, res) => {
    const targetType = req.body?.targetType === 'show' ? 'show' : req.body?.targetType === 'movie' ? 'movie' : '';
    const targetId = String(req.body?.targetId || '');
    const tmdbId = positiveInteger(req.body?.tmdbId);
    if (!targetType || !targetId || !tmdbId) return res.status(400).json({ ok: false, error: 'Invalid metadata selection.' });
    try {
      const result = await scanner.metadataManager.applyManualMatch(targetType, targetId, tmdbId);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(/not configured/i.test(err.message) ? 503 : 400).json({ ok: false, error: err.message });
    }
  });
  app.delete('/api/admin/metadata/match', requireAdmin, (req, res) => {
    const targetType = req.body?.targetType === 'show' ? 'show' : req.body?.targetType === 'movie' ? 'movie' : '';
    const targetId = String(req.body?.targetId || '');
    if (!targetType || !targetId || !scanner.metadataManager.clearManualMatch(targetType, targetId)) {
      return res.status(400).json({ ok: false, error: 'Invalid metadata target.' });
    }
    return res.json({ ok: true });
  });
  app.post('/api/admin/metadata/retry', requireAdmin, async (req, res) => {
    const targetType = req.body?.targetType === 'show' ? 'show' : req.body?.targetType === 'movie' ? 'movie' : '';
    const targetId = String(req.body?.targetId || '');
    if (!targetType || !targetId) return res.status(400).json({ ok: false, error: 'Invalid metadata target.' });
    const result = await scanner.metadataManager.retryAutomatic(targetType, targetId);
    return res.status(result.state === 'failed' ? 400 : 200).json({ ok: result.state === 'matched', ...result });
  });
  app.patch('/api/admin/media/:id/metadata', requireAdmin, (req, res) => {
    if (!updateAdminMetadata(String(req.params.id || ''), req.body || {})) return res.status(404).json({ ok: false, error: 'Media item not found.' });
    return res.json({ ok: true });
  });
  app.get('/api/admin/status', requireAdmin, (_req, res) => res.json({
    ok: true,
    catalog: getCatalogCounts(),
    mediaSources: safeSourceStatus(),
    scan: scanner.getStatus(),
    metadata: scanner.getMetadataStatus(),
  }));
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const storage = getStorageDetails();
    const jobs = jobManager.snapshot();
    return res.json({
      ok: true,
      catalog: getCatalogCounts(),
      storage,
      system: systemSnapshot({ tools }),
      streams: streamManager.snapshot(),
      scan: scanner.getStatus(),
      jobs: { active: jobs.active, recent: jobs.recent.slice(0, 8) },
      warnings: getWarnings(),
    });
  });
  app.get('/api/admin/system', requireAdmin, (_req, res) => res.json({ ok: true, system: systemSnapshot({ tools }) }));
  app.get('/api/admin/storage', requireAdmin, (_req, res) => res.json({ ok: true, storage: getStorageDetails() }));
  app.get('/api/admin/streams', requireAdmin, (_req, res) => res.json({ ok: true, streams: streamManager.snapshot() }));
  app.get('/api/admin/jobs', requireAdmin, (_req, res) => res.json({ ok: true, jobs: jobManager.snapshot() }));
  app.post('/api/admin/jobs/:id/cancel', requireAdmin, (req, res) => {
    if (!jobManager.cancel(req.params.id)) return res.status(404).json({ ok: false, error: 'Active job was not found.' });
    return res.json({ ok: true });
  });
  app.post('/api/admin/playback-markers/analyze', requireAdmin, (req, res) => {
    try {
      const result = introDetector.start({ force: !!req.body?.force });
      return res.status(result.started ? 202 : 409).json({ ok: result.started, ...result });
    } catch (err) {
      return res.status(503).json({ ok: false, error: err.message });
    }
  });
  app.get('/api/admin/playback-markers', requireAdmin, (_req, res) => {
    const library = getAdminLibraryTree();
    return res.json({ ok: true, shows: library.shows, fingerprintAvailable: !!tools.fingerprint?.available });
  });
  app.get('/api/admin/suggestions', requireAdmin, (_req, res) => res.json({ ok: true, suggestions: listMediaSuggestions() }));
  app.patch('/api/admin/suggestions/:id', requireAdmin, (req, res) => {
    if (!updateMediaSuggestionStatus(req.params.id, String(req.body?.status || ''))) return res.status(400).json({ ok: false, error: 'Invalid suggestion status.' });
    return res.json({ ok: true });
  });
  app.post('/api/admin/storage/backup', requireAdmin, (_req, res) => {
    try {
      return res.status(201).json({ ok: true, backup: createDatabaseBackup(BACKUP_DIR) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Database backup failed.' });
    }
  });
  app.delete('/api/admin/storage/hls-cache', requireAdmin, async (_req, res) => {
    try {
      await hlsManager.clearCache();
      return res.json({ ok: true });
    } catch (err) {
      return res.status(409).json({ ok: false, error: err.message });
    }
  });

  installTmdbRoutes(app);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((err, _req, res, _next) => {
    console.error('Request failed:', err.message);
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: 'Internal server error.' });
  });
  return {
    app,
    scanner,
    services: { hlsManager, introDetector, jobManager, streamManager, tools },
    startLibraryScan,
  };
}

async function readLegacyLibrary() {
  const candidates = [
    path.join(__dirname, 'library.json'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'my-media-app', 'library.json') : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(candidate, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      // Try the next legacy location.
    }
  }
  return [];
}

async function startServer(options = {}) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  migrateCatalogSchema();
  pruneExpiredSessions();
  const scanner = options.scanner || new MediaScanner({ moviesDir: MOVIES_DIR, tvShowsDir: TV_SHOWS_DIR });
  await scanner.importLegacyLibrary(await readLegacyLibrary());
  const created = createApp({ scanner });
  const { app } = created;
  const server = await new Promise((resolve) => {
    const listener = app.listen(PORT, '0.0.0.0', () => resolve(listener));
  });
  console.log(`MyFlix server running on http://localhost:${PORT}`);
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) console.log(`Network (${name}): http://${entry.address}:${PORT}/desktop`);
    }
  }
  if (SCAN_ON_STARTUP) created.startLibraryScan({ analyzeIntros: true });
  return { app, scanner, server, services: created.services };
}

let shuttingDown = false;
async function shutdown(server, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping MyFlix.`);
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
}

if (require.main === module) {
  startServer().then(({ server }) => {
    process.on('SIGTERM', () => shutdown(server, 'SIGTERM').then(() => process.exit(0)));
    process.on('SIGINT', () => shutdown(server, 'SIGINT').then(() => process.exit(0)));
  }).catch((err) => {
    console.error('MyFlix failed to start:', err.message);
    closeDatabase();
    process.exit(1);
  });
}

module.exports = { createApp, readLegacyLibrary, startServer };
