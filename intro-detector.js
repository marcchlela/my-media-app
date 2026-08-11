const { execFile } = require('child_process');
const { promisify } = require('util');
const { getDb, updateAutomaticPlaybackMarkers } = require('./media-store');

const execFileAsync = promisify(execFile);
const ANALYSIS_VERSION = 1;
const FINGERPRINTS_PER_SECOND = 8;

function parseFingerprintOutput(output) {
  const match = String(output || '').match(/^FINGERPRINT=(.+)$/m);
  if (!match) return [];
  return match[1].split(',').map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
}

function popcount32(value) {
  let number = value >>> 0;
  number -= (number >>> 1) & 0x55555555;
  number = (number & 0x33333333) + ((number >>> 2) & 0x33333333);
  return (((number + (number >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function downsampleFingerprint(values) {
  const compact = [];
  for (let index = 0; index < values.length; index += FINGERPRINTS_PER_SECOND) {
    compact.push(values[index] | 0);
  }
  return compact;
}

function findRepeatedSegment(referenceValues, candidateValues, options = {}) {
  const reference = downsampleFingerprint(referenceValues);
  const candidate = downsampleFingerprint(candidateValues);
  const maxOffset = options.maxOffsetSeconds || 480;
  const minLength = options.minLengthSeconds || 20;
  const maxLength = options.maxLengthSeconds || 240;
  let best = null;
  for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
    let runStart = null;
    let lastGood = null;
    let misses = 0;
    let distanceTotal = 0;
    let matched = 0;
    const closeRun = () => {
      if (runStart === null || lastGood === null) return;
      const length = lastGood - runStart + 1;
      if (length < minLength) return;
      const unique = new Set(reference.slice(runStart, lastGood + 1)).size;
      if (unique < Math.min(10, Math.floor(length / 2))) return;
      const clippedLength = Math.min(length, maxLength);
      const score = clippedLength * (matched / Math.max(1, matched + misses)) - (distanceTotal / Math.max(1, matched)) * 0.25;
      if (!best || score > best.score) {
        best = {
          referenceStart: runStart,
          referenceEnd: runStart + clippedLength,
          candidateStart: runStart + offset,
          candidateEnd: runStart + offset + clippedLength,
          length: clippedLength,
          confidence: Math.max(0, Math.min(1, 1 - (distanceTotal / Math.max(1, matched)) / 18)),
          score,
        };
      }
    };
    const start = Math.max(0, -offset);
    const end = Math.min(reference.length, candidate.length - offset);
    for (let second = start; second < end; second += 1) {
      const distance = popcount32((reference[second] ^ candidate[second + offset]) | 0);
      if (distance <= 11) {
        if (runStart === null) runStart = second;
        lastGood = second;
        misses = 0;
        matched += 1;
        distanceTotal += distance;
      } else if (runStart !== null) {
        misses += 1;
        if (misses > 2) {
          closeRun();
          runStart = null;
          lastGood = null;
          misses = 0;
          distanceTotal = 0;
          matched = 0;
        }
      }
    }
    closeRun();
  }
  return best;
}

function clusterMatches(matches) {
  const clusters = [];
  for (const match of matches) {
    let cluster = clusters.find((entry) => (
      Math.abs(entry.referenceStart - match.referenceStart) <= 18
      && Math.abs(entry.referenceEnd - match.referenceEnd) <= 25
    ));
    if (!cluster) {
      cluster = { referenceStart: match.referenceStart, referenceEnd: match.referenceEnd, matches: [] };
      clusters.push(cluster);
    }
    cluster.matches.push(match);
    cluster.referenceStart = cluster.matches.reduce((sum, value) => sum + value.referenceStart, 0) / cluster.matches.length;
    cluster.referenceEnd = cluster.matches.reduce((sum, value) => sum + value.referenceEnd, 0) / cluster.matches.length;
  }
  return clusters.sort((a, b) => b.matches.length - a.matches.length || (b.referenceEnd - b.referenceStart) - (a.referenceEnd - a.referenceStart))[0] || null;
}

class IntroDetector {
  constructor(options = {}) {
    this.fpcalcPath = options.fpcalcPath || process.env.FPCALC_PATH || 'fpcalc';
    this.jobManager = options.jobManager;
    this.tools = options.tools || {};
    this.activeJobId = null;
  }

  start(options = {}) {
    if (this.activeJobId) return { started: false, jobId: this.activeJobId };
    if (!this.tools.fingerprint?.available) throw new Error('Chromaprint fpcalc is unavailable on this server.');
    const job = this.jobManager.start('intro-analysis', 'Detect episode intros', async ({ update, signal }) => {
      const result = await this.runAnalysis({ force: !!options.force, update, signal });
      return result;
    });
    this.activeJobId = job.id;
    const poll = setInterval(() => {
      const active = this.jobManager.snapshot().active.some((entry) => entry.id === job.id);
      if (!active) {
        this.activeJobId = null;
        clearInterval(poll);
      }
    }, 1000);
    poll.unref?.();
    return { started: true, jobId: job.id };
  }

  pendingSeasons(force = false) {
    const rows = getDb().prepare(`
      SELECT items.id, items.show_id, shows.title AS show_title, items.season_number,
             items.episode_number, items.file_path, items.duration_seconds,
             items.marker_source, items.marker_analysis_version
      FROM media_items items
      JOIN shows ON shows.id = items.show_id
      JOIN media_sources sources ON sources.id = items.source_id
      WHERE items.media_type = 'episode' AND items.available = 1 AND sources.available = 1
      ORDER BY shows.title, items.season_number, items.episode_number
    `).all();
    const seasons = new Map();
    for (const row of rows) {
      const key = `${row.show_id}:${row.season_number}`;
      if (!seasons.has(key)) seasons.set(key, { key, showId: row.show_id, showTitle: row.show_title, season: row.season_number, episodes: [] });
      seasons.get(key).episodes.push(row);
    }
    return Array.from(seasons.values()).filter((season) => (
      season.episodes.length >= 3
      && (force || season.episodes.some((episode) => Number(episode.marker_analysis_version || 0) < ANALYSIS_VERSION))
    ));
  }

  async fingerprint(filePath) {
    const { stdout } = await execFileAsync(this.fpcalcPath, ['-raw', '-length', '720', filePath], {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    const fingerprint = parseFingerprintOutput(stdout);
    if (fingerprint.length < FINGERPRINTS_PER_SECOND * 30) throw new Error('Audio fingerprint was too short.');
    return fingerprint;
  }

  async analyzeSeason(season, signal) {
    const episodes = [];
    for (const episode of season.episodes) {
      if (signal.aborted) throw new Error('Intro analysis cancelled.');
      try {
        episodes.push({ ...episode, fingerprint: await this.fingerprint(episode.file_path) });
      } catch (err) {
        episodes.push({ ...episode, fingerprint: null, fingerprintError: err.message });
      }
    }
    const usable = episodes.filter((episode) => episode.fingerprint);
    if (usable.length < 3) {
      for (const episode of usable) updateAutomaticPlaybackMarkers(episode.id, { analyzed: true, analysisVersion: ANALYSIS_VERSION });
      return { detected: 0, errors: episodes.filter((episode) => episode.fingerprintError).length };
    }
    const reference = usable[Math.floor(usable.length / 2)];
    const matches = usable
      .filter((episode) => episode.id !== reference.id)
      .map((episode) => ({ episode, match: findRepeatedSegment(reference.fingerprint, episode.fingerprint) }))
      .filter((entry) => entry.match)
      .map((entry) => ({ ...entry.match, episode: entry.episode }));
    const cluster = clusterMatches(matches);
    const minimumConsensus = Math.max(2, Math.ceil((usable.length - 1) * 0.45));
    if (!cluster || cluster.matches.length < minimumConsensus) {
      for (const episode of usable) updateAutomaticPlaybackMarkers(episode.id, { analyzed: true, analysisVersion: ANALYSIS_VERSION });
      return { detected: 0, errors: episodes.filter((episode) => episode.fingerprintError).length };
    }
    const coverage = cluster.matches.length / Math.max(1, usable.length - 1);
    const averageSimilarity = cluster.matches.reduce((sum, entry) => sum + entry.confidence, 0) / cluster.matches.length;
    const confidence = Math.round(Math.min(0.99, coverage * 0.65 + averageSimilarity * 0.35) * 100) / 100;
    updateAutomaticPlaybackMarkers(reference.id, {
      introStart: Math.max(0, Math.round(cluster.referenceStart * 10) / 10),
      introEnd: Math.max(0, Math.round(cluster.referenceEnd * 10) / 10),
      introConfidence: confidence,
      source: 'audio-fingerprint',
      analyzed: true,
      analysisVersion: ANALYSIS_VERSION,
    });
    for (const entry of cluster.matches) {
      updateAutomaticPlaybackMarkers(entry.episode.id, {
        introStart: Math.max(0, Math.round(entry.candidateStart * 10) / 10),
        introEnd: Math.max(0, Math.round(entry.candidateEnd * 10) / 10),
        introConfidence: confidence,
        source: 'audio-fingerprint',
        analyzed: true,
        analysisVersion: ANALYSIS_VERSION,
      });
    }
    const matchedIds = new Set([reference.id, ...cluster.matches.map((entry) => entry.episode.id)]);
    for (const episode of usable.filter((entry) => !matchedIds.has(entry.id))) {
      updateAutomaticPlaybackMarkers(episode.id, { analyzed: true, analysisVersion: ANALYSIS_VERSION });
    }
    return { detected: matchedIds.size, errors: episodes.filter((episode) => episode.fingerprintError).length };
  }

  async runAnalysis({ force, update, signal }) {
    const seasons = this.pendingSeasons(force);
    let detected = 0;
    let errors = 0;
    for (let index = 0; index < seasons.length; index += 1) {
      const season = seasons[index];
      update({
        progress: seasons.length ? Math.round((index / seasons.length) * 100) : 100,
        message: `Analyzing ${season.showTitle}, Season ${season.season}`,
        metadata: { showId: season.showId, season: season.season },
      });
      const result = await this.analyzeSeason(season, signal);
      detected += result.detected;
      errors += result.errors;
    }
    return { seasons: seasons.length, episodesDetected: detected, fingerprintErrors: errors };
  }
}

module.exports = {
  ANALYSIS_VERSION,
  IntroDetector,
  clusterMatches,
  findRepeatedSegment,
  parseFingerprintOutput,
  popcount32,
};
