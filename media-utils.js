const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.vob', '.webm', '.m4v',
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanDisplayTitle(value) {
  return String(value || '')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|web[ ._-]?dl|webrip|blu[ ._-]?ray|brrip|x264|x265|h264|h265|hevc|aac|dts)\b.*$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[ ._-]+$/, '')
    .trim();
}

function titleFromFilename(filename) {
  const basename = path.basename(String(filename || ''), path.extname(String(filename || '')));
  return cleanDisplayTitle(basename);
}

function parseEpisodeFilename(filename) {
  const basename = path.basename(String(filename || ''), path.extname(String(filename || '')));
  const match = basename.match(/S(\d{1,3})\s*[._ -]*E(\d{1,3})(?:(?:\s*[._ ]*-\s*[._ ]*E?|\s*[._ ]*E)(\d{1,3}))?/i);
  if (!match || match.index === undefined) return null;

  const season = Number.parseInt(match[1], 10);
  const episode = Number.parseInt(match[2], 10);
  const episodeEnd = Number.parseInt(match[3], 10);
  const showPart = basename.slice(0, match.index).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const titlePart = cleanDisplayTitle(basename.slice(match.index + match[0].length)
    .replace(/^[._ -]+/, '')
  );

  return {
    season,
    episode,
    ...(Number.isFinite(episodeEnd) && episodeEnd > episode ? { episodeEnd } : {}),
    showName: showPart,
    episodeTitle: titlePart,
    code: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
  };
}

function deriveTvFileInfo(filePath, tvRoot) {
  const parsed = parseEpisodeFilename(filePath);
  if (!parsed) return null;
  const relative = path.relative(path.resolve(tvRoot), path.resolve(filePath));
  const parts = relative.split(path.sep).filter(Boolean);
  const firstDirectory = parts.length > 1 ? parts[0] : '';
  const directoryLooksLikeSeason = /^season\s*\d+$/i.test(firstDirectory);
  const showName = (!directoryLooksLikeSeason && firstDirectory)
    ? titleFromFilename(firstDirectory)
    : (parsed.showName || 'Unknown Show');
  const episodeTitle = parsed.episodeTitle || `Episode ${parsed.episode}`;

  return {
    ...parsed,
    showName,
    episodeTitle,
    displayName: `${parsed.code}${parsed.episodeEnd ? `-E${String(parsed.episodeEnd).padStart(2, '0')}` : ''}: ${episodeTitle}`,
  };
}

function isPathInsideRoot(candidatePath, rootPath) {
  if (!candidatePath || !rootPath) return false;
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parseByteRange(rangeHeader, fileSize) {
  if (!rangeHeader) return undefined;
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return null;

  let start;
  let end;
  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : fileSize - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start < 0 || start >= fileSize || end < start) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

function getEpisodeCode(value) {
  return String(value || '').match(/S\d{1,3}\s*[._ -]*E\d{1,3}/i)?.[0]
    ?.replace(/[._ -]+/g, '')
    .toLowerCase() || '';
}

function scoreSubtitleMatch(videoPath, subtitlePath, mediaType) {
  const videoBase = normalizeComparable(path.basename(videoPath));
  const subtitleBase = normalizeComparable(path.basename(subtitlePath));
  const sameDirectory = path.dirname(videoPath) === path.dirname(subtitlePath);
  if (!videoBase || !subtitleBase) return 0;
  if (videoBase === subtitleBase) return 120;
  if (subtitleBase.startsWith(`${videoBase} `) || videoBase.startsWith(`${subtitleBase} `)) {
    return sameDirectory ? 110 : 90;
  }

  if (mediaType === 'episode') {
    const videoCode = getEpisodeCode(videoPath);
    const subtitleCode = getEpisodeCode(subtitlePath);
    if (videoCode && videoCode === subtitleCode) return sameDirectory ? 100 : 78;
    return 0;
  }

  const videoTokens = new Set(videoBase.split(' ').filter((token) => token.length > 2));
  const subtitleTokens = subtitleBase.split(' ').filter((token) => token.length > 2);
  const overlap = subtitleTokens.filter((token) => videoTokens.has(token)).length;
  if (videoTokens.size && overlap / videoTokens.size >= 0.8) return sameDirectory ? 95 : 75;
  return 0;
}

module.exports = {
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  deriveTvFileInfo,
  isPathInsideRoot,
  normalizeComparable,
  parseByteRange,
  parseEpisodeFilename,
  scoreSubtitleMatch,
  titleFromFilename,
};
