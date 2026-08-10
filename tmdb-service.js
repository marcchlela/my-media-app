const { resolveTmdbApiKey } = require('./env-config');
const { normalizeComparable, parseMediaTitle } = require('./media-utils');

const TMDB_API_BASE = 'https://api.themoviedb.org/3';

function cleanLookupTitle(value) {
  const parsed = parseMediaTitle(value);
  return {
    title: parsed.lookupTitle,
    year: parsed.year,
    edition: parsed.edition,
  };
}

function editDistance(first, second) {
  const a = String(first || '');
  const b = String(second || '');
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = a[row - 1] === b[column - 1]
        ? diagonal
        : Math.min(diagonal, previous[column - 1], above) + 1;
      diagonal = above;
    }
  }
  return previous[b.length];
}

function titleSimilarity(first, second) {
  const a = normalizeComparable(first);
  const b = normalizeComparable(second);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const characterScore = 1 - (editDistance(a, b) / Math.max(a.length, b.length));
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  const tokenScore = intersection / new Set([...aTokens, ...bTokens]).size;
  return Math.max(characterScore, tokenScore * 0.96);
}

function resultTitleFields(result, type) {
  return type === 'show'
    ? [result?.name, result?.original_name]
    : [result?.title, result?.original_title];
}

function resultYear(result, type) {
  const field = type === 'show' ? result?.first_air_date : result?.release_date;
  const parsed = Number(String(field || '').slice(0, 4));
  return Number.isInteger(parsed) ? parsed : null;
}

function scoreTmdbResult(result, lookup, type) {
  const wanted = normalizeComparable(lookup?.title);
  if (!wanted) return { exact: false, score: 0, similarity: 0, year: resultYear(result, type) };
  const similarities = resultTitleFields(result, type)
    .filter(Boolean)
    .map((title) => titleSimilarity(wanted, title));
  const similarity = similarities.length ? Math.max(...similarities) : 0;
  const exact = similarity === 1;
  let score = exact ? 100 : Math.round(similarity * 92);
  const year = resultYear(result, type);
  if (lookup?.year && year) {
    const difference = Math.abs(lookup.year - year);
    if (difference === 0) score += 15;
    else if (difference === 1) score -= 5;
    else score -= 20;
  }
  return { exact, score, similarity, year };
}

function rankTmdbResults(results, lookup, type) {
  return (Array.isArray(results) ? results : [])
    .map((result) => ({ result, ...scoreTmdbResult(result, lookup, type) }))
    .sort((first, second) => second.score - first.score || second.similarity - first.similarity);
}

function pickSafeMatch(results, lookup, type) {
  const ranked = rankTmdbResults(results, lookup, type);
  const top = ranked[0];
  if (!top) return null;
  const runnerUp = ranked[1];
  const margin = runnerUp ? top.score - runnerUp.score : Number.POSITIVE_INFINITY;
  const sameConfidence = runnerUp && top.score === runnerUp.score && top.exact === runnerUp.exact;

  if (top.exact && lookup?.year && top.year === lookup.year && !sameConfidence) return top.result;
  if (top.exact && !lookup?.year) {
    const exactMatches = ranked.filter((candidate) => candidate.exact);
    return exactMatches.length === 1 ? top.result : null;
  }
  if (top.score >= 98 && top.similarity >= 0.9 && margin >= 10) return top.result;
  return null;
}

function mapMetadata(details, type) {
  if (!details) return null;
  const runtime = type === 'show'
    ? details.episode_run_time?.find((value) => Number.isFinite(value))
    : details.runtime;
  return {
    tmdbId: details.id,
    title: details.title || details.name,
    posterPath: details.poster_path || null,
    backdropPath: details.backdrop_path || null,
    overview: details.overview || null,
    releaseDate: details.release_date || details.first_air_date || null,
    genres: (details.genres || []).map((genre) => genre?.name).filter(Boolean),
    rating: Number.isFinite(details.vote_average) ? details.vote_average : null,
    runtimeMinutes: Number.isFinite(runtime) ? runtime : null,
  };
}

function mapSearchCandidate(result, type, lookup) {
  const scored = scoreTmdbResult(result, lookup, type);
  return {
    id: result.id,
    title: type === 'show' ? result.name : result.title,
    originalTitle: type === 'show' ? result.original_name : result.original_title,
    year: scored.year,
    posterPath: result.poster_path || null,
    overview: result.overview || null,
    rating: Number.isFinite(result.vote_average) ? result.vote_average : null,
    confidence: scored.score,
  };
}

function createTmdbService(apiKey = resolveTmdbApiKey()) {
  const key = String(apiKey || '').trim();
  const showCache = new Map();

  async function request(endpoint, query = {}) {
    if (!key) return null;
    const url = new URL(`${TMDB_API_BASE}${endpoint}`);
    url.searchParams.set('api_key', key);
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`TMDB request failed (${response.status}).`);
    return response.json();
  }

  async function search(type, rawTitle) {
    if (!key) return [];
    const lookup = cleanLookupTitle(rawTitle);
    const endpoint = type === 'show' ? '/search/tv' : '/search/movie';
    const yearKey = type === 'show' ? 'first_air_date_year' : 'year';
    const response = await request(endpoint, { query: lookup.title, [yearKey]: lookup.year || '' });
    return rankTmdbResults(response?.results, lookup, type)
      .slice(0, 12)
      .map(({ result }) => mapSearchCandidate(result, type, lookup));
  }

  async function fetchMetadata(type, tmdbId) {
    if (!key || !tmdbId) return null;
    const endpoint = type === 'show' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
    return mapMetadata(await request(endpoint), type);
  }

  async function enrichMovie(rawTitle) {
    if (!key) return null;
    const lookup = cleanLookupTitle(rawTitle);
    const searchResult = await request('/search/movie', { query: lookup.title, year: lookup.year || '' });
    const match = pickSafeMatch(searchResult?.results, lookup, 'movie');
    return match ? fetchMetadata('movie', match.id) : null;
  }

  async function enrichShow(rawTitle) {
    if (!key) return null;
    const lookup = cleanLookupTitle(rawTitle);
    const cacheKey = `${normalizeComparable(lookup.title)}:${lookup.year || ''}`;
    if (showCache.has(cacheKey)) return showCache.get(cacheKey);
    const searchResult = await request('/search/tv', { query: lookup.title, first_air_date_year: lookup.year || '' });
    const match = pickSafeMatch(searchResult?.results, lookup, 'show');
    const metadata = match ? await fetchMetadata('show', match.id) : null;
    showCache.set(cacheKey, metadata);
    return metadata;
  }

  async function enrichEpisode(showTmdbId, season, episode) {
    if (!key || !showTmdbId || !season || !episode) return null;
    const details = await request(`/tv/${showTmdbId}/season/${season}/episode/${episode}`);
    if (!details) return null;
    return {
      tmdbId: details.id || null,
      title: details.name || null,
      overview: details.overview || null,
      rating: Number.isFinite(details.vote_average) ? details.vote_average : null,
      runtimeMinutes: Number.isFinite(details.runtime) ? details.runtime : null,
      backdropPath: details.still_path || null,
    };
  }

  return {
    configured: !!key,
    enrichEpisode,
    enrichMovie,
    enrichShow,
    fetchMetadata,
    request,
    search,
  };
}

module.exports = {
  cleanLookupTitle,
  createTmdbService,
  mapMetadata,
  pickSafeMatch,
  rankTmdbResults,
  scoreTmdbResult,
  titleSimilarity,
};
