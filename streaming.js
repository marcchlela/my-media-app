const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseByteRange } = require('./media-utils');

function srtToVttContent(content) {
  const normalized = String(content || '').replace(/\r/g, '');
  return `WEBVTT\n\n${normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}

function pipeFile(filePath, options, req, res) {
  const stream = fs.createReadStream(filePath, options);
  const destroy = () => stream.destroy();
  req.once('aborted', destroy);
  res.once('close', destroy);
  stream.once('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: 'Media stream failed.' });
    else res.destroy(err);
  });
  stream.pipe(res);
}

async function serveMediaFile(filePath, mimeType, req, res) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    return res.sendStatus(404);
  }
  if (!stat.isFile()) return res.sendStatus(404);

  const range = parseByteRange(req.headers.range, stat.size);
  if (req.headers.range && !range) {
    return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  }

  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType || 'application/octet-stream',
    'Cache-Control': 'private, no-transform',
  };
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['Content-Length'] = range.end - range.start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    return pipeFile(filePath, { start: range.start, end: range.end }, req, res);
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  return pipeFile(filePath, undefined, req, res);
}

async function serveSubtitleFile(filePath, cacheDirectory, res) {
  const extension = path.extname(filePath).toLowerCase();
  if (!['.srt', '.vtt'].includes(extension)) return res.status(400).json({ error: 'Unsupported subtitle format.' });
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    return res.sendStatus(404);
  }
  if (!stat.isFile()) return res.sendStatus(404);

  res.type('text/vtt').set('Cache-Control', 'private, max-age=3600');
  if (extension === '.vtt') return fs.createReadStream(filePath).pipe(res);

  await fs.promises.mkdir(cacheDirectory, { recursive: true });
  const cacheKey = crypto.createHash('sha256')
    .update(`${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex');
  const cachePath = path.join(cacheDirectory, `${cacheKey}.vtt`);
  if (!fs.existsSync(cachePath)) {
    const source = await fs.promises.readFile(filePath, 'utf8');
    await fs.promises.writeFile(cachePath, srtToVttContent(source), 'utf8');
  }
  return fs.createReadStream(cachePath).pipe(res);
}

module.exports = { serveMediaFile, serveSubtitleFile, srtToVttContent };
