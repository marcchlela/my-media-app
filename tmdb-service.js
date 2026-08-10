const { resolveTmdbApiKey } = require('./env-config');
const { normalizeComparable } = require('./media-utils');

const TMDB_API_BASE = 'https://api.themoviedb.org/3';

function cleanLookupTitle(value) {
  const source = String(value || '').trim();
  const yearMatch = source.match(/(?:^|\s|\()(19\d{2}|20\d{2})(?:\)|\s|$)/);
  return {
    title: source.replace(/(?:^|\s|\()(?:19\d{2}|20\d{2})(?:\)|\s|$)/, ' ').replace(/\s+/g, ' ').trim(),
    year: yearMatch ? Number(yearMatch[1]) : null,
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

  function pickSafeMatch(results, wantedTitle, wantedYear, dateField) {
    const normalizedWanted = normalizeComparable(wantedTitle);
    let exact = (results || []).filter((result) => normalizeComparable(result?.title || result?.name) === normalizedWanted);
    if (wantedYear) {
      const yearMatches = exact.filter((result) => Number(String(result?.[dateField] || '').slice(0, 4)) === wantedYear);
      if (yearMatches.length === 1) return yearMatches[0];
    }
    return exact.length === 1 ? exact[0] : null;
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

  async function enrichMovie(rawTitle) {
    if (!key) return null;
    const lookup = cleanLookupTitle(rawTitle);
    const search = await request('/search/movie', { query: lookup.title, year: lookup.year || '' });
    const match = pickSafeMatch(search?.results, lookup.title, lookup.year, 'release_date');
    if (!match) return null;
    return mapMetadata(await request(`/movie/${match.id}`), 'movie');
  }

  async function enrichShow(rawTitle) {
    if (!key) return null;
    const lookup = cleanLookupTitle(rawTitle);
    const cacheKey = `${normalizeComparable(lookup.title)}:${lookup.year || ''}`;
    if (showCache.has(cacheKey)) return showCache.get(cacheKey);
    const search = await request('/search/tv', { query: lookup.title, first_air_date_year: lookup.year || '' });
    const match = pickSafeMatch(search?.results, lookup.title, lookup.year, 'first_air_date');
    const metadata = match ? mapMetadata(await request(`/tv/${match.id}`), 'show') : null;
    showCache.set(cacheKey, metadata);
    return metadata;
  }

  async function enrichEpisode(showTmdbId, season, episode) {
    if (!key || !showTmdbId || !season || !episode) return null;
    const details = await request(`/tv/${showTmdbId}/season/${season}/episode/${episode}`);
    if (!details) return null;
    return {
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
    request,
  };
}

module.exports = { cleanLookupTitle, createTmdbService };
