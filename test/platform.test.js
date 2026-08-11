const test = require('node:test');
const assert = require('node:assert/strict');

const { availableProfiles } = require('../hls-manager');
const { findRepeatedSegment, parseFingerprintOutput, popcount32 } = require('../intro-detector');
const { JobManager } = require('../job-manager');
const { StreamManager } = require('../stream-manager');

function fingerprint(seconds) {
  return seconds.flatMap((value) => Array(8).fill(value));
}

function pseudoRandomSeries(length, seed = 91) {
  let value = seed >>> 0;
  return Array.from({ length }, () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value | 0;
  });
}

test('adaptive profiles never upscale beyond the source height', () => {
  assert.deepEqual(availableProfiles({ height: 2160 }).map((item) => item.name), ['2160p', '1080p', '720p', '480p', '360p']);
  assert.deepEqual(availableProfiles({ height: 1080 }).map((item) => item.name), ['1080p', '720p', '480p', '360p']);
  assert.deepEqual(availableProfiles({ height: 720 }).map((item) => item.name), ['720p', '480p', '360p']);
  assert.deepEqual(availableProfiles({ height: 360 }).map((item) => item.name), ['360p']);
});

test('audio fingerprint matcher locates a shifted recurring intro', () => {
  const referenceSeconds = pseudoRandomSeries(120);
  const candidateSeconds = pseudoRandomSeries(120, 1729);
  candidateSeconds.splice(33, 35, ...referenceSeconds.slice(20, 55));
  const match = findRepeatedSegment(fingerprint(referenceSeconds), fingerprint(candidateSeconds), {
    maxOffsetSeconds: 20,
    minLengthSeconds: 25,
    maxLengthSeconds: 90,
  });
  assert.ok(match);
  assert.equal(match.referenceStart, 20);
  assert.equal(match.candidateStart, 33);
  assert.ok(match.length >= 34);
  assert.ok(match.confidence > 0.9);
});

test('fingerprint parsing and Hamming distance are stable', () => {
  assert.deepEqual(parseFingerprintOutput('DURATION=3\nFINGERPRINT=1,-1,3\n'), [1, -1, 3]);
  assert.equal(popcount32(0), 0);
  assert.equal(popcount32(-1), 32);
});

test('job and stream managers expose safe public lifecycle snapshots', async () => {
  const jobs = new JobManager();
  const started = jobs.start('test', 'Small operation', async ({ update }) => {
    update({ progress: 42, message: 'Halfway' });
    return { value: 7 };
  });
  assert.match(started.id, /^job_/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const snapshot = jobs.snapshot();
  assert.equal(snapshot.active.length, 0);
  assert.equal(snapshot.recent[0].state, 'completed');
  assert.deepEqual(snapshot.recent[0].result, { value: 7 });

  const streams = new StreamManager({ timeoutMs: 20 });
  const session = streams.touch({ mediaId: 'media_1', title: 'Feature', quality: '720p' }, { userId: 2, userName: 'Viewer' });
  assert.equal(streams.snapshot()[0].sessionId, session.sessionId);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(streams.snapshot().length, 0);
});
