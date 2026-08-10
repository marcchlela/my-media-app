const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  deriveTvFileInfo,
  isPathInsideRoot,
  parseByteRange,
  parseEpisodeFilename,
  scoreSubtitleMatch,
  titleFromFilename,
} = require('../media-utils');

test('normalizes movie filenames into readable titles', () => {
  assert.equal(titleFromFilename('Sound.of.Metal.1080p.x264.mp4'), 'Sound of Metal');
  assert.equal(titleFromFilename('The_Batman.mp4'), 'The Batman');
});

test('parses single and multi-episode TV filenames', () => {
  assert.deepEqual(parseEpisodeFilename('Show.Name.S03E24-E25.1080p.mkv'), {
    season: 3,
    episode: 24,
    episodeEnd: 25,
    showName: 'Show Name',
    episodeTitle: '',
    code: 'S03E24',
  });
});

test('supports season folders and episodes directly under a show folder', () => {
  const root = path.resolve('/media/TV Shows');
  const season = deriveTvFileInfo(path.join(root, 'Alpha', 'Season 1', 'Alpha.S01E01.mp4'), root);
  const direct = deriveTvFileInfo(path.join(root, 'Bravo', 'Bravo.S02E03.mp4'), root);
  assert.equal(season.showName, 'Alpha');
  assert.equal(season.season, 1);
  assert.equal(direct.showName, 'Bravo');
  assert.equal(direct.episode, 3);
});

test('scores only credible subtitle matches', () => {
  assert.ok(scoreSubtitleMatch('/media/Movies/Test.Movie.mp4', '/media/Movies/Subtitles/Test.Movie.English.srt', 'movie') >= 75);
  assert.equal(scoreSubtitleMatch('/media/Movies/Test.Movie.mp4', '/media/Movies/Subtitles/Another.Film.srt', 'movie'), 0);
  assert.ok(scoreSubtitleMatch('/media/TV/Show/Show.S01E02.mkv', '/media/TV/Show/Subtitles/Show.S01E02.en.srt', 'episode') >= 75);
});

test('validates path containment and byte ranges', () => {
  assert.equal(isPathInsideRoot('/media/Movies/Test.mp4', '/media/Movies'), true);
  assert.equal(isPathInsideRoot('/media/Movies2/Test.mp4', '/media/Movies'), false);
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(parseByteRange('bytes=100-110', 100), null);
  assert.equal(parseByteRange('bytes=0-1,4-5', 100), null);
});
