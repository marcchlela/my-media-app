const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffprobeStatic = require('ffprobe-static');
const {
  findMediaByPath,
  findRelinkCandidate,
  getDb,
  getSetting,
  markUnseenUnavailable,
  migrateLegacyAccountState,
  replaceSubtitles,
  saveScannedMedia,
  setSetting,
  updateSourceScanState,
  upsertMediaSource,
  upsertShow,
} = require('./media-store');
const {
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  deriveTvFileInfo,
  normalizeComparable,
  scoreSubtitleMatch,
  titleFromFilename,
} = require('./media-utils');
const { createTmdbService } = require('./tmdb-service');

const execFileAsync = promisify(execFile);

function resolveFfprobePath() {
  const probePath = String(ffprobeStatic?.path || ffprobeStatic || '');
  return probePath.includes('app.asar') ? probePath.replace('app.asar', 'app.asar.unpacked') : probePath;
}

async function inspectMediaFile(filePath) {
  try {
    const { stdout } = await execFileAsync(resolveFfprobePath(), [
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath,
    ], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '{}');
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video') || {};
    const audio = streams.find((stream) => stream.codec_type === 'audio') || {};
    const duration = Number(video.duration || parsed.format?.duration);
    return {
      durationSeconds: duration > 0 ? duration : null,
      container: String(parsed.format?.format_name || '').split(',')[0] || null,
      videoCodec: video.codec_name || null,
      audioCodec: audio.codec_name || null,
      width: Number(video.width) > 0 ? Number(video.width) : null,
      height: Number(video.height) > 0 ? Number(video.height) : null,
    };
  } catch (err) {
    return { probeError: err.message || 'ffprobe failed' };
  }
}

async function walkFiles(rootPath) {
  const files = [];
  async function visit(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await visit(rootPath);
  return files;
}

function detectSubtitleLanguage(filename) {
  const value = String(filename || '').toLowerCase();
  if (/\b(fr|fre|french)\b/.test(value)) return 'fr';
  if (/\b(ar|ara|arabic)\b/.test(value)) return 'ar';
  if (/\b(es|spa|spanish)\b/.test(value)) return 'es';
  if (/\b(de|ger|german)\b/.test(value)) return 'de';
  return 'en';
}

function findMatchingSubtitles(videoPath, subtitleFiles, mediaType, sourceRoot) {
  return subtitleFiles
    .map((subtitlePath) => ({
      subtitlePath,
      score: scoreSubtitleMatch(videoPath, subtitlePath, mediaType),
    }))
    .filter((candidate) => candidate.score >= 75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ subtitlePath }) => ({
      filePath: subtitlePath,
      relativePath: path.relative(sourceRoot, subtitlePath),
      displayName: path.basename(subtitlePath),
      language: detectSubtitleLanguage(path.basename(subtitlePath)),
      format: path.extname(subtitlePath).slice(1).toLowerCase(),
      modifiedAt: fs.statSync(subtitlePath).mtimeMs,
    }));
}

function metadataFromLegacyItem(item, mediaType) {
  const details = item?.movieExtras?.details || item?.data || {};
  return {
    tmdbId: Number(details?.id) || null,
    posterPath: item?.customPosterTmdbPath || details?.poster_path || null,
    backdropPath: details?.backdrop_path || null,
    overview: details?.overview || null,
    releaseDate: details?.release_date || details?.first_air_date || null,
    genres: Array.isArray(details?.genres)
      ? details.genres.map((genre) => genre?.name || genre).filter(Boolean)
      : [],
    rating: Number.isFinite(details?.vote_average) ? details.vote_average : null,
    runtimeMinutes: Number(item?.measuredRuntimeMinutes)
      || Number(details?.runtime)
      || Number(details?.episode_run_time?.[0])
      || null,
    durationSeconds: Number(item?.watchProgress?.duration) || null,
    width: Number(item?.measuredVideoWidth) || null,
    height: Number(item?.measuredVideoHeight) || null,
    mediaType,
  };
}

class MediaScanner {
  constructor(options = {}) {
    this.moviesDir = path.resolve(options.moviesDir || '/media/Movies');
    this.tvShowsDir = path.resolve(options.tvShowsDir || '/media/TV Shows');
    this.inspectMedia = options.inspectMedia || inspectMediaFile;
    this.tmdb = options.tmdb || createTmdbService();
    this.running = false;
    this.status = {
      running: false,
      startedAt: null,
      finishedAt: null,
      filesScanned: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      unavailable: 0,
      errors: [],
      sources: [],
    };
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  async importLegacyLibrary(items) {
    if (getSetting('legacy_library_imported') === '1' || !Array.isArray(items) || !items.length) return 0;
    const movieSource = upsertMediaSource('movies', this.moviesDir);
    const tvSource = upsertMediaSource('tv', this.tvShowsDir);
    let imported = 0;
    for (const item of items) {
      if (!item?.path || findMediaByPath(item.path)) continue;
      const isShow = !!item.isShow;
      const source = isShow ? tvSource : movieSource;
      const episodeInfo = isShow ? deriveTvFileInfo(item.path, this.tvShowsDir) : null;
      const legacyMeta = metadataFromLegacyItem(item, isShow ? 'episode' : 'movie');
      const showTitle = item.showName || item.data?.name || episodeInfo?.showName || 'Unknown Show';
      const show = isShow ? upsertShow(showTitle, {
        ...legacyMeta,
        releaseDate: item.data?.first_air_date || legacyMeta.releaseDate,
      }) : null;
      const title = isShow
        ? (episodeInfo?.episodeTitle || String(item.name || '').replace(/^.*?:\s*/, '') || 'Episode')
        : (item.data?.title || titleFromFilename(item.name || item.path));
      const stat = await fs.promises.stat(item.path).catch(() => null);
      const saved = saveScannedMedia({
        sourceId: source.id,
        mediaType: isShow ? 'episode' : 'movie',
        showId: show?.id || null,
        filePath: item.path,
        relativePath: path.relative(source.root_path, item.path),
        filename: path.basename(item.path),
        title,
        normalizedTitle: normalizeComparable(title),
        seasonNumber: item.episode?.season || episodeInfo?.season || null,
        episodeNumber: item.episode?.episode || episodeInfo?.episode || null,
        episodeEndNumber: item.episode?.episodeEnd || episodeInfo?.episodeEnd || null,
        fileSize: stat?.size ?? null,
        modifiedAt: stat?.mtimeMs ?? null,
        ...legacyMeta,
      });
      if (!stat) getDb().prepare('UPDATE media_items SET available = 0 WHERE id = ?').run(saved.id);
      const subtitles = (item.subtitles || [])
        .map((subtitle) => subtitle?.trackPath || subtitle?.path)
        .filter((subtitlePath) => subtitlePath && fs.existsSync(subtitlePath))
        .map((subtitlePath) => ({
          filePath: subtitlePath,
          relativePath: path.relative(source.root_path, subtitlePath),
          displayName: path.basename(subtitlePath),
          language: detectSubtitleLanguage(subtitlePath),
          format: path.extname(subtitlePath).slice(1).toLowerCase(),
          modifiedAt: fs.statSync(subtitlePath).mtimeMs,
        }));
      replaceSubtitles(saved.id, subtitles);
      imported += 1;
    }
    migrateLegacyAccountState();
    setSetting('legacy_library_imported', '1');
    return imported;
  }

  async scan() {
    if (this.running) return { started: false, status: this.getStatus() };
    this.running = true;
    this.status = {
      running: true,
      startedAt: Date.now(),
      finishedAt: null,
      filesScanned: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      unavailable: 0,
      errors: [],
      sources: [],
    };
    try {
      await this.scanSource('movies', this.moviesDir);
      await this.scanSource('tv', this.tvShowsDir);
      migrateLegacyAccountState();
    } finally {
      this.running = false;
      this.status.running = false;
      this.status.finishedAt = Date.now();
    }
    return { started: true, status: this.getStatus() };
  }

  async scanSource(kind, rootPath) {
    const source = upsertMediaSource(kind, rootPath);
    const sourceStatus = { kind, available: false, files: 0, error: null };
    this.status.sources.push(sourceStatus);
    updateSourceScanState(source.id, { startedAt: Date.now(), error: null });

    let rootStat;
    try {
      rootStat = await fs.promises.stat(rootPath);
      if (!rootStat.isDirectory()) throw new Error('Configured media source is not a directory.');
    } catch (err) {
      sourceStatus.error = 'Media source is unavailable.';
      this.status.errors.push(`${kind}: ${sourceStatus.error}`);
      updateSourceScanState(source.id, { available: false, finishedAt: Date.now(), error: sourceStatus.error });
      return;
    }

    let allFiles;
    try {
      allFiles = await walkFiles(rootPath);
    } catch (err) {
      sourceStatus.error = 'Media source could not be read.';
      this.status.errors.push(`${kind}: ${sourceStatus.error}`);
      updateSourceScanState(source.id, { available: false, finishedAt: Date.now(), error: sourceStatus.error });
      return;
    }

    const videoFiles = allFiles.filter((filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
    const subtitleFiles = allFiles.filter((filePath) => SUBTITLE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
    const existingCount = Number(getDb().prepare('SELECT COUNT(*) AS count FROM media_items WHERE source_id = ?').get(source.id).count);
    if (!videoFiles.length && existingCount > 0) {
      sourceStatus.error = 'Media source is unexpectedly empty; catalog entries were preserved.';
      this.status.errors.push(`${kind}: ${sourceStatus.error}`);
      updateSourceScanState(source.id, { available: false, finishedAt: Date.now(), error: sourceStatus.error });
      return;
    }

    sourceStatus.available = true;
    sourceStatus.files = videoFiles.length;
    const seenPaths = new Set();
    for (const videoPath of videoFiles) {
      try {
        await this.scanFile(kind, source, rootPath, videoPath, subtitleFiles, seenPaths);
      } catch (err) {
        this.status.errors.push(`${path.basename(videoPath)}: ${err.message || 'scan failed'}`);
      }
    }
    if (videoFiles.length || existingCount === 0) {
      this.status.unavailable += markUnseenUnavailable(source.id, seenPaths);
    }
    updateSourceScanState(source.id, { available: true, finishedAt: Date.now(), error: null });
  }

  async scanFile(kind, source, rootPath, videoPath, subtitleFiles, seenPaths) {
    const resolvedPath = path.resolve(videoPath);
    seenPaths.add(resolvedPath);
    this.status.filesScanned += 1;
    const stat = await fs.promises.stat(resolvedPath);
    const mediaType = kind === 'tv' ? 'episode' : 'movie';
    const tvInfo = mediaType === 'episode' ? deriveTvFileInfo(resolvedPath, rootPath) : null;
    if (mediaType === 'episode' && !tvInfo) throw new Error('Filename does not contain an SxxExx episode code.');

    let show = null;
    let showMetadata = null;
    if (tvInfo) {
      const existingShow = getDb().prepare('SELECT * FROM shows WHERE normalized_title = ?').get(normalizeComparable(tvInfo.showName));
      if (!existingShow && this.tmdb.configured) {
        showMetadata = await this.tmdb.enrichShow(tvInfo.showName).catch(() => null);
      }
      show = upsertShow(showMetadata?.title || tvInfo.showName, showMetadata || {});
    }

    const title = tvInfo?.episodeTitle || titleFromFilename(resolvedPath);
    const identity = {
      sourceId: source.id,
      mediaType,
      showId: show?.id || null,
      normalizedTitle: normalizeComparable(title),
      seasonNumber: tvInfo?.season || null,
      episodeNumber: tvInfo?.episode || null,
      fileSize: stat.size,
    };
    let existing = findMediaByPath(resolvedPath);
    if (!existing) existing = findRelinkCandidate(identity);
    const unchanged = existing
      && existing.file_path === resolvedPath
      && Number(existing.file_size) === stat.size
      && Number(existing.modified_at) === stat.mtimeMs;

    let inspection = {};
    let metadata = {};
    if (!unchanged) {
      inspection = await this.inspectMedia(resolvedPath);
      if (!existing?.metadata_locked && this.tmdb.configured) {
        if (mediaType === 'movie') {
          metadata = await this.tmdb.enrichMovie(title).catch(() => null) || {};
        } else if (show?.tmdb_id) {
          metadata = await this.tmdb.enrichEpisode(show.tmdb_id, tvInfo.season, tvInfo.episode).catch(() => null) || {};
        }
      }
    }

    const saved = saveScannedMedia({
      sourceId: source.id,
      mediaType,
      showId: show?.id || null,
      filePath: resolvedPath,
      relativePath: path.relative(rootPath, resolvedPath),
      filename: path.basename(resolvedPath),
      title: metadata.title || title,
      normalizedTitle: normalizeComparable(metadata.title || title),
      seasonNumber: tvInfo?.season || null,
      episodeNumber: tvInfo?.episode || null,
      episodeEndNumber: tvInfo?.episodeEnd || null,
      fileSize: stat.size,
      modifiedAt: stat.mtimeMs,
      ...inspection,
      ...metadata,
    }, existing);
    replaceSubtitles(saved.id, findMatchingSubtitles(resolvedPath, subtitleFiles, mediaType, rootPath));

    if (unchanged) this.status.unchanged += 1;
    else if (existing) this.status.updated += 1;
    else this.status.new += 1;
  }
}

module.exports = {
  MediaScanner,
  detectSubtitleLanguage,
  findMatchingSubtitles,
  inspectMediaFile,
  walkFiles,
};
