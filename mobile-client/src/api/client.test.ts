import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection, MyFlixApi } from './client';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('connection check verifies health, capabilities, and account API', async () => {
  const visited: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    visited.push(url);
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/api/capabilities')) return json({ ok: true, serverVersion: '1', hlsAvailable: true, ffmpegAvailable: true, signupAllowed: true, authRequired: false, playback: { default: 'direct', compatibilityFallback: true } });
    return json({ ok: true, authenticated: false, user: null, allowSignup: true });
  };
  const result = await checkConnection('http://localhost:3000/', fetchImpl as typeof fetch);
  assert.equal(result.serverUrl, 'http://localhost:3000');
  assert.deepEqual(visited.sort(), ['http://localhost:3000/api/account/me', 'http://localhost:3000/api/capabilities', 'http://localhost:3000/health'].sort());
});

test('API client sends bearer auth and stable favorite/progress payloads', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const api = new MyFlixApi({
    getServerUrl: () => 'https://myflix.test',
    getToken: () => 'session-token',
    fetchImpl: (async (input, init) => { requests.push({ url: String(input), init }); return json({ ok: true }); }) as typeof fetch,
  });
  await api.setFavorite({ isShow: false, mediaId: 'media_1' }, true);
  await api.saveProgress({ mediaId: 'media_1', position: 20, duration: 100, percent: 20, updatedAt: 4 });
  assert.equal(new Headers(requests[0]?.init?.headers).get('Authorization'), 'Bearer session-token');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { isShow: false, mediaId: 'media_1' });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { mediaId: 'media_1', position: 20, duration: 100, percent: 20, updatedAt: 4 });
});

test('expired bearer sessions invoke centralized unauthorized handling', async () => {
  let cleared = 0;
  const api = new MyFlixApi({
    getServerUrl: () => 'https://myflix.test',
    getToken: () => 'expired',
    onUnauthorized: () => { cleared += 1; },
    fetchImpl: (async () => json({ error: 'Session expired.' }, 401)) as typeof fetch,
  });
  await assert.rejects(api.library(), /Session expired/);
  assert.equal(cleared, 1);
});
