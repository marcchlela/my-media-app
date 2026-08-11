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
  return profiles.length ? profiles : [QUALITY_PROFILES[QUALITY_PROFILES.length - 1]];
}

class HlsManager {
  constructor(options = {}) {
    this.cacheDir = path.resolve(options.cacheDir);
    this.ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
    this.jobManager = options.jobManager;
    this.tools = options.tools || {};
    this.jobsByMedia = new Map();
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
        reject(new Error('Adaptive stream generation was cancelled.'));
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

  getStatus(mediaId) {
    const id = safeMediaId(mediaId);
    if (!id) return null;
    const active = this.jobsByMedia.get(id);
    const masterPath = path.join(this.cacheDir, id, 'master.m3u8');
    if (fs.existsSync(masterPath)) {
      return {
        state: 'ready',
        progress: 100,
        qualities: active?.qualities || this.readQualities(id),
        masterUrl: `/api/media/${id}/hls/master.m3u8`,
        encoder: active?.encoder || null,
      };
    }
    return active ? { ...active, process: undefined } : { state: 'idle', progress: 0 };
  }

  readQualities(mediaId) {
    const root = path.join(this.cacheDir, mediaId);
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+p$/.test(entry.name))
        .map((entry) => entry.name);
    } catch (err) {
      return [];
    }
  }

  start(item) {
    if (!this.tools.ffmpeg?.available) throw new Error('FFmpeg is unavailable on this server.');
    const mediaId = safeMediaId(item?.id);
    if (!mediaId || !item?.file_path) throw new Error('Invalid media item.');
    const cacheMetadataPath = path.join(this.cacheDir, mediaId, 'source.json');
    try {
      const cacheMetadata = JSON.parse(fs.readFileSync(cacheMetadataPath, 'utf8'));
      if (Number(cacheMetadata.fileSize) !== Number(item.file_size) || Number(cacheMetadata.modifiedAt) !== Number(item.modified_at)) {
        fs.rmSync(path.join(this.cacheDir, mediaId), { recursive: true, force: true });
        this.jobsByMedia.delete(mediaId);
      }
    } catch (err) {
      if (fs.existsSync(path.join(this.cacheDir, mediaId, 'master.m3u8'))) {
        fs.rmSync(path.join(this.cacheDir, mediaId), { recursive: true, force: true });
      }
    }
    const current = this.getStatus(mediaId);
    if (current?.state === 'ready' || current?.state === 'running' || current?.state === 'queued') return current;

    const profiles = availableProfiles(item);
    const encoder = this.getEncoder();
    const publicState = {
      state: 'queued',
      progress: 0,
      qualities: profiles.map((profile) => profile.name),
      encoder,
      startedAt: Date.now(),
      message: 'Preparing adaptive stream',
    };
    this.jobsByMedia.set(mediaId, publicState);
    const job = this.jobManager.start('hls', `Generate adaptive stream: ${item.title}`, async ({ update, signal }) => {
      const run = async (selectedEncoder) => {
        await this.prepareMediaDirectory(mediaId, profiles);
        publicState.encoder = selectedEncoder;
        publicState.state = 'running';
        publicState.message = `Encoding with ${selectedEncoder}`;
        update({ message: publicState.message, metadata: { mediaId, encoder: selectedEncoder } });
        await this.runFfmpeg(item, profiles, selectedEncoder, signal, (progress) => {
          publicState.progress = progress;
          update({ progress, message: `Generating ${profiles.length} quality levels` });
        });
      };
      let releaseEncoder = null;
      try {
        publicState.message = this.activeEncodes >= this.maxConcurrent ? 'Waiting for the transcoding queue' : publicState.message;
        update({ message: publicState.message });
        releaseEncoder = await this.acquireEncoder(signal);
        try {
          await run(encoder);
        } catch (err) {
          if (signal.aborted || encoder === 'libx264') throw err;
          publicState.message = `${encoder} failed; retrying with software encoding`;
          update({ progress: 0, message: publicState.message });
          await run('libx264');
        }
        await fs.promises.writeFile(cacheMetadataPath, JSON.stringify({
          fileSize: Number(item.file_size) || 0,
          modifiedAt: Number(item.modified_at) || 0,
          generatedAt: Date.now(),
        }));
        publicState.state = 'ready';
        publicState.progress = 100;
        publicState.message = 'Adaptive stream ready';
        return { mediaId, qualities: publicState.qualities, encoder: publicState.encoder };
      } catch (err) {
        publicState.state = signal.aborted ? 'cancelled' : 'failed';
        publicState.error = err.message || 'Adaptive stream generation failed.';
        publicState.message = publicState.error;
        throw err;
      } finally {
        releaseEncoder?.();
      }
    }, { mediaId, title: item.title, qualities: publicState.qualities });
    publicState.jobId = job.id;
    return { ...publicState };
  }

  async prepareMediaDirectory(mediaId, profiles) {
    const root = path.join(this.cacheDir, mediaId);
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.mkdir(root, { recursive: true });
    await Promise.all(profiles.map((profile) => fs.promises.mkdir(path.join(root, profile.name), { recursive: true })));
  }

  runFfmpeg(item, profiles, encoder, signal, onProgress) {
    const root = path.join(this.cacheDir, item.id);
    const filters = profiles
      .map((profile, index) => encoder === 'h264_vaapi'
        ? `[split${index}]format=nv12,hwupload,scale_vaapi=w=-2:h=${profile.height}[v${index}]`
        : `[split${index}]scale=w=-2:h=${profile.height}:force_original_aspect_ratio=decrease[v${index}]`)
      .join(';');
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
    const streamMap = profiles.map((_profile, index) => (
      hasAudio ? `v:${index},a:${index},name:${profiles[index].name}` : `v:${index},name:${profiles[index].name}`
    )).join(' ');
    args.push(
      '-force_key_frames', 'expr:gte(t,n_forced*6)',
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments+temp_file',
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', streamMap,
      '-hls_segment_filename', path.join(root, '%v', 'segment_%05d.ts'),
      '-progress', 'pipe:2',
      '-nostats',
      path.join(root, '%v', 'index.m3u8')
    );

    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, { windowsHide: true });
      const state = this.jobsByMedia.get(item.id);
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
        if (signal.aborted) return reject(new Error('Adaptive stream generation was cancelled.'));
        if (code === 0 && fs.existsSync(path.join(root, 'master.m3u8'))) return resolve();
        reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `FFmpeg exited with code ${code}.`));
      });
    });
  }

  resolveAsset(mediaId, parts) {
    const id = safeMediaId(mediaId);
    if (!id) return null;
    const root = path.join(this.cacheDir, id);
    const candidate = path.resolve(root, ...parts);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  }

  async clearCache() {
    for (const state of this.jobsByMedia.values()) {
      if (state.state === 'running' || state.state === 'queued') throw new Error('Wait for active HLS jobs to finish before clearing the cache.');
    }
    await fs.promises.rm(this.cacheDir, { recursive: true, force: true });
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    this.jobsByMedia.clear();
  }
}

module.exports = { HlsManager, QUALITY_PROFILES, availableProfiles };
