const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const appRoot = process.cwd();
const { JobManager } = require(path.join(appRoot, 'job-manager'));
const { HlsManager } = require(path.join(appRoot, 'hls-manager'));
const { detectMediaTools } = require(path.join(appRoot, 'system-monitor'));

execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '/data/source.mp4',
]);
const source = fs.statSync('/data/source.mp4');
const jobs = new JobManager();
const manager = new HlsManager({
  cacheDir: '/data/cache/hls',
  jobManager: jobs,
  tools: detectMediaTools(),
});
manager.start({
  id: 'media_smoke',
  title: 'Container smoke test',
  file_path: '/data/source.mp4',
  width: 640,
  height: 360,
  duration_seconds: 3,
  file_size: source.size,
  modified_at: source.mtimeMs,
  audio_codec: 'aac',
});

const deadline = Date.now() + 60_000;
const timer = setInterval(() => {
  const status = manager.getStatus('media_smoke');
  if (status.state === 'ready') {
    clearInterval(timer);
    console.log(JSON.stringify(status));
    process.exit(0);
  }
  if (status.state === 'failed' || Date.now() > deadline) {
    clearInterval(timer);
    console.error(JSON.stringify(status));
    process.exit(1);
  }
}, 250);
