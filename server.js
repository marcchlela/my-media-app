const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  addFavoriteForUser,
  clearPosterOverrideForUser,
  createUserAccount,
  deleteSessionToken,
  getUserBySessionToken,
  loginUserAccount,
  mergeFavoritesForUser,
  mergePosterOverridesForUser,
  mergeWatchProgressForUser,
  removeFavoriteForUser,
  touchSessionToken,
  upsertPosterOverrideForUser,
  upsertWatchProgress,
} = require('./account-store');
const { resolveTmdbApiKey } = require('./env-config');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = 'my-media-app';
const MOBILE_DIR = path.join(__dirname, 'mobile');
const WEB_DESKTOP_DIR = path.join(__dirname, 'web');
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = resolveTmdbApiKey();
const SESSION_COOKIE_NAME = 'my_media_session';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.vob']);
const SUBTITLE_EXTS = new Set(['.srt', '.vtt']);

const mimeByExt = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.vob': 'video/dvd',
};

function isPrivateIPv4(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function shouldIgnoreInterface(name) {
  const lower = String(name || '').toLowerCase();
  return (
    lower.includes('virtual') ||
    lower.includes('vmware') ||
    lower.includes('vbox') ||
    lower.includes('vethernet') ||
    lower.includes('hyper-v') ||
    lower.includes('loopback')
  );
}

function getCandidateLibraryPaths() {
  const appData = process.env.APPDATA || '';
  return [
    path.join(__dirname, 'library.json'),
    appData ? path.join(appData, APP_NAME, 'library.json') : null,
  ].filter(Boolean);
}

async function loadLibrary() {
  const candidates = getCandidateLibraryPaths();
  const parsedCandidates = [];
  for (const candidate of candidates) {
    try {
      const data = await fs.promises.readFile(candidate, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const stats = await fs.promises.stat(candidate).catch(() => null);
        parsedCandidates.push({
          items: parsed,
          mtimeMs: stats?.mtimeMs || 0,
        });
      }
    } catch (err) {
      // Keep trying next location.
    }
  }
  if (!parsedCandidates.length) return [];
  parsedCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return parsedCandidates[0].items;
}

function parseCookies(headerValue) {
  const source = String(headerValue || '');
  const cookies = {};
  for (const pair of source.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getSessionTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const headerToken = String(req.headers['x-session-token'] || '').trim();
  if (headerToken) return headerToken;

  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || '';
}

function serializeCookie(name, value, maxAgeSeconds = null) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAgeSeconds !== null) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  return parts.join('; ');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, token, 60 * 60 * 24 * 30));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, '', 0));
}

function sanitizeLibraryItem(item, options = {}) {
  const includeWatchProgress = !!options.includeWatchProgress;
  const mediaId = createMediaId(item?.path);
  const subtitles = buildSubtitleEntries(item).map((subtitle, index) => ({
    name: subtitle.name,
    src: mediaId ? `/subtitle/${mediaId}/${index}` : null,
    language: subtitle.language,
  })).filter((sub) => !!sub?.src);

  return {
    id: mediaId,
    name: item?.name || '',
    path: item?.path || '',
    isShow: !!item?.isShow,
    tmdbId: Number.isFinite(Number(item?.data?.id)) ? Number(item.data.id) : null,
    showKey: item?.showKey || null,
    showName: item?.showName || null,
    episode: item?.episode || null,
    posterPath: item?.customPosterTmdbPath || item?.data?.poster_path || null,
    customPosterTmdbPath: item?.customPosterTmdbPath || null,
    backdropPath: item?.data?.backdrop_path || null,
    title: item?.data?.title || item?.data?.name || item?.name || '',
    streamUrl: mediaId ? `/video/${mediaId}` : null,
    mimeType: getVideoMimeType(item?.path || ''),
    releaseDate: item?.data?.release_date || item?.data?.first_air_date || null,
    rating: Number.isFinite(item?.data?.vote_average) ? item.data.vote_average : null,
    runtime: Number.isFinite(item?.movieExtras?.details?.runtime)
      ? item.movieExtras.details.runtime
      : (Array.isArray(item?.data?.episode_run_time) && Number.isFinite(item.data.episode_run_time[0])
        ? item.data.episode_run_time[0]
        : null),
    genreIds: Array.isArray(item?.data?.genre_ids) ? item.data.genre_ids : [],
    genreNames: Array.isArray(item?.movieExtras?.details?.genres)
      ? item.movieExtras.details.genres.map((genre) => genre?.name).filter(Boolean)
      : (Array.isArray(item?.data?.genres)
        ? item.data.genres.map((genre) => genre?.name).filter(Boolean)
        : []),
    isFavorite: !!item?.isFavorite,
    watchProgress: includeWatchProgress ? (item?.watchProgress || null) : null,
    subtitles,
  };
}

function createMediaId(filePath) {
  if (!filePath) return null;
  return crypto.createHash('sha1').update(String(filePath)).digest('hex').slice(0, 16);
}

function buildSubtitleEntries(item) {
  if (!Array.isArray(item?.subtitles)) return [];
  return item.subtitles
    .map((subtitle) => {
      const sourcePath = subtitle?.trackPath || subtitle?.path;
      const ext = path.extname(sourcePath || '').toLowerCase();
      if (!sourcePath || !SUBTITLE_EXTS.has(ext)) return null;
      return {
        name: subtitle?.name || path.basename(sourcePath),
        language: subtitle?.language || 'en',
        sourcePath,
      };
    })
    .filter(Boolean);
}

function getVideoMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return mimeByExt[ext] || 'application/octet-stream';
}

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;

  const [startRaw, endRaw] = rangeHeader.replace('bytes=', '').split('-');
  let start;
  let end;

  // Example: bytes=500-999
  if (startRaw && endRaw) {
    start = Number.parseInt(startRaw, 10);
    end = Number.parseInt(endRaw, 10);
  }

  // Example: bytes=500-
  if (startRaw && !endRaw) {
    start = Number.parseInt(startRaw, 10);
    end = fileSize - 1;
  }

  // Example: bytes=-500 (last 500 bytes)
  if (!startRaw && endRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= fileSize || start > end) return null;

  return { start, end };
}

function srtToVttContent(content) {
  const normalized = String(content || '').replace(/\r/g, '');
  const convertedTiming = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2'
  );
  return `WEBVTT\n\n${convertedTiming}`;
}

async function findMediaItemById(mediaId) {
  const library = await loadLibrary();
  for (const item of library) {
    if (createMediaId(item?.path) === mediaId) return item;
  }
  return null;
}

async function serveVideoFile(filePath, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Unsupported video format.' });
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return res.sendStatus(404);
    }

    const fileSize = stat.size;
    const mimeType = getVideoMimeType(filePath);
    const range = parseRangeHeader(req.headers.range, fileSize);

    if (!range && req.headers.range) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }

    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Video streaming failed:', err.message);
    res.sendStatus(404);
  }
}

async function serveSubtitleFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUBTITLE_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Unsupported subtitle format.' });
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return res.sendStatus(404);

    if (ext === '.vtt') {
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const srt = await fs.promises.readFile(filePath, 'utf-8');
    const vtt = srtToVttContent(srt);
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
    res.end(vtt);
  } catch (err) {
    console.error('Subtitle serving failed:', err.message);
    res.sendStatus(404);
  }
}

function requireTmdbKey(res) {
  if (!TMDB_API_KEY) {
    res.status(503).json({
      error: 'TMDB key not configured on server.',
      hint: 'Set TMDB_API_KEY in environment or in a local .env file before starting server.',
    });
    return false;
  }
  return true;
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function tmdbGet(endpoint, query = {}) {
  const url = new URL(`${TMDB_API_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString());
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data?.status_message || `TMDB request failed with ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    req.account = null;
    next();
    return;
  }

  const user = getUserBySessionToken(token);
  if (!user) {
    req.account = null;
    next();
    return;
  }

  touchSessionToken(token);
  req.account = { token, user };
  next();
});
app.use('/mobile', express.static(MOBILE_DIR));
app.use('/web', express.static(WEB_DESKTOP_DIR));

app.get('/api/account/me', (req, res) => {
  res.json({
    ok: true,
    authenticated: !!req.account?.user,
    user: req.account?.user || null,
  });
});

app.post('/api/account/signup', (req, res) => {
  const result = createUserAccount(req.body || {});
  if (!result.ok) {
    return res.status(400).json(result);
  }

  setSessionCookie(res, result.sessionToken);
  return res.status(201).json({
    ok: true,
    user: result.user,
    sessionToken: result.sessionToken,
  });
});

app.post('/api/account/login', (req, res) => {
  const result = loginUserAccount(req.body || {});
  if (!result.ok) {
    return res.status(400).json(result);
  }

  setSessionCookie(res, result.sessionToken);
  return res.json({
    ok: true,
    user: result.user,
    sessionToken: result.sessionToken,
  });
});

app.post('/api/account/logout', (req, res) => {
  if (req.account?.token) {
    deleteSessionToken(req.account.token);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/account/progress', (req, res) => {
  if (!req.account?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  const saved = upsertWatchProgress(req.account.user.id, req.body || {});
  if (!saved) {
    return res.status(400).json({ ok: false, error: 'Invalid progress payload.' });
  }

  return res.json({
    ok: true,
    watchProgress: saved,
  });
});

app.post('/api/account/favorite', (req, res) => {
  if (!req.account?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  const saved = addFavoriteForUser(req.account.user.id, req.body || {});
  if (!saved) {
    return res.status(400).json({ ok: false, error: 'Invalid favorite payload.' });
  }

  return res.json({ ok: true });
});

app.delete('/api/account/favorite', (req, res) => {
  if (!req.account?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  removeFavoriteForUser(req.account.user.id, req.body || {});
  return res.json({ ok: true });
});

app.post('/api/account/poster', (req, res) => {
  if (!req.account?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  const saved = upsertPosterOverrideForUser(req.account.user.id, req.body || {});
  if (!saved) {
    return res.status(400).json({ ok: false, error: 'Invalid poster payload.' });
  }

  return res.json({ ok: true });
});

app.delete('/api/account/poster', (req, res) => {
  if (!req.account?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  clearPosterOverrideForUser(req.account.user.id, req.body || {});
  return res.json({ ok: true });
});

app.get('/api/tmdb/health', (_req, res) => {
  res.json({ configured: !!TMDB_API_KEY });
});

app.get('/api/tmdb/movie/search', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q".' });
  try {
    const data = await tmdbGet('/search/movie', { query: q });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/tv/search', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q".' });
  try {
    const data = await tmdbGet('/search/tv', { query: q });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/movie/:id', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid movie id.' });
  try {
    const data = await tmdbGet(`/movie/${id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/movie/:id/credits', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid movie id.' });
  try {
    const data = await tmdbGet(`/movie/${id}/credits`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/movie/:id/videos', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid movie id.' });
  try {
    const data = await tmdbGet(`/movie/${id}/videos`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/tv/:id', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid show id.' });
  try {
    const data = await tmdbGet(`/tv/${id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/tv/:id/credits', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid show id.' });
  try {
    const data = await tmdbGet(`/tv/${id}/credits`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/api/tmdb/tv/:id/season/:season/episode/:episode', async (req, res) => {
  if (!requireTmdbKey(res)) return;
  const id = toPositiveInt(req.params.id);
  const season = toPositiveInt(req.params.season);
  const episode = toPositiveInt(req.params.episode);
  if (!id || !season || !episode) {
    return res.status(400).json({ error: 'Invalid show/season/episode id.' });
  }

  try {
    const data = await tmdbGet(`/tv/${id}/season/${season}/episode/${episode}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json(err.payload || { error: err.message });
  }
});

app.get('/', async (_req, res) => {
  let libraryCount = 0;
  try {
    libraryCount = (await loadLibrary()).length;
  } catch (err) {
    // ignore, this is only display data
  }
  const tmdbConfigured = !!TMDB_API_KEY;

  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My Media Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; background: #111; color: #eee; }
          .card { max-width: 680px; border: 1px solid #333; border-radius: 12px; padding: 16px; background: #181818; }
          a { color: #6bb6ff; }
          code { background: #222; padding: 2px 6px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>My Media Server</h2>
          <p>Server is running.</p>
          <p>Library items found: <strong>${libraryCount}</strong></p>
          <p>TMDB configured: <strong>${tmdbConfigured ? 'Yes' : 'No'}</strong></p>
          <p>Try: <a href="/health">/health</a> and <a href="/library">/library</a></p>
          <p>Mobile app: <a href="/mobile">/mobile</a></p>
          <p>Desktop web app: <a href="/desktop">/desktop</a></p>
          <p>TMDB proxy status: <a href="/api/tmdb/health">/api/tmdb/health</a></p>
          <p>Video endpoint: <code>/video/MEDIA_ID</code> (legacy: <code>/video?path=...</code>)</p>
        </div>
      </body>
    </html>
  `);
});

app.get('/mobile', (_req, res) => {
  res.sendFile(path.join(MOBILE_DIR, 'index.html'));
});

// Backward-compatible route for old links.
app.get('/app', (_req, res) => {
  res.redirect(302, '/mobile');
});

app.get('/desktop', (_req, res) => {
  res.sendFile(path.join(WEB_DESKTOP_DIR, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/library', async (req, res) => {
  try {
    let library = await loadLibrary();
    const includeWatchProgress = !!req.account?.user?.id;
    if (req.account?.user?.id) {
      library = mergeWatchProgressForUser(library, req.account.user.id);
      library = mergePosterOverridesForUser(library, req.account.user.id);
      library = mergeFavoritesForUser(library, req.account.user.id);
    }
    res.json(library.map((item) => sanitizeLibraryItem(item, { includeWatchProgress })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load library.' });
  }
});

app.get('/video/:id', async (req, res) => {
  const mediaId = String(req.params.id || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'Missing media id.' });

  const item = await findMediaItemById(mediaId);
  if (!item?.path) return res.sendStatus(404);

  return serveVideoFile(item.path, req, res);
});

// Backward-compatible route for old clients.
app.get('/video', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Missing "path" query parameter.' });
  }
  return serveVideoFile(filePath, req, res);
});

app.get('/subtitle/:id/:index', async (req, res) => {
  const mediaId = String(req.params.id || '').trim();
  const index = Number.parseInt(String(req.params.index), 10);
  if (!mediaId || !Number.isFinite(index) || index < 0) {
    return res.status(400).json({ error: 'Invalid subtitle identifier.' });
  }

  const item = await findMediaItemById(mediaId);
  if (!item) return res.sendStatus(404);

  const subtitles = buildSubtitleEntries(item);
  const target = subtitles[index];
  if (!target?.sourcePath) return res.sendStatus(404);

  return serveSubtitleFile(target.sourcePath, res);
});

// Backward-compatible route for old clients.
app.get('/subtitle', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Missing "path" query parameter.' });
  }
  return serveSubtitleFile(filePath, res);
});

app.use((_req, res) => {
  res.status(404).json({
    error: 'Route not found',
    routes: [
      '/',
      '/mobile',
      '/app',
      '/desktop',
      '/health',
      '/library',
      '/video/MEDIA_ID',
      '/video?path=FULL_FILE_PATH',
      '/subtitle/MEDIA_ID/INDEX',
      '/subtitle?path=FULL_SUBTITLE_PATH',
      '/api/tmdb/health',
      '/api/tmdb/movie/search?q=NAME',
      '/api/tmdb/tv/search?q=NAME',
      '/api/account/me',
      '/api/account/signup',
      '/api/account/login',
      '/api/account/logout',
      '/api/account/progress',
    ],
  });
});

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  const preferredIps = [];

  for (const [ifaceName, values] of Object.entries(nets)) {
    for (const net of values || []) {
      if (net.family === 'IPv4' && !net.internal && !shouldIgnoreInterface(ifaceName)) {
        ips.push({ ip: net.address, ifaceName });
        if (isPrivateIPv4(net.address)) {
          preferredIps.push({ ip: net.address, ifaceName });
        }
      }
    }
  }

  console.log(`Server running on http://localhost:${PORT}`);
  const outputIps = preferredIps.length ? preferredIps : ips;
  for (const item of outputIps) {
    console.log(`Phone URL (${item.ifaceName}): http://${item.ip}:${PORT}`);
  }
});
