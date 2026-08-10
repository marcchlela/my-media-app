const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanLookupTitle, pickSafeMatch, rankTmdbResults } = require('../tmdb-service');

test('TMDB matching accepts a strong title/year match', () => {
  const lookup = cleanLookupTitle('The.Batman.2022.1080p.WEB-DL.mkv');
  const results = [
    { id: 1, title: 'The Batman', release_date: '2022-03-01' },
    { id: 2, title: 'Batman', release_date: '1989-06-23' },
  ];
  assert.equal(pickSafeMatch(results, lookup, 'movie')?.id, 1);
  assert.equal(rankTmdbResults(results, lookup, 'movie')[0].result.id, 1);
});

test('TMDB matching refuses ambiguous exact titles without a year', () => {
  const lookup = cleanLookupTitle('The Thing');
  const results = [
    { id: 1, title: 'The Thing', release_date: '1982-06-25' },
    { id: 2, title: 'The Thing', release_date: '2011-10-14' },
  ];
  assert.equal(pickSafeMatch(results, lookup, 'movie'), null);
});
