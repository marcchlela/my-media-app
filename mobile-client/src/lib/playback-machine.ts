export type PlaybackState =
  | 'idle'
  | 'direct-loading'
  | 'direct-playing'
  | 'direct-failed'
  | 'hls-preparing'
  | 'hls-playing'
  | 'hls-failed';

export type PlaybackModel = { state: PlaybackState; fallbackAttempted: boolean };
export type PlaybackEvent =
  | { type: 'LOAD_DIRECT' }
  | { type: 'DIRECT_PLAYING' }
  | { type: 'DIRECT_FATAL' }
  | { type: 'PREPARE_HLS' }
  | { type: 'HLS_PLAYING' }
  | { type: 'HLS_FATAL' }
  | { type: 'RESET' };

export const initialPlaybackModel: PlaybackModel = { state: 'idle', fallbackAttempted: false };

export function playbackReducer(model: PlaybackModel, event: PlaybackEvent): PlaybackModel {
  switch (event.type) {
    case 'LOAD_DIRECT': return { state: 'direct-loading', fallbackAttempted: false };
    case 'DIRECT_PLAYING': return model.state === 'direct-loading' ? { ...model, state: 'direct-playing' } : model;
    case 'DIRECT_FATAL':
      return (model.state === 'direct-loading' || model.state === 'direct-playing') && !model.fallbackAttempted
        ? { state: 'direct-failed', fallbackAttempted: false }
        : model;
    case 'PREPARE_HLS':
      return model.state === 'direct-failed' || model.state === 'direct-loading' || model.state === 'direct-playing' || model.state === 'hls-playing' || model.state === 'hls-failed'
        ? { state: 'hls-preparing', fallbackAttempted: true }
        : model;
    case 'HLS_PLAYING': return model.state === 'hls-preparing' ? { ...model, state: 'hls-playing' } : model;
    case 'HLS_FATAL':
      return model.state === 'direct-failed' || model.state === 'hls-preparing' || model.state === 'hls-playing'
        ? { state: 'hls-failed', fallbackAttempted: true }
        : model;
    case 'RESET': return initialPlaybackModel;
    default: return model;
  }
}

export function canAutomaticallyFallback(model: PlaybackModel) {
  return model.state === 'direct-failed' && !model.fallbackAttempted;
}
