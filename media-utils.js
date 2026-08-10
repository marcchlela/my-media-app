const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.vob', '.webm', '.m4v',
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

const RELEASE_NOISE_TOKENS = new Set([
  '360p', '480p', '576p', '720p', '1080p', '1080i', '2160p', '4320p', '4k', '8k', 'uhd',
  'webdl', 'webrip', 'web', 'bluray', 'bdrip', 'brrip', 'dvdrip', 'hdtv', 'remux',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'av1', '10bit', '8bit',
  'aac', 'aac2', 'aac5', 'ac3', 'eac3', 'dts', 'dtshd', 'truehd', 'atmos', 'ddp', 'dd5',
  'hdr', 'hdr10', 'hdr10plus', 'dolbyvision', 'dv', 'sdr', 'imax',
  'proper', 'repack', 'rerip', 'internal', 'limited', 'extendedsample',
]);

const EDITION_PATTERNS = [
  { pattern: /\b(?:director'?s|directors)\s+cut\b/i, label: "Director's Cut" },
  { pattern: /\bextended(?:\s+(?:cut|edition))?\b/i, label: 'Extended Edition' },
  { pattern: /\btheatrical(?:\s+(?:cut|edition))?\b/i, label: 'Theatrical Cut' },
  { pattern: /\bultimate(?:\s+edition)?\b/i, label: 'Ultimate Edition' },
  { pattern: /\bfinal\s+cut\b/i, label: 'Final Cut' },
  { pattern: /\bunrated(?:\s+(?:cut|edition))?\b/i, label: 'Unrated' },
  { pattern: /\bremastered(?:\s+edition)?\b/i, label: 'Remastered' },
  { pattern: /\bredux\b/i, label: 'Redux' },
];

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactReleaseToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isReleaseNoiseToken(value) {
  const compact = compactReleaseToken(value);
  if (RELEASE_NOISE_TOKENS.has(compact)) return true;
  return /^(?:ddp?|aac|dts|ac3|eac3)\d(?:1|0)?$/i.test(compact)
    || /^(?:yts|yify|rarbg)$/i.test(compact);
}

function parseMediaTitle(value) {
  const input = String(value || '');
  const extension = path.extname(input);
  const basename = VIDEO_EXTENSIONS.has(extension.toLowerCase())
    ? path.basename(input, extension)
    : path.basename(input);
  let text = basename
    .replace(/-([A-Z0-9]{3,12})$/, '')
    .replace(/[\[({]([^\])}]+)[\])}]/g, (whole, inner) => (
      String(inner).split(/\s+/).some(isReleaseNoiseToken) ? ' ' : whole
    ))
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let edition = '';
  for (const candidate of EDITION_PATTERNS) {
    if (!candidate.pattern.test(text)) continue;
    edition = candidate.label;
    text = text.replace(candidate.pattern, ' ').replace(/\s+/g, ' ').trim();
    break;
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  let cutoff = tokens.length;
  for (let index = 0; index < tokens.length; index += 1) {
    if (isReleaseNoiseToken(tokens[index])) {
      cutoff = index;
      break;
    }
  }

  let year = null;
  const currentYear = new Date().getUTCFullYear() + 1;
  for (let index = 1; index < cutoff; index += 1) {
    const candidate = Number(tokens[index].replace(/[()]/g, ''));
    if (!Number.isInteger(candidate) || candidate < 1900 || candidate > currentYear) continue;
    const suffix = tokens.slice(index + 1, cutoff);
    if (suffix.length && !suffix.every(isReleaseNoiseToken)) continue;
    year = candidate;
    cutoff = index;
    break;
  }

  let lookupTitle = tokens.slice(0, cutoff).join(' ')
    .replace(/\s+-\s+[A-Z0-9]{2,12}$/g, '')
    .replace(/[ ._-]+$/, '')
    .trim();
  if (!lookupTitle && !tokens.length) lookupTitle = text || basename;

  const displayTitle = edition ? `${lookupTitle} - ${edition}` : lookupTitle;
  return { displayTitle, edition: edition || null, lookupTitle, year };
}

function cleanDisplayTitle(value) {
  return parseMediaTitle(value).displayTitle;
}

function titleFromFilename(filename) {
  return cleanDisplayTitle(filename);
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
    showLookupName: (!directoryLooksLikeSeason && firstDirectory) ? firstDirectory : parsed.showName,
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
  cleanDisplayTitle,
  isPathInsideRoot,
  normalizeComparable,
  parseMediaTitle,
  parseByteRange,
  parseEpisodeFilename,
  scoreSubtitleMatch,
  titleFromFilename,
};
