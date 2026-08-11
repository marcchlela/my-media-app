const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function pngInfo(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

test('brand source concepts and full-size exports are complete', () => {
  assert.equal(fs.existsSync(path.join(root, 'branding/icons/icon-general.svg')), true);
  assert.equal(fs.existsSync(path.join(root, 'branding/icons/icon-electric-lounge.svg')), true);
  assert.deepEqual(pngInfo('branding/icons/icon-general-1024.png'), { width: 1024, height: 1024, colorType: 2 });
  assert.deepEqual(pngInfo('branding/icons/icon-electric-lounge-1024.png'), { width: 1024, height: 1024, colorType: 2 });
});

test('web Add to Home Screen manifest and icons are complete', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'MyFlix');
  assert.equal(manifest.short_name, 'MyFlix');
  assert.equal(manifest.id, '/mobile');
  assert.equal(manifest.start_url, '/mobile');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#100b0b');
  assert.equal(manifest.background_color, '#100b0b');
  for (const icon of manifest.icons) {
    const info = pngInfo(icon.src.replace(/^\/web\//, 'web/'));
    assert.equal(`${info.width}x${info.height}`, icon.sizes);
  }
  assert.deepEqual(pngInfo('web/icons/apple-touch-icon.png').width, 180);
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  assert.match(html, /name="viewport"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/);
  assert.match(html, /rel="manifest"[^>]+manifest\.webmanifest/);
});

test('production Docker context excludes development-only assets', () => {
  const dockerIgnore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
  assert.equal(dockerIgnore.includes('test'), true);
  assert.equal(dockerIgnore.includes('myflix-cinema-designs-v2'), true);
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /ffmpeg/);
  assert.match(dockerfile, /libchromaprint-tools/);
});
