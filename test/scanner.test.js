const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myflix-scanner-test-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.ADMIN_EMAILS = '';

const { closeDatabase } = require('../account-store');
const { MediaScanner, detectChapterPlaybackMarkers } = require('../media-scanner');

test('chapter markers prefer named chapters and estimate credits conservatively', () => {
  const named = detectChapterPlaybackMarkers([
    { start_time: '12.5', end_time: '98.25', tags: { title: 'Opening Theme' } },
    { start_time: '2460', end_time: '2520', tags: { title: 'End Credits' } },
  ], 2520);
  assert.equal(named.introStart, 12.5);
  assert.equal(named.introEnd, 98.25);
  assert.equal(named.creditsStart, 2460);
  assert.equal(named.markerSource, 'chapter');

  const estimated = detectChapterPlaybackMarkers([], 1800);
  assert.equal(estimated.creditsStart, 1725);
  assert.equal(estimated.markerSource, 'duration-estimate');
});
const { getDb, getPublicLibrary } = require('../media-store');

test.after(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

test('scanner is incremental, keeps stable IDs, and preserves offline catalogs', async () => {
  const movies = path.join(root, 'Movies');
  const tv = path.join(root, 'TV Shows');
  fs.mkdirSync(path.join(movies, 'Subtitles'), { recursive: true });
  fs.mkdirSync(path.join(tv, 'Alpha', 'Season 1'), { recursive: true });
  fs.mkdirSync(path.join(tv, 'Bravo'), { recursive: true });
  fs.writeFileSync(path.join(movies, 'Test.Movie.mp4'), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(movies, 'Subtitles', 'Test.Movie.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello');
  fs.writeFileSync(path.join(tv, 'Alpha', 'Season 1', 'Alpha.S01E01.mp4'), Buffer.alloc(32, 2));
  fs.writeFileSync(path.join(tv, 'Bravo', 'Bravo.S01E02.mkv'), Buffer.alloc(32, 3));

  let probes = 0;
  const scanner = new MediaScanner({
    moviesDir: movies,
    tvShowsDir: tv,
    tmdb: { configured: false },
    inspectMedia: async () => {
      probes += 1;
      return { durationSeconds: 120, width: 1920, height: 1080 };
    },
  });
  const first = await scanner.scan();
  assert.equal(first.status.new, 3);
  assert.equal(probes, 3);
  const initial = getPublicLibrary();
  assert.equal(initial.length, 3);
  assert.equal(initial.some((item) => Object.hasOwn(item, 'path')), false);
  assert.equal(initial.find((item) => item.title === 'Test Movie').subtitles.length, 1);
  assert.deepEqual(new Set(initial.filter((item) => item.isShow).map((item) => item.showName)), new Set(['Alpha', 'Bravo']));

  const ids = new Map(initial.map((item) => [item.title, item.id]));
  const second = await scanner.scan();
  assert.equal(second.status.unchanged, 3);
  assert.equal(probes, 3);
  assert.deepEqual(new Map(getPublicLibrary().map((item) => [item.title, item.id])), ids);

  fs.renameSync(movies, `${movies}-offline`);
  const offline = await scanner.scan();
  assert.ok(offline.status.errors.some((error) => error.includes('movies')));
  assert.equal(getPublicLibrary().length, 3);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM media_items WHERE media_type = 'movie'").get().count, 1);
  fs.renameSync(`${movies}-offline`, movies);
  const restored = await scanner.scan();
  assert.equal(restored.status.errors.length, 0);
  assert.equal(getPublicLibrary().find((item) => item.title === 'Test Movie').available, true);
});

test('catalog schema migration version is recorded', () => {
  assert.ok(Number(getDb().prepare('PRAGMA user_version').get().user_version) >= 5);
});
