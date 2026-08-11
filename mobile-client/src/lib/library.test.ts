import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaItem } from '../api/types';
import { continueWatching, findNextEpisode, groupShows, progressPayload, searchLibrary } from './library';

function media(overrides: Partial<MediaItem>): MediaItem {
  return {
    id: 'media_1', name: 'Feature', title: 'Feature', isShow: false, showId: null, showKey: null, showName: null,
    episode: null, tmdbId: null, posterPath: null, backdropPath: null, overview: null, releaseDate: null, rating: null,
    runtime: 90, genreNames: [], qualityTags: [], mimeType: 'video/mp4', available: true, streamUrl: '/api/media/media_1/stream',
    subtitles: [], isFavorite: false, watchProgress: null, playbackMarkers: null, ...overrides,
  };
}

test('maps episodes into sorted native show and season groups', () => {
  const later = media({ id: 'ep2', isShow: true, showId: 'show_1', showName: 'Show', episode: { season: 2, episode: 1 } });
  const first = media({ id: 'ep1', isShow: true, showId: 'show_1', showName: 'Show', episode: { season: 1, episode: 3 }, isFavorite: true });
  const [show] = groupShows([later, first]);
  assert.equal(show?.id, 'show_1');
  assert.deepEqual(show?.episodes.map((entry) => entry.id), ['ep1', 'ep2']);
  assert.equal(show?.isFavorite, true);
  assert.equal(findNextEpisode([later, first], first)?.id, 'ep2');
});

test('continue watching, search, and progress payloads remain server-compatible', () => {
  const movie = media({ title: 'Night Feature', genreNames: ['Drama'], watchProgress: { position: 30, duration: 100, percent: 30, updatedAt: 8 } });
  assert.deepEqual(continueWatching([movie]).map((entry) => entry.id), ['media_1']);
  assert.equal(searchLibrary([movie], 'drama').movies.length, 1);
  const payload = progressPayload(movie.id, 45, 90);
  assert.equal(payload.mediaId, movie.id);
  assert.equal(payload.percent, 50);
});
