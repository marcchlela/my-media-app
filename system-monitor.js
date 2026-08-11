const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function commandStatus(command, args = ['-version']) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    return {
      available: result.status === 0,
      version: output.split(/\r?\n/)[0] || null,
      output,
    };
  } catch (err) {
    return { available: false, version: null, output: err.message || '' };
  }
}

function detectMediaTools(ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', fingerprintPath = process.env.FPCALC_PATH || 'fpcalc') {
  const ffmpeg = commandStatus(ffmpegPath);
  const fpcalc = commandStatus(fingerprintPath, ['-version']);
  const encoderProbe = ffmpeg.available ? commandStatus(ffmpegPath, ['-hide_banner', '-encoders']) : { output: '' };
  const output = encoderProbe.output || '';
  const encoders = {
    software: /\blibx264\b/.test(output),
    intelQsv: /\bh264_qsv\b/.test(output),
    nvidiaNvenc: /\bh264_nvenc\b/.test(output),
    vaapi: /\bh264_vaapi\b/.test(output),
  };
  const driAvailable = fs.existsSync('/dev/dri/renderD128');
  const nvidiaDeviceAvailable = fs.existsSync('/dev/nvidia0');
  return {
    ffmpeg: { available: ffmpeg.available, version: ffmpeg.version, path: ffmpegPath },
    fingerprint: { available: fpcalc.available, version: fpcalc.version, path: fingerprintPath },
    encoders,
    gpuDeviceAvailable: driAvailable,
    nvidiaDeviceAvailable,
    recommendedEncoder: encoders.intelQsv && driAvailable
      ? 'h264_qsv'
      : encoders.vaapi && driAvailable
        ? 'h264_vaapi'
        : encoders.nvidiaNvenc && nvidiaDeviceAvailable
        ? 'h264_nvenc'
        : 'libx264',
  };
}

function storageSnapshot(targetPath) {
  try {
    const resolved = path.resolve(targetPath);
    const stats = fs.statfsSync(resolved);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return {
      path: resolved,
      available: true,
      totalBytes: total,
      freeBytes: free,
      usedBytes: Math.max(0, total - free),
      usedPercent: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0,
    };
  } catch (err) {
    return { path: path.resolve(targetPath), available: false, error: err.message || 'Storage unavailable.' };
  }
}

function readTemperatures() {
  if (process.platform !== 'linux') return [];
  try {
    return fs.readdirSync('/sys/class/thermal', { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('thermal_zone'))
      .map((entry) => {
        const root = path.join('/sys/class/thermal', entry.name);
        const raw = Number(fs.readFileSync(path.join(root, 'temp'), 'utf8').trim());
        const type = fs.readFileSync(path.join(root, 'type'), 'utf8').trim();
        return { name: type || entry.name, celsius: raw > 1000 ? Math.round(raw / 100) / 10 : raw };
      })
      .filter((entry) => Number.isFinite(entry.celsius));
  } catch (err) {
    return [];
  }
}

function directorySize(rootPath) {
  let total = 0;
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (err) { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) {
        try { total += fs.statSync(fullPath).size; } catch (err) { /* File changed during inspection. */ }
      }
    }
  }
  return total;
}

function systemSnapshot(options = {}) {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const tools = options.tools || detectMediaTools(options.ffmpegPath, options.fingerprintPath);
  return {
    host: {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      uptimeSeconds: os.uptime(),
      container: fs.existsSync('/.dockerenv'),
    },
    cpu: {
      model: cpus[0]?.model || 'Unknown CPU',
      cores: cpus.length,
      loadAverage: os.loadavg(),
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedBytes: totalMemory - freeMemory,
      usedPercent: totalMemory ? Math.round(((totalMemory - freeMemory) / totalMemory) * 1000) / 10 : 0,
      processBytes: process.memoryUsage().rss,
    },
    temperatures: readTemperatures(),
    tools,
    node: process.version,
    processUptimeSeconds: process.uptime(),
  };
}

module.exports = {
  detectMediaTools,
  directorySize,
  storageSnapshot,
  systemSnapshot,
};
