const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const QUALITY_PROFILES = [
  { name: '2160p', height: 2160, bitrateKbps: 14000, audioKbps: 192 },
  { name: '1080p', height: 1080, bitrateKbps: 6000, audioKbps: 160 },
  { name: '720p', height: 720, bitrateKbps: 3000, audioKbps: 128 },
  { name: '480p', height: 480, bitrateKbps: 1400, audioKbps: 96 },
  { name: '360p', height: 360, bitrateKbps: 800, audioKbps: 80 },
];

function safeMediaId(value) {
  const id = String(value || '');
  return /^[a-z0-9_]+$/i.test(id) ? id : '';
}

function availableProfiles(item) {
  const sourceHeight = Number(item?.height) || 0;
  if (!sourceHeight) return QUALITY_PROFILES.filter((profile) => profile.height <= 1080);
  const profiles = QUALITY_PROFILES.filter((profile) => profile.height <= sourceHeight + 40);
  if (profiles.length) return profiles;
  const height = Math.max(144, Math.floor(sourceHeight / 2) * 2);
  return [{ name: `${height}p`, height, bitrateKbps: Math.max(350, Math.round(height * 2.1)), audioKbps: 64 }];
}

function normalizeHlsRequest(input = {}, fallbackHeight = 720) {
  const requestedMode = String(input.mode || '').toLowerCase();
  const mode = requestedMode === 'compatibility'
    ? 'compatibility'
    : requestedMode === 'adaptive'
      ? 'adaptive'
      : requestedMode === 'manual' || requestedMode === 'manual-quality' || input.quality
      ? 'manual'
      : 'adaptive';
  const parsedQuality = Number.parseInt(String(input.quality || ''), 10);
  const targetHeight = mode === 'compatibility'
    ? Math.max(360, Number.parseInt(String(fallbackHeight), 10) || 720)
    : Number.isFinite(parsedQuality) ? parsedQuality : null;
  return { mode, targetHeight };
}

function profilesForRequest(item, request) {
  const available = availableProfiles(item);
  if (request.mode === 'adaptive') return available;
  const target = request.targetHeight || 720;
  const atOrBelow = available.filter((profile) => profile.height <= target + 40);
  return [atOrBelow[0] || available.at(-1)];
}

function cacheKeyForRequest(request, profiles) {
  if (request.mode === 'adaptive') return 'adaptive';
  return `${request.mode}-${profiles[0].height}`;
}

class HlsManager {
  constructor(options = {}) {
    this.cacheDir = path.resolve(options.cacheDir);
    this.ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
    this.jobManager = options.jobManager;
    this.tools = options.tools || {};
    this.spawn = options.spawn || spawn;
    this.fallbackHeight = Math.max(360, Number.parseInt(process.env.TRANSCODE_FALLBACK_HEIGHT || '720', 10) || 720);
    this.jobs = new Map();
    this.maxConcurrent = Math.max(1, Number.parseInt(process.env.TRANSCODE_CONCURRENCY || '1', 10) || 1);
    this.activeEncodes = 0;
    this.waiters = [];
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  acquireEncoder(signal) {
    const grant = () => {
      this.activeEncodes += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.activeEncodes = Math.max(0, this.activeEncodes - 1);
        while (this.waiters.length) {
          const next = this.waiters.shift();
          if (next.signal.aborted) continue;
          next.resolve(grant());
          break;
        }
      };
    };
    if (this.activeEncodes < this.maxConcurrent) return Promise.resolve(grant());
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      const abort = () => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        reject(new Error('Stream generation was cancelled.'));
      };
      waiter.resolve = (release) => {
        signal.removeEventListener('abort', abort);
        resolve(release);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  getEncoder() {
    const requested = String(process.env.TRANSCODE_ACCEL || 'auto').toLowerCase();
    const encoders = this.tools.encoders || {};
    if (requested === 'none' || requested === 'software') return 'libx264';
    if ((requested === 'qsv' || requested === 'auto') && encoders.intelQsv && this.tools.gpuDeviceAvailable) return 'h264_qsv';
    if ((requested === 'vaapi' || requested === 'auto') && encoders.vaapi && this.tools.gpuDeviceAvailable) return 'h264_vaapi';
    if ((requested === 'nvenc' || requested === 'auto') && encoders.nvidiaNvenc && this.tools.nvidiaDeviceAvailable) return 'h264_nvenc';
    return 'libx264';
  }

  playbackOptions(item) {
    const profiles = availableProfiles(item);
    return {
      directPlay: true,
      defaultMode: 'direct',
      compatibilityFallback: { available: !!this.tools.ffmpeg?.available, targetHeight: this.fallbackHeight },
      hlsAvailable: !!this.tools.ffmpeg?.available,
      source: {
        width: Number(item?.width) || null,
        height: Number(item?.height) || null,
        videoCodec: item?.video_codec || null,
        audioCodec: item?.audio_codec || null,
        container: item?.container || null,
      },
      qualities: profiles.map((profile) => ({ label: profile.name, height: profile.height })),
      encoder: this.getEncoder(),
    };
  }

  describe(item, input = {}) {
    const request = normalizeHlsRequest(input, this.fallbackHeight);
    const profiles = profilesForRequest(item, request);
    return { request, profiles, cacheKey: cacheKeyForRequest(request, profiles) };
  }

  rootFor(mediaId, cacheKey) {
    return path.join(this.cacheDir, mediaId, cacheKey);
  }

  publicStatus(mediaId, cacheKey, state = {}) {
    return {
      ...state,
      process: undefined,
      cacheKey,
      masterUrl: `/api/media/${mediaId}/hls/${cacheKey}/master.m3u8`,
    };
  }

  getStatus(mediaId, input = {}) {
    const id = safeMediaId(mediaId);
    if (!id) return null;
    const request = normalizeHlsRequest(input, this.fallbackHeight);
    const requestedHeight = request.targetHeight;
    const suppliedKey = String(input.cacheKey || '');
    const cacheKey = /^(?:adaptive|manual-\d+|compatibility-\d+)$/.test(suppliedKey)
      ? suppliedKey
      : request.mode === 'adaptive' ? 'adaptive' : `${request.mode}-${requestedHeight}`;
    const cacheMode = cacheKey === 'adaptive' ? 'adaptive' : cacheKey.startsWith('manual-') ? 'manual' : cacheKey.startsWith('compatibility-') ? 'compatibility' : request.mode;
    const exact = this.jobs.get(`${id}:${cacheKey}`);
    if (exact) return this.publicStatus(id, cacheKey, exact);
    if (suppliedKey) {
      if (!fs.existsSync(path.join(this.rootFor(id, cacheKey), 'master.m3u8'))) return { state: 'idle', progress: 0, mode: cacheMode, cacheKey };
      return this.publicStatus(id, cacheKey, {
        state: 'ready', progress: 100, mode: cacheMode, qualities: this.readQualities(id, cacheKey),
      });
    }
    const candidates = request.mode === 'adaptive'
      ? ['adaptive']
      : fs.existsSync(path.join(this.cacheDir, id))
        ? fs.readdirSync(path.join(this.cacheDir, id)).filter((name) => name.startsWith(`${request.mode}-`))
        : [];
    const resolvedKey = candidates.find((name) => fs.existsSync(path.join(this.rootFor(id, name), 'master.m3u8')));
    if (!resolvedKey) return { state: 'idle', progress: 0, mode: request.mode, cacheKey };
    return this.publicStatus(id, resolvedKey, {
      state: 'ready', progress: 100, mode: request.mode, qualities: this.readQualities(id, resolvedKey),
    });
  }

  readQualities(mediaId, cacheKey) {
    try {
      return fs.readdirSync(this.rootFor(mediaId, cacheKey), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+p$/.test(entry.name))
        .map((entry) => entry.name);
    } catch (err) {
      return [];
    }
  }

  start(item, input = {}) {
    if (!this.tools.ffmpeg?.available) throw new Error('FFmpeg is unavailable on this server.');
    const mediaId = safeMediaId(item?.id);
    if (!mediaId || !item?.file_path) throw new Error('Invalid media item.');
    const { request, profiles, cacheKey } = this.describe(item, input);
    const stateKey = `${mediaId}:${cacheKey}`;
    const root = this.rootFor(mediaId, cacheKey);
    const metadataPath = path.join(root, 'source.json');
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (Number(metadata.fileSize) !== Number(item.file_size) || Number(metadata.modifiedAt) !== Number(item.modified_at)) {
        fs.rmSync(root, { recursive: true, force: true });
        this.jobs.delete(stateKey);
      }
    } catch (err) {
      if (fs.existsSync(path.join(root, 'master.m3u8'))) fs.rmSync(root, { recursive: true, force: true });
    }
    if (fs.existsSync(path.join(root, 'master.m3u8'))) {
      return this.publicStatus(mediaId, cacheKey, { state: 'ready', progress: 100, mode: request.mode, qualities: this.readQualities(mediaId, cacheKey) });
    }
    const current = this.jobs.get(stateKey);
    if (current?.state === 'running' || current?.state === 'queued') return this.publicStatus(mediaId, cacheKey, current);

    const encoder = this.getEncoder();
    const publicState = {
      state: 'queued', progress: 0, mode: request.mode, requestedQuality: request.targetHeight,
      qualities: profiles.map((profile) => profile.name), encoder, startedAt: Date.now(),
      message: request.mode === 'compatibility' ? 'Preparing compatible stream' : request.mode === 'manual' ? 'Preparing selected quality' : 'Preparing adaptive stream',
    };
    this.jobs.set(stateKey, publicState);
    const job = this.jobManager.start('hls', `Generate ${request.mode} stream: ${item.title}`, async ({ update, signal }) => {
      const run = async (selectedEncoder) => {
        await this.prepareDirectory(root, profiles);
        publicState.encoder = selectedEncoder;
        publicState.state = 'running';
        update({ message: `Encoding ${request.mode} stream with ${selectedEncoder}`, metadata: { mediaId, mode: request.mode, cacheKey } });
        await this.runFfmpeg(item, root, stateKey, profiles, selectedEncoder, signal, (progress) => {
          publicState.progress = progress;
          update({ progress, message: `Generating ${profiles.length} quality level${profiles.length === 1 ? '' : 's'}` });
        });
      };
      let release;
      try {
        if (this.activeEncodes >= this.maxConcurrent) publicState.message = 'Waiting for the transcoding queue';
        update({ message: publicState.message });
        release = await this.acquireEncoder(signal);
        try { await run(encoder); }
        catch (err) {
          if (signal.aborted || encoder === 'libx264') throw err;
          publicState.message = `${encoder} failed; retrying with software encoding`;
          update({ progress: 0, message: publicState.message });
          await run('libx264');
        }
        await fs.promises.writeFile(metadataPath, JSON.stringify({ fileSize: Number(item.file_size) || 0, modifiedAt: Number(item.modified_at) || 0, generatedAt: Date.now(), mode: request.mode }));
        publicState.state = 'ready';
        publicState.progress = 100;
        publicState.message = request.mode === 'compatibility' ? 'Compatible stream ready' : 'Stream ready';
        return { mediaId, mode: request.mode, cacheKey, qualities: publicState.qualities, encoder: publicState.encoder };
      } catch (err) {
        publicState.state = signal.aborted ? 'cancelled' : 'failed';
        publicState.error = err.message || 'Stream generation failed.';
        publicState.message = publicState.error;
        throw err;
      } finally { release?.(); }
    }, { mediaId, mode: request.mode, cacheKey, qualities: publicState.qualities });
    publicState.jobId = job.id;
    return this.publicStatus(mediaId, cacheKey, publicState);
  }

  async prepareDirectory(root, profiles) {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.mkdir(root, { recursive: true });
    await Promise.all(profiles.map((profile) => fs.promises.mkdir(path.join(root, profile.name), { recursive: true })));
  }

  runFfmpeg(item, root, stateKey, profiles, encoder, signal, onProgress) {
    const filters = profiles.map((profile, index) => encoder === 'h264_vaapi'
      ? `[split${index}]format=nv12,hwupload,scale_vaapi=w=-2:h=${profile.height}[v${index}]`
      : `[split${index}]scale=w=-2:h=${profile.height}:force_original_aspect_ratio=decrease[v${index}]`).join(';');
    const splitTargets = profiles.map((_profile, index) => `[split${index}]`).join('');
    const args = ['-hide_banner', '-y'];
    if (encoder === 'h264_vaapi') args.push('-vaapi_device', '/dev/dri/renderD128');
    args.push('-i', item.file_path, '-filter_complex', `[0:v]split=${profiles.length}${splitTargets};${filters}`);
    const hasAudio = !!item.audio_codec;
    profiles.forEach((profile, index) => {
      args.push('-map', `[v${index}]`);
      if (hasAudio) args.push('-map', '0:a:0?');
      args.push(`-c:v:${index}`, encoder, `-b:v:${index}`, `${profile.bitrateKbps}k`, `-maxrate:v:${index}`, `${Math.round(profile.bitrateKbps * 1.08)}k`, `-bufsize:v:${index}`, `${profile.bitrateKbps * 2}k`);
      if (encoder === 'libx264') args.push(`-preset:v:${index}`, 'veryfast');
      if (hasAudio) args.push(`-c:a:${index}`, 'aac', `-b:a:${index}`, `${profile.audioKbps}k`, `-ac:a:${index}`, '2');
    });
    const streamMap = profiles.map((_profile, index) => hasAudio ? `v:${index},a:${index},name:${profiles[index].name}` : `v:${index},name:${profiles[index].name}`).join(' ');
    args.push('-force_key_frames', 'expr:gte(t,n_forced*6)', '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_list_size', '0', '-hls_flags', 'independent_segments+temp_file', '-master_pl_name', 'master.m3u8', '-var_stream_map', streamMap, '-hls_segment_filename', path.join(root, '%v', 'segment_%05d.ts'), '-progress', 'pipe:2', '-nostats', path.join(root, '%v', 'index.m3u8'));
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.ffmpegPath, args, { windowsHide: true });
      const state = this.jobs.get(stateKey);
      if (state) state.process = child;
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-12_000);
        const matches = Array.from(String(chunk).matchAll(/out_time_ms=(\d+)/g));
        const microseconds = Number(matches.at(-1)?.[1]);
        const duration = Number(item.duration_seconds) || 0;
        if (microseconds > 0 && duration > 0) onProgress(Math.min(99, Math.round((microseconds / 1_000_000 / duration) * 100)));
      });
      const abort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) return reject(new Error('Stream generation was cancelled.'));
        if (code === 0 && fs.existsSync(path.join(root, 'master.m3u8'))) return resolve();
        reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `FFmpeg exited with code ${code}.`));
      });
    });
  }

  resolveAsset(mediaId, cacheKey, parts) {
    const id = safeMediaId(mediaId);
    if (!id) return null;
    let key = cacheKey;
    let assetParts = parts;
    if (Array.isArray(cacheKey)) { key = 'adaptive'; assetParts = cacheKey; }
    if (!/^(?:adaptive|manual-\d+|compatibility-\d+)$/.test(String(key || ''))) return null;
    const root = this.rootFor(id, key);
    const candidate = path.resolve(root, ...(assetParts || []));
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  }

  async clearCache() {
    for (const state of this.jobs.values()) if (state.state === 'running' || state.state === 'queued') throw new Error('Wait for active HLS jobs to finish before clearing the cache.');
    await fs.promises.rm(this.cacheDir, { recursive: true, force: true });
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    this.jobs.clear();
  }
}

module.exports = { HlsManager, QUALITY_PROFILES, availableProfiles, normalizeHlsRequest, profilesForRequest, cacheKeyForRequest };
