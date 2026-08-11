import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutomaticallyFallback, initialPlaybackModel, playbackReducer } from './playback-machine';

test('fatal Direct playback can enter compatibility HLS once', () => {
  let model = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  model = playbackReducer(model, { type: 'DIRECT_FATAL' });
  assert.equal(model.state, 'direct-failed');
  assert.equal(canAutomaticallyFallback(model), true);
  model = playbackReducer(model, { type: 'PREPARE_HLS' });
  assert.equal(model.state, 'hls-preparing');
  assert.equal(model.fallbackAttempted, true);
  model = playbackReducer(model, { type: 'HLS_PLAYING' });
  assert.equal(model.state, 'hls-playing');
});

test('failed HLS never loops automatically back to failed Direct playback', () => {
  let model = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  model = playbackReducer(model, { type: 'DIRECT_FATAL' });
  model = playbackReducer(model, { type: 'PREPARE_HLS' });
  model = playbackReducer(model, { type: 'HLS_FATAL' });
  assert.equal(model.state, 'hls-failed');
  assert.equal(canAutomaticallyFallback(model), false);
  assert.deepEqual(playbackReducer(model, { type: 'DIRECT_FATAL' }), model);
});

test('temporary loading has no state-machine event and cannot trigger fallback', () => {
  const loading = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  assert.equal(loading.state, 'direct-loading');
  assert.equal(canAutomaticallyFallback(loading), false);
});

test('unavailable compatibility support ends in a final HLS failure state', () => {
  let model = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  model = playbackReducer(model, { type: 'DIRECT_FATAL' });
  model = playbackReducer(model, { type: 'HLS_FATAL' });
  assert.equal(model.state, 'hls-failed');
  assert.equal(model.fallbackAttempted, true);
});

test('manual Original choice starts a fresh Direct attempt without creating a loop', () => {
  let model = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  model = playbackReducer(model, { type: 'DIRECT_FATAL' });
  model = playbackReducer(model, { type: 'PREPARE_HLS' });
  model = playbackReducer(model, { type: 'HLS_FATAL' });
  model = playbackReducer(model, { type: 'LOAD_DIRECT' });
  assert.deepEqual(model, { state: 'direct-loading', fallbackAttempted: false });
  assert.equal(canAutomaticallyFallback(model), false);
});

test('a user can manually retry HLS after a final HLS error', () => {
  let model = playbackReducer(initialPlaybackModel, { type: 'LOAD_DIRECT' });
  model = playbackReducer(model, { type: 'DIRECT_FATAL' });
  model = playbackReducer(model, { type: 'HLS_FATAL' });
  model = playbackReducer(model, { type: 'PREPARE_HLS' });
  assert.equal(model.state, 'hls-preparing');
  assert.equal(model.fallbackAttempted, true);
});
