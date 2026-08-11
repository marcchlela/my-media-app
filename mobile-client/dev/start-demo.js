const { spawn } = require('node:child_process');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['expo', 'start', ...process.argv.slice(2)], {
  cwd: require('node:path').resolve(__dirname, '..'),
  env: { ...process.env, EXPO_PUBLIC_MYFLIX_DEMO: 'true' },
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`Could not start Expo: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code || 0;
});
