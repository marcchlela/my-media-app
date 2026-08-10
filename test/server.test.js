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
  const created = createApp({ scanner });
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

test('cross-origin requests are denied unless configured', async () => {
  const response = await fetch(`${baseUrl}/api/library`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
});
