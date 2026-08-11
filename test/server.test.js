const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myflix-server-test-'));
const movies = path.join(root, 'Movies');
const tv = path.join(root, 'TV Shows');
fs.mkdirSync(movies, { recursive: true });
fs.mkdirSync(tv, { recursive: true });
fs.writeFileSync(path.join(movies, 'Range.Test.mp4'), Buffer.alloc(128, 7));
process.env.DATA_DIR = path.join(root, 'data');
process.env.MOVIES_DIR = movies;
process.env.TV_SHOWS_DIR = tv;
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.ALLOW_SIGNUP = 'true';
process.env.SCAN_ON_STARTUP = 'false';
process.env.TMDB_API_KEY = '';

const { closeDatabase } = require('../account-store');
const { MediaScanner } = require('../media-scanner');
const { createApp } = require('../server');

let server;
let baseUrl;
let normalSessionToken;
let adminSessionToken;

test.before(async () => {
  const scanner = new MediaScanner({
    moviesDir: movies,
    tvShowsDir: tv,
    tmdb: { configured: false },
    inspectMedia: async () => ({ durationSeconds: 60, width: 1280, height: 720 }),
  });
  await scanner.scan();
  const created = createApp({
    scanner,
    tools: {
      ffmpeg: { available: false, path: 'ffmpeg' },
      fingerprint: { available: false, path: 'fpcalc' },
      encoders: { software: false, intelQsv: false, nvidiaNvenc: false, vaapi: false },
      gpuDeviceAvailable: false,
      recommendedEncoder: 'libx264',
    },
  });
  server = await new Promise((resolve) => {
    const listener = created.app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

test('health and library responses are safe', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const library = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  assert.equal(library.length, 1);
  assert.equal(Object.hasOwn(library[0], 'path'), false);
  assert.equal(JSON.stringify(library).includes(root), false);
});

test('public capabilities expose client-safe playback support', async () => {
  const response = await fetch(`${baseUrl}/api/capabilities`);
  const capabilities = await response.json();
  assert.equal(response.status, 200);
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.hlsAvailable, false);
  assert.equal(capabilities.playback.default, 'direct');
  assert.equal(capabilities.playback.compatibilityFallback, false);
  assert.equal(typeof capabilities.serverVersion, 'string');
  assert.equal(JSON.stringify(capabilities).includes(root), false);
});

test('HLS API forwards compatibility, adaptive, and manual mode requests', async () => {
  const starts = [];
  const statuses = [];
  const fakeHlsManager = {
    playbackOptions: () => ({ directPlay: true, hlsAvailable: true, qualities: [{ label: '720p', height: 720 }] }),
    start: (item, input) => {
      starts.push({ mediaId: item.id, ...input });
      const mode = input.mode || 'adaptive';
      const cacheKey = mode === 'manual' ? `manual-${input.quality}` : mode === 'compatibility' ? 'compatibility-720' : 'adaptive';
      return { state: 'ready', progress: 100, mode, cacheKey, qualities: mode === 'adaptive' ? ['720p', '480p', '360p'] : ['720p'], masterUrl: `/api/media/${item.id}/hls/${cacheKey}/master.m3u8` };
    },
    getStatus: (mediaId, input) => {
      statuses.push({ mediaId, ...input });
      return { state: 'ready', progress: 100, cacheKey: input.cacheKey, masterUrl: `/api/media/${mediaId}/hls/${input.cacheKey}/master.m3u8` };
    },
    resolveAsset: () => null,
    clearCache: async () => {},
  };
  const created = createApp({
    scanner: { getStatus: () => ({ state: 'idle' }), getSources: () => [] },
    hlsManager: fakeHlsManager,
    tools: {
      ffmpeg: { available: true, path: 'ffmpeg' }, fingerprint: { available: false, path: 'fpcalc' },
      encoders: {}, gpuDeviceAvailable: false, recommendedEncoder: 'libx264',
    },
  });
  const listener = await new Promise((resolve) => {
    const instance = created.app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${listener.address().port}`;
  try {
    const [item] = await fetch(`${url}/api/library`).then((response) => response.json());
    for (const body of [{ mode: 'compatibility' }, { mode: 'adaptive' }, { mode: 'manual', quality: 720 }]) {
      const response = await fetch(`${url}/api/media/${item.id}/hls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
    }
    const status = await fetch(`${url}/api/media/${item.id}/hls/status?cacheKey=compatibility-720`);
    assert.equal(status.status, 200);
    assert.deepEqual(starts.map(({ mode, quality }) => ({ mode, quality })), [
      { mode: 'compatibility', quality: undefined },
      { mode: 'adaptive', quality: undefined },
      { mode: 'manual', quality: 720 },
    ]);
    assert.equal(statuses[0].cacheKey, 'compatibility-720');
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test('mobile and desktop serve the same responsive Electric Lounge client', async () => {
  const [desktop, mobile] = await Promise.all([
    fetch(`${baseUrl}/desktop`).then((response) => response.text()),
    fetch(`${baseUrl}/mobile`).then((response) => response.text()),
  ]);
  assert.equal(mobile, desktop);
  assert.match(mobile, /electric-lounge/);
  assert.match(mobile, /app\.js/);
});

test('ID streaming supports Range and rejects legacy path routes', async () => {
  const [item] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const response = await fetch(`${baseUrl}${item.streamUrl}`, { headers: { Range: 'bytes=5-14' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  assert.equal((await fetch(`${baseUrl}/video?path=${encodeURIComponent(path.join(movies, 'Range.Test.mp4'))}`)).status, 404);
});

test('admin scan APIs enforce account permissions', async () => {
  const signup = async (email) => fetch(`${baseUrl}/api/account/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'User', email, password: 'strong-pass-123', confirmPassword: 'strong-pass-123' }),
  }).then((response) => response.json());
  const normal = await signup('viewer@example.com');
  const admin = await signup('admin@example.com');
  normalSessionToken = normal.sessionToken;
  adminSessionToken = admin.sessionToken;
  assert.equal(normal.user.isAdmin, false);
  assert.equal(admin.user.isAdmin, true);
  const denied = await fetch(`${baseUrl}/api/admin/library/scan/status`, { headers: { Authorization: `Bearer ${normal.sessionToken}` } });
  const allowed = await fetch(`${baseUrl}/api/admin/library/scan/status`, { headers: { Authorization: `Bearer ${admin.sessionToken}` } });
  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
});

test('metadata management endpoints are admin-only', async () => {
  const [item] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const path = `/api/admin/metadata/search?type=movie&id=${encodeURIComponent(item.id)}&q=Range%20Test`;
  const anonymous = await fetch(`${baseUrl}${path}`);
  const denied = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${normalSessionToken}` } });
  const admin = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${adminSessionToken}` } });
  const metadataStatus = await fetch(`${baseUrl}/api/admin/library/metadata/status`, {
    headers: { Authorization: `Bearer ${adminSessionToken}` },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(denied.status, 403);
  assert.equal(admin.status, 503);
  assert.equal(metadataStatus.status, 200);
});

test('signed-in users can update their profile name', async () => {
  const response = await fetch(`${baseUrl}/api/account/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${normalSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ firstName: 'Updated', lastName: 'Viewer' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.user.fullName, 'Updated Viewer');
  assert.equal(payload.user.email, 'viewer@example.com');
});

test('account password changes and viewing statistics are account-scoped', async () => {
  const [movie] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const progress = await fetch(`${baseUrl}/api/account/progress`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaId: movie.id, position: 30, duration: 60 }),
  });
  assert.equal(progress.status, 200);

  const statsResponse = await fetch(`${baseUrl}/api/account/stats`, {
    headers: { Authorization: `Bearer ${normalSessionToken}` },
  });
  const stats = await statsResponse.json();
  assert.equal(statsResponse.status, 200);
  assert.equal(stats.stats.watchedSeconds, 30);
  assert.equal(stats.stats.moviesWatched, 0);

  const change = await fetch(`${baseUrl}/api/account/password`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${normalSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      currentPassword: 'strong-pass-123',
      newPassword: 'even-stronger-pass-456',
      confirmPassword: 'even-stronger-pass-456',
    }),
  });
  assert.equal(change.status, 200);

  const login = (password) => fetch(`${baseUrl}/api/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@example.com', password }),
  });
  assert.equal((await login('strong-pass-123')).status, 401);
  assert.equal((await login('even-stronger-pass-456')).status, 200);
});

test('TMDB poster image routes are installed', async () => {
  const movie = await fetch(`${baseUrl}/api/tmdb/movie/1/images`);
  const show = await fetch(`${baseUrl}/api/tmdb/tv/1/images`);
  assert.notEqual(movie.status, 404);
  assert.notEqual(show.status, 404);
});

test('custom poster uploads are account-scoped and resettable', async () => {
  const [movie] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = await fetch(`${baseUrl}/api/account/poster-upload?type=movie&id=${encodeURIComponent(movie.id)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalSessionToken}`,
      'Content-Type': 'image/png',
    },
    body: png,
  });
  const payload = await upload.json();
  assert.equal(upload.status, 200);
  assert.match(payload.posterPath, /^\/api\/account\/poster-file\//);
  const poster = await fetch(`${baseUrl}${payload.posterPath}`, {
    headers: { Authorization: `Bearer ${normalSessionToken}` },
  });
  assert.equal(poster.status, 200);

  const reset = await fetch(`${baseUrl}/api/account/poster`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${normalSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaId: movie.id }),
  });
  assert.equal(reset.status, 200);
});

test('catalog management is admin-only and visibility is reversible', async () => {
  const denied = await fetch(`${baseUrl}/api/admin/library/manage`, {
    headers: { Authorization: `Bearer ${normalSessionToken}` },
  });
  const allowed = await fetch(`${baseUrl}/api/admin/library/manage`, {
    headers: { Authorization: `Bearer ${adminSessionToken}` },
  });
  const payload = await allowed.json();
  const movie = payload.library.movies[0];
  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
  assert.ok(movie.id);

  const setVisibility = (hidden) => fetch(`${baseUrl}/api/admin/library/visibility`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scope: 'movie', id: movie.id, hidden }),
  });
  assert.equal((await setVisibility(true)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/library`).then((response) => response.json())).length, 0);
  assert.equal((await setVisibility(false)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/library`).then((response) => response.json())).length, 1);
});

test('playback quality options preserve direct play when FFmpeg is unavailable', async () => {
  const [movie] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const optionsResponse = await fetch(`${baseUrl}/api/media/${movie.id}/playback-options`);
  const options = await optionsResponse.json();
  assert.equal(optionsResponse.status, 200);
  assert.equal(options.directPlay, true);
  assert.equal(options.hlsAvailable, false);
  assert.deepEqual(options.qualities.map((quality) => quality.label), ['720p', '480p', '360p']);
  const hls = await fetch(`${baseUrl}/api/media/${movie.id}/hls`, { method: 'POST' });
  assert.equal(hls.status, 503);
});

test('stream heartbeats appear only in the admin stream monitor', async () => {
  const [movie] = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
  const heartbeat = await fetch(`${baseUrl}/api/playback/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${normalSessionToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaId: movie.id, title: movie.title, mode: 'direct', quality: 'Original', position: 12, duration: 60 }),
  }).then((response) => response.json());
  assert.match(heartbeat.sessionId, /^stream_/);
  await fetch(`${baseUrl}/api/playback/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${normalSessionToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: heartbeat.sessionId, mediaId: movie.id, title: movie.title, mode: 'hls-fallback', quality: '720p', position: 15, duration: 60 }),
  });
  assert.equal((await fetch(`${baseUrl}/api/admin/streams`, { headers: { Authorization: `Bearer ${normalSessionToken}` } })).status, 403);
  const admin = await fetch(`${baseUrl}/api/admin/streams`, { headers: { Authorization: `Bearer ${adminSessionToken}` } }).then((response) => response.json());
  assert.equal(admin.streams.length, 1);
  assert.equal(admin.streams[0].userName, 'Updated Viewer');
  assert.equal(admin.streams[0].mode, 'hls-fallback');
  assert.equal(admin.streams[0].quality, '720p');
});

test('title suggestions are account-scoped and reviewable by administrators', async () => {
  const submitted = await fetch(`${baseUrl}/api/account/suggestions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${normalSessionToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', title: 'Example Feature', tmdbId: 123, posterPath: '/poster.jpg', releaseDate: '2026-01-01' }),
  });
  assert.equal(submitted.status, 201);
  const mine = await fetch(`${baseUrl}/api/account/suggestions`, { headers: { Authorization: `Bearer ${normalSessionToken}` } }).then((response) => response.json());
  assert.equal(mine.suggestions.length, 1);
  assert.equal(mine.suggestions[0].title, 'Example Feature');
  assert.equal((await fetch(`${baseUrl}/api/admin/suggestions`, { headers: { Authorization: `Bearer ${normalSessionToken}` } })).status, 403);
  const admin = await fetch(`${baseUrl}/api/admin/suggestions`, { headers: { Authorization: `Bearer ${adminSessionToken}` } }).then((response) => response.json());
  const suggestion = admin.suggestions.find((entry) => entry.title === 'Example Feature');
  assert.ok(suggestion);
  const approved = await fetch(`${baseUrl}/api/admin/suggestions/${suggestion.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminSessionToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approved.status, 200);
});

test('admin overview is protected and reports server capabilities', async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/overview`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/overview`, { headers: { Authorization: `Bearer ${normalSessionToken}` } })).status, 403);
  const response = await fetch(`${baseUrl}/api/admin/overview`, { headers: { Authorization: `Bearer ${adminSessionToken}` } });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.system.tools.ffmpeg.available, false);
  assert.ok(Array.isArray(payload.warnings));
  assert.ok(payload.storage.database.sizeBytes > 0);
});

test('cross-origin requests are denied unless configured', async () => {
  const response = await fetch(`${baseUrl}/api/library`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
});
