import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoLibrary } from './demo-data';
import { isDemoModeAvailable } from './demo-mode';
import { continueWatching, groupShows, searchLibrary } from '../lib/library';

test('demo mode requires both development runtime and explicit opt-in', () => {
  assert.equal(isDemoModeAvailable(true, 'true'), true);
  assert.equal(isDemoModeAvailable(false, 'true'), false);
  assert.equal(isDemoModeAvailable(true, 'false'), false);
  assert.equal(isDemoModeAvailable(true, undefined), false);
});

test('demo catalog exercises movies, shows, search, seasons, and progress', () => {
  const library = createDemoLibrary();
  const shows = groupShows(library);
  assert.ok(library.some((item) => !item.isShow));
  assert.equal(shows.find((show) => show.name === 'Signal House')?.episodes.length, 4);
  assert.ok(continueWatching(library).length >= 2);
  assert.equal(searchLibrary(library, 'science fiction').movies[0]?.title, 'The Glass Orbit');
  assert.equal(library.some((item) => /^https?:/i.test(String(item.posterPath || item.streamUrl))), false);
});
