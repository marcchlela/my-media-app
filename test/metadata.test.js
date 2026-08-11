const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myflix-metadata-test-'));
const movies = path.join(root, 'Movies');
const tv = path.join(root, 'TV Shows');
fs.mkdirSync(movies, { recursive: true });
fs.mkdirSync(tv, { recursive: true });
fs.writeFileSync(path.join(movies, 'Test.Movie.2020.1080p.mp4'), Buffer.alloc(32, 4));
process.env.DATA_DIR = path.join(root, 'data');

const { closeDatabase } = require('../account-store');
const { MediaScanner } = require('../media-scanner');
const { MetadataManager } = require('../metadata-manager');
const {
  getDb,
  getPrivateShow,
  getPublicLibrary,
  saveScannedMedia,
  updatePlaybackMarkers,
  upsertMediaSource,
  upsertShow,
} = require('../media-store');

test.after(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

function metadata(id, title, posterPath) {
  return {
    tmdbId: id,
    title,
    posterPath,
    backdropPath: `/backdrop-${id}.jpg`,
    overview: `${title} overview`,
    releaseDate: '2020-01-01',
    genres: ['Drama'],
    rating: 8,
    runtimeMinutes: 100,
  };
}

test('unchanged media gets metadata-only enrichment without another probe', async () => {
  let probes = 0;
  const initial = new MediaScanner({
    moviesDir: movies,
    tvShowsDir: tv,
    tmdb: { configured: false },
    inspectMedia: async () => {
      probes += 1;
      return { durationSeconds: 6000, width: 1920, height: 1080 };
    },
  });
  await initial.scan();
  assert.equal(probes, 1);

  const tmdb = {
    configured: true,
    enrichMovie: async () => metadata(10, 'Test Movie', '/automatic.jpg'),
    enrichShow: async () => null,
    enrichEpisode: async () => null,
    fetchMetadata: async (_type, id) => metadata(id, id === 22 ? 'Manual Movie' : 'Test Movie', `/manual-${id}.jpg`),
    search: async () => [],
  };
  const scanner = new MediaScanner({
    moviesDir: movies,
    tvShowsDir: tv,
    tmdb,
    inspectMedia: async () => {
      probes += 1;
      throw new Error('unchanged file must not be probed');
    },
  });
  const second = await scanner.scan();
  assert.equal(probes, 1);
  assert.equal(second.status.updated, 1);
  assert.equal(getPublicLibrary()[0].posterPath, '/automatic.jpg');

  const itemId = getPublicLibrary()[0].id;
  const manager = new MetadataManager({ tmdb });
  await manager.applyManualMatch('movie', itemId, 22);
  assert.equal(getPublicLibrary()[0].title, 'Manual Movie');
  assert.equal(getPublicLibrary()[0].metadataLocked, true);

  await scanner.scan();
  assert.equal(getPublicLibrary()[0].title, 'Manual Movie');
  assert.equal(getPublicLibrary()[0].posterPath, '/manual-22.jpg');

  assert.equal(manager.clearManualMatch('movie', itemId), true);
  const cleared = getDb().prepare('SELECT * FROM media_items WHERE id = ?').get(itemId);
  assert.equal(cleared.title, 'Test Movie');
  assert.equal(cleared.tmdb_id, null);
  assert.equal(cleared.metadata_locked, 0);

  const retried = await manager.retryAutomatic('movie', itemId);
  assert.equal(retried.state, 'matched');
  assert.equal(getPublicLibrary()[0].posterPath, '/automatic.jpg');
});

test('manual show match persists and refreshes associated episodes', async () => {
  const source = upsertMediaSource('tv', tv);
  const show = upsertShow('Example Show', { sourceTitle: 'Example Show' });
  const directory = path.join(tv, 'Example Show');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'Example.Show.S01E01.mp4');
  fs.writeFileSync(filePath, Buffer.alloc(24, 5));
  const episode = saveScannedMedia({
    sourceId: source.id,
    mediaType: 'episode',
    showId: show.id,
    filePath,
    filename: path.basename(filePath),
    title: 'Episode 1',
    sourceTitle: 'Episode 1',
    normalizedTitle: 'episode 1',
    seasonNumber: 1,
    episodeNumber: 1,
    fileSize: 24,
    modifiedAt: fs.statSync(filePath).mtimeMs,
  });
  const manager = new MetadataManager({
    tmdb: {
      configured: true,
      fetchMetadata: async () => metadata(44, 'Canonical Show', '/show.jpg'),
      enrichEpisode: async () => ({ tmdbId: 4401, title: 'Pilot', overview: 'Pilot overview' }),
    },
  });
  await manager.applyManualMatch('show', show.id, 44);
  assert.equal(getPrivateShow(show.id).title, 'Canonical Show');
  assert.equal(getPrivateShow(show.id).metadata_locked, 1);
  assert.equal(getDb().prepare('SELECT title FROM media_items WHERE id = ?').get(episode.id).title, 'Pilot');
  assert.equal(updatePlaybackMarkers(episode.id, { introStart: 12, introEnd: 48, creditsStart: 1330 }), true);
  const publicEpisode = getPublicLibrary().find((item) => item.id === episode.id);
  assert.deepEqual(publicEpisode.playbackMarkers, {
    introStart: 12,
    introEnd: 48,
    creditsStart: 1330,
    introConfidence: 1,
    creditsConfidence: 1,
    source: 'manual',
  });
  assert.equal(manager.clearManualMatch('show', show.id), true);
  assert.equal(getPrivateShow(show.id).title, 'Example Show');
  assert.equal(getPrivateShow(show.id).tmdb_id, null);
});
