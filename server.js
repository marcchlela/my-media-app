const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  closeDatabase,
  createUserAccount,
  deleteSessionToken,
  getUserBySessionToken,
  loginUserAccount,
  pruneExpiredSessions,
  touchSessionToken,
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
const {
  getCatalogCounts,
  getMediaSources,
  getMimeType,
  getPrivateMedia,
  getPrivateSubtitle,
  getPublicLibrary,
  migrateCatalogSchema,
  saveMediaProgress,
  setMediaFavorite,
  setMediaPosterOverride,
  updateAdminMetadata,
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
const MOBILE_DIR = path.join(__dirname, 'mobile');
const WEB_DIR = path.join(__dirname, 'web');
const SUBTITLE_CACHE_DIR = path.join(DATA_DIR, 'cache', 'subtitles');
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = resolveTmdbApiKey();

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
    ['/api/tmdb/tv/:id', (id) => `/tv/${id}`],
    ['/api/tmdb/tv/:id/credits', (id) => `/tv/${id}/credits`],
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
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use((req, _res, next) => {
    const token = getSessionToken(req);
    const user = token ? getUserBySessionToken(token) : null;
    if (user) touchSessionToken(token);
    req.account = user ? { token, user } : null;
    next();
  });
  app.use('/mobile', express.static(MOBILE_DIR, { fallthrough: true, maxAge: NODE_ENV === 'production' ? '1h' : 0 }));
  app.use('/web', express.static(WEB_DIR, { fallthrough: true, maxAge: NODE_ENV === 'production' ? '1h' : 0 }));

  app.get('/', (_req, res) => {
    const counts = getCatalogCounts();
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyFlix Server</title></head><body><h1>MyFlix</h1><p>Server ready.</p><p>${counts.movies} movies, ${counts.shows} shows, ${counts.episodes} episodes.</p><p><a href="/desktop">Desktop</a> | <a href="/mobile">Mobile</a> | <a href="/health">Health</a></p></body></html>`);
  });
  app.get('/desktop', (_req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
  app.get('/mobile', (_req, res) => res.sendFile(path.join(MOBILE_DIR, 'index.html')));
  app.get('/app', (_req, res) => res.redirect(302, '/mobile'));

  app.get('/health', (_req, res) => {
    try {
      const counts = getCatalogCounts();
      return res.json({ ok: true, database: true, catalog: counts, mediaSources: safeSourceStatus() });
    } catch (err) {
      return res.status(503).json({ ok: false, database: false });
    }
  });

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
  app.delete('/api/account/poster', requireAccount, (req, res) => {
    if (!setMediaPosterOverride(req.account.user.id, req.body || {}, false)) return res.status(400).json({ ok: false, error: 'Invalid poster override.' });
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

  if (LEGACY_PATH_ROUTES) {
    app.get('/video', requireAdmin, async (req, res) => {
      const filePath = String(req.query.path || '');
      if (![MOVIES_DIR, TV_SHOWS_DIR].some((root) => isPathInsideRoot(filePath, root))) return res.status(403).json({ error: 'Path is outside media roots.' });
      return serveMediaFile(filePath, null, req, res);
    });
  }

  app.post('/api/admin/library/scan', requireAdmin, (req, res) => {
    if (scanner.getStatus().running) return res.status(409).json({ ok: false, error: 'A library scan is already running.', status: scanner.getStatus() });
    scanner.scan().catch((err) => console.error('Library scan failed:', err.message));
    return res.status(202).json({ ok: true, status: scanner.getStatus() });
  });
  app.get('/api/admin/library/scan/status', requireAdmin, (_req, res) => res.json({ ok: true, status: scanner.getStatus() }));
  app.patch('/api/admin/media/:id/metadata', requireAdmin, (req, res) => {
    if (!updateAdminMetadata(String(req.params.id || ''), req.body || {})) return res.status(404).json({ ok: false, error: 'Media item not found.' });
    return res.json({ ok: true });
  });
  app.get('/api/admin/status', requireAdmin, (_req, res) => res.json({
    ok: true,
    catalog: getCatalogCounts(),
    mediaSources: safeSourceStatus(),
    scan: scanner.getStatus(),
  }));

  installTmdbRoutes(app);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((err, _req, res, _next) => {
    console.error('Request failed:', err.message);
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: 'Internal server error.' });
  });
  return { app, scanner };
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
  const { app } = createApp({ scanner });
  const server = await new Promise((resolve) => {
    const listener = app.listen(PORT, '0.0.0.0', () => resolve(listener));
  });
  console.log(`MyFlix server running on http://localhost:${PORT}`);
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) console.log(`Network (${name}): http://${entry.address}:${PORT}/desktop`);
    }
  }
  if (SCAN_ON_STARTUP) scanner.scan().catch((err) => console.error('Startup scan failed:', err.message));
  return { app, scanner, server };
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
