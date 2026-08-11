import test from 'node:test';
import assert from 'node:assert/strict';
import { joinServerUrl, normalizeServerUrl } from './server-url';

test('normalizes LAN and private HTTPS MyFlix URLs', () => {
  assert.equal(normalizeServerUrl(' http://192.168.1.115:3000/ '), 'http://192.168.1.115:3000');
  assert.equal(normalizeServerUrl('https://chlela-bunker.example.ts.net/'), 'https://chlela-bunker.example.ts.net');
  assert.equal(joinServerUrl('https://host.example/base/', '/health'), 'https://host.example/base/health');
});

test('rejects malformed, credentialed, and non-HTTP server URLs', () => {
  assert.throws(() => normalizeServerUrl('chlela-bunker'), /complete HTTP or HTTPS/);
  assert.throws(() => normalizeServerUrl('ftp://example.com'), /HTTP or HTTPS/);
  assert.throws(() => normalizeServerUrl('https://user:pass@example.com'), /without credentials/);
  assert.throws(() => normalizeServerUrl('https://example.com/?token=secret'), /query parameters/);
});
