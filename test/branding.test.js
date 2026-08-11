const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');

function pngInfo(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  assert.equal(bitDepth, 8, `${relativePath} must use 8-bit channels`);
  assert.ok(colorType === 2 || colorType === 6, `${relativePath} must be RGB or RGBA`);
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(compressed));
  assert.equal(inflated.length, height * (rowBytes + 1));
  const pixels = Buffer.alloc(width * height * channels);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[rowOffset + x - rowBytes] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset + x - rowBytes - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      else assert.equal(filter, 0, `${relativePath} uses unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return { width, height, channels, pixels };
}

function artworkStats(image) {
  const pixelAt = (x, y) => {
    const offset = ((y * image.width) + x) * image.channels;
    return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
  };
  const inset = Math.max(1, Math.floor(image.width * 0.04));
  const corners = [
    pixelAt(inset, inset),
    pixelAt(image.width - inset - 1, inset),
    pixelAt(inset, image.height - inset - 1),
    pixelAt(image.width - inset - 1, image.height - inset - 1),
  ];
  const background = [0, 1, 2].map((channel) => (
    corners.reduce((total, color) => total + color[channel], 0) / corners.length
  ));
  const colorDistance = (color) => Math.hypot(
    color[0] - background[0], color[1] - background[1], color[2] - background[2],
  );
  let minimumLuminance = 255;
  let maximumLuminance = 0;
  let centerSamples = 0;
  let centerArtwork = 0;
  const colors = new Set();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const color = pixelAt(x, y);
      const luminance = (0.2126 * color[0]) + (0.7152 * color[1]) + (0.0722 * color[2]);
      minimumLuminance = Math.min(minimumLuminance, luminance);
      maximumLuminance = Math.max(maximumLuminance, luminance);
      colors.add(`${color[0] >> 4},${color[1] >> 4},${color[2] >> 4}`);
      const insideCenter = x >= image.width * 0.2 && x < image.width * 0.8
        && y >= image.height * 0.2 && y < image.height * 0.8;
      if (insideCenter) {
        centerSamples += 1;
        if (colorDistance(color) >= 55) centerArtwork += 1;
      }
    }
  }
  return {
    luminanceRange: maximumLuminance - minimumLuminance,
    quantizedColors: colors.size,
    centerArtworkRatio: centerArtwork / centerSamples,
  };
}

test('brand source concepts and full-size exports are complete', () => {
  assert.equal(fs.existsSync(path.join(root, 'branding/icons/icon-general.svg')), true);
  assert.equal(fs.existsSync(path.join(root, 'branding/icons/icon-electric-lounge.svg')), true);
  for (const iconPath of [
    'branding/icons/icon-general-1024.png',
    'branding/icons/icon-electric-lounge-1024.png',
  ]) {
    const image = decodePng(iconPath);
    assert.equal(image.width, 1024);
    assert.equal(image.height, 1024);
    const stats = artworkStats(image);
    assert.ok(stats.luminanceRange >= 80, `${iconPath} lacks meaningful contrast`);
    assert.ok(stats.quantizedColors >= 12, `${iconPath} lacks meaningful color variation`);
    assert.ok(stats.centerArtworkRatio >= 0.08, `${iconPath} is missing centered logo artwork`);
  }
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
  const expectedIcons = [
    ['web/icons/icon-512.png', 512],
    ['web/icons/icon-192.png', 192],
    ['web/icons/apple-touch-icon.png', 180],
    ['web/icons/favicon-32.png', 32],
  ];
  for (const [iconPath, expectedSize] of expectedIcons) {
    const image = decodePng(iconPath);
    assert.equal(image.width, expectedSize);
    assert.equal(image.height, expectedSize);
    const stats = artworkStats(image);
    assert.ok(stats.luminanceRange >= 80, `${iconPath} lacks meaningful contrast`);
    assert.ok(stats.quantizedColors >= 12, `${iconPath} lacks meaningful color variation`);
    assert.ok(stats.centerArtworkRatio >= 0.08, `${iconPath} is missing centered logo artwork`);
  }
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
