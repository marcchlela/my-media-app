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

test('native icon exports and source concepts are complete', () => {
  assert.equal(fs.existsSync(path.join(root, 'branding/icon-general.svg')), true);
  assert.equal(fs.existsSync(path.join(root, 'branding/icon-electric-lounge.svg')), true);
  assert.deepEqual(pngInfo('mobile-client/assets/icon-general-1024.png'), { width: 1024, height: 1024, colorType: 2 });
  assert.deepEqual(pngInfo('mobile-client/assets/icon-electric-lounge-1024.png'), { width: 1024, height: 1024, colorType: 2 });
  assert.deepEqual(pngInfo('mobile-client/assets/adaptive-icon-foreground.png').width, 1024);
  assert.deepEqual(pngInfo('mobile-client/assets/adaptive-icon-monochrome.png').height, 1024);

  const expoConfig = fs.readFileSync(path.join(root, 'mobile-client/app.config.ts'), 'utf8');
  assert.match(expoConfig, /MYFLIX_ICON_VARIANT/);
  assert.match(expoConfig, /icon-\$\{iconVariant\}-1024\.png/);
  assert.match(expoConfig, /iconVariant = process\.env\.MYFLIX_ICON_VARIANT === 'electric' \? 'electric-lounge' : 'general'/);
});

test('web manifest references valid production icon sizes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'MyFlix');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const info = pngInfo(icon.src.replace(/^\/web\//, 'web/'));
    assert.equal(`${info.width}x${info.height}`, icon.sizes);
  }
  assert.deepEqual(pngInfo('web/icons/apple-touch-icon.png').width, 180);
});
