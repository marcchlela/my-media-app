let button;
let importDropdown;
let importFromDeviceBtn;
let importFromCdBtn;
let moviesSection;
let showsSection;
let continueSection;
let homeLogo;
let moviesHeading;
let showsHeading;
let continueHeading;
let sideMovies;
let sideShows;
let sideSettings;
let sideAccount;
let sideHome;
let searchInput;
let genreFilterSelect;
let sortFilterSelect;

let currentLibrary = [];
let currentAccountUser = null;
let desktopAppContext = {
  sharedServerConfigured: false,
  useSharedLibrary: false,
};
let currentView = 'all';
let searchQuery = '';
let selectedGenreFilter = 'all';
let selectedSort = 'default';
let activityLog = [];
let activePlayerKeyHandler = null;
const PLAYER_SEEK_SECONDS = 5;
const WATCH_COMPLETE_THRESHOLD_PERCENT = 92;
let librarySaveTimer = null;
let searchRenderTimer = null;
let cachedGenreOptionsKey = '';
let groupedShowsCache = {
  source: null,
  value: [],
};
const SEARCH_RENDER_DEBOUNCE_MS = 120;
const SLOW_RENDER_LOG_MS = 80;
const GENRE_ID_TO_NAME = new Map([
  [28, 'Action'],
  [12, 'Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [14, 'Fantasy'],
  [36, 'History'],
  [27, 'Horror'],
  [10402, 'Music'],
  [9648, 'Mystery'],
  [10749, 'Romance'],
  [878, 'Science Fiction'],
  [10770, 'TV Movie'],
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
  [10759, 'Action & Adventure'],
  [10762, 'Kids'],
  [10763, 'News'],
  [10764, 'Reality'],
  [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'],
  [10767, 'Talk'],
  [10768, 'War & Politics'],
]);

function showUiError(message) {
  const content = document.getElementById('content');
  if (!content) return;

  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = message;
  content.prepend(box);
}

function clearUiErrors() {
  document.querySelectorAll('.error-box').forEach((node) => node.remove());
}

function isCurrentUserAdmin() {
  return !!currentAccountUser?.isAdmin;
}

function isSharedLibraryMode() {
  return !!desktopAppContext.sharedServerConfigured && !isCurrentUserAdmin();
}

function resolveMediaSource(item) {
  return item?.streamUrl || item?.path || '';
}

function resolveSubtitleSource(subtitle) {
  return subtitle?.trackUrl || subtitle?.src || subtitle?.path || '';
}

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function getPlayerIconSvg(name) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5v11l9-5.5-9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h4v12H7zM13 6h4v12h-4z" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7 6 12l5 5v-3c3.31 0 6 2.69 6 6h2c0-4.42-3.58-8-8-8v-5z" fill="currentColor"/></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 7v5c-4.42 0-8 3.58-8 8h2c0-3.31 2.69-6 6-6v3l5-5-5-5z" fill="currentColor"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5z" fill="currentColor"/><path d="M17 9l4 4m0-4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H3v4M17 3h4v4M21 17v4h-4M7 21H3v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fullscreenExit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8H5V5M16 8h3V5M16 16h3v3M8 16H5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return icons[name] || icons.play;
}

function setPlayerButtonIcon(button, iconName, label) {
  button.innerHTML = `<span class="player-control-icon">${getPlayerIconSvg(iconName)}</span>`;
  button.setAttribute('aria-label', label);
  button.title = label;
}

function refreshAdminUi() {
  const importMenu = button?.closest('.import-menu');
  if (importMenu) {
    importMenu.classList.toggle('hidden', !isCurrentUserAdmin());
  }
  if (!isCurrentUserAdmin()) {
    toggleImportDropdown(false);
  }
}

function ensureAdminAccess(message = 'Only the admin account can manage the library from this app.') {
  if (isCurrentUserAdmin()) return true;
  clearUiErrors();
  showUiError(message);
  return false;
}

window.addEventListener('error', (event) => {
  const msg = event?.error?.message || event?.message || 'An unexpected error occurred.';
  showUiError(msg);
});

function askYesNo(message, yesLabel = 'Yes', noLabel = 'No') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    const text = document.createElement('p');
    text.className = 'confirm-message';
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const noBtn = document.createElement('button');
    noBtn.className = 'settings-btn secondary';
    noBtn.textContent = noLabel;

    const yesBtn = document.createElement('button');
    yesBtn.className = 'settings-btn';
    yesBtn.textContent = yesLabel;

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    noBtn.addEventListener('click', () => close(false));
    yesBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });

    actions.appendChild(noBtn);
    actions.appendChild(yesBtn);
    dialog.appendChild(text);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function askTextInput({
  title = 'Enter value',
  initialValue = '',
  placeholder = '',
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    const heading = document.createElement('p');
    heading.className = 'confirm-message';
    heading.textContent = title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'prompt-input';
    input.value = initialValue || '';
    input.placeholder = placeholder || '';

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-btn secondary';
    cancelBtn.textContent = cancelLabel;

    const submitBtn = document.createElement('button');
    submitBtn.className = 'settings-btn';
    submitBtn.textContent = submitLabel;

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => close(null));
    submitBtn.addEventListener('click', () => close(input.value));

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        close(input.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    dialog.appendChild(heading);
    dialog.appendChild(input);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

// simple TV show detection
function isTVShow(name) {
  return /S\d{1,2}E\d{1,2}/i.test(name);
}

function parseEpisodeInfo(name) {
  const match = name.match(/S(\d{1,2})E(\d{1,2})/i);
  if (!match) return null;
  return {
    season: parseInt(match[1], 10),
    episode: parseInt(match[2], 10),
  };
}

function normalizeShowName(name) {
  const noExt = name.replace(/\.[^/.]+$/, "");
  let baseName = noExt;
  const match = noExt.match(/S\d{1,2}E\d{1,2}/i);
  if (match && match.index !== undefined) {
    baseName = noExt.slice(0, match.index);
  }

  let cleaned = baseName.replace(/[\._]/g, ' ');
  cleaned = cleaned.replace(/\b(19|20)\d{2}\b/g, '');
  cleaned = cleaned.replace(/[()[\]]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || noExt;
}

function formatImportedEpisodeDisplayName(showName, episodeInfo, episodeTitle, fallbackName) {
  if (!episodeInfo?.season || !episodeInfo?.episode) {
    return fallbackName;
  }

  const season = String(episodeInfo.season).padStart(2, '0');
  const episode = String(episodeInfo.episode).padStart(2, '0');
  const safeShowName = String(showName || '').trim().replace(/\s+/g, '.');
  const safeTitle = String(episodeTitle || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '.');

  if (!safeShowName) {
    return safeTitle ? `S${season}E${episode}.${safeTitle}` : fallbackName;
  }

  return safeTitle
    ? `${safeShowName}.S${season}E${episode}.${safeTitle}`
    : `${safeShowName}.S${season}E${episode}`;
}

function getFileNameFromPath(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function toFileUrl(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return encodeURI(`file:///${normalized.replace(/^\/+/, '')}`);
}

function getMoviePosterSrc(file, size = 300) {
  if (file?.customPosterPath && !file?.streamUrl) return toFileUrl(file.customPosterPath);
  if (file?.customPosterTmdbPath) return buildTmdbPosterUrl(file.customPosterTmdbPath, size);
  if (file?.data?.poster_path) return `https://image.tmdb.org/t/p/w${size}${file.data.poster_path}`;
  if (file?.posterPath) return buildTmdbPosterUrl(file.posterPath, size);
  return '';
}

function getShowPosterSrc(group, size = 300) {
  const customPoster = group?.episodes?.find((ep) => ep?.customPosterPath)?.customPosterPath;
  const tmdbPoster = group?.episodes?.find((ep) => ep?.customPosterTmdbPath)?.customPosterTmdbPath;
  const fallbackPoster = group?.episodes?.find((ep) => ep?.posterPath)?.posterPath;
  const isRemote = Array.isArray(group?.episodes) && group.episodes.some((ep) => !!ep?.streamUrl);
  if (customPoster && !isRemote) return toFileUrl(customPoster);
  if (tmdbPoster) return buildTmdbPosterUrl(tmdbPoster, size);
  if (group?.data?.poster_path) return `https://image.tmdb.org/t/p/w${size}${group.data.poster_path}`;
  if (fallbackPoster) return buildTmdbPosterUrl(fallbackPoster, size);
  return '';
}

function isMovieFavorite(item) {
  return !!item?.isFavorite;
}

function isShowFavorite(group) {
  return Array.isArray(group?.episodes) && group.episodes.some((episode) => !!episode?.isFavorite);
}

function buildFavoritePayloadForMovie(item) {
  return {
    isShow: false,
    mediaPath: item?.path || '',
    mediaName: item?.data?.title || item?.name || 'Movie',
    tmdbId: item?.data?.id ?? item?.tmdbId ?? null,
  };
}

function buildFavoritePayloadForShow(group) {
  return {
    isShow: true,
    showKey: group?.key || '',
    mediaName: group?.data?.name || group?.name || 'TV Show',
    tmdbId: group?.data?.id ?? group?.tmdbId ?? null,
  };
}

async function setMovieFavorite(item, isFavorite) {
  if (!currentAccountUser) {
    showUiError('Sign in to save favorites.');
    return false;
  }
  const handler = isFavorite ? window.api?.addAccountFavorite : window.api?.removeAccountFavorite;
  if (!handler) return false;
  const result = await handler(buildFavoritePayloadForMovie(item));
  if (!result?.ok) {
    showUiError(result?.error || 'Could not update favorites.');
    return false;
  }

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;
    const next = { ...entry };
    if (isFavorite) {
      next.isFavorite = true;
    } else {
      delete next.isFavorite;
    }
    return next;
  });
  return true;
}

async function setShowFavorite(group, isFavorite) {
  if (!currentAccountUser) {
    showUiError('Sign in to save favorites.');
    return false;
  }
  const handler = isFavorite ? window.api?.addAccountFavorite : window.api?.removeAccountFavorite;
  if (!handler) return false;
  const result = await handler(buildFavoritePayloadForShow(group));
  if (!result?.ok) {
    showUiError(result?.error || 'Could not update favorites.');
    return false;
  }

  currentLibrary = currentLibrary.map((entry) => {
    if (!entry.isShow || getShowKeyForFile(entry) !== group.key) return entry;
    const next = { ...entry };
    if (isFavorite) {
      next.isFavorite = true;
    } else {
      delete next.isFavorite;
    }
    return next;
  });
  return true;
}

function createFavoriteButton(isFavorite, onToggle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `details-secondary-btn favorite-btn${isFavorite ? ' active' : ''}`;
  btn.innerHTML = `<span class="favorite-btn-icon">${isFavorite ? '&#9829;' : '&#9825;'}</span>`;
  btn.setAttribute('aria-label', isFavorite ? 'Favorited' : 'Favorite');
  btn.title = isFavorite ? 'Favorited' : 'Favorite';
  btn.addEventListener('click', onToggle);
  return btn;
}

function normalizeTitleForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[:'"`’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYearHint(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function cleanSearchName(value) {
  let cleaned = String(value || '').replace(/\.[^/.]+$/, '');
  cleaned = cleaned.replace(/[._]/g, ' ');
  cleaned = cleaned.replace(/\bS\d{1,2}E\d{1,2}\b/gi, ' ');
  cleaned = cleaned.replace(/\b(480p|720p|1080p|2160p|4k|x264|x265|h264|h265|bluray|brrip|webrip|web-dl|dvdrip|hdrip|aac|dts|proper|repack|extended|remastered)\b/gi, ' ');
  cleaned = cleaned.replace(/\b(19|20)\d{2}\b/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function buildSearchQueries(value) {
  const raw = String(value || '').replace(/\.[^/.]+$/, '').replace(/[._]/g, ' ').trim();
  const cleaned = cleanSearchName(value);
  const normalized = normalizeTitleForCompare(value);
  const queries = [cleaned, raw, normalized]
    .map((query) => query.trim())
    .filter((query) => query.length >= 2);
  return Array.from(new Set(queries)).slice(0, 3);
}

function getTokenSet(value) {
  return new Set(
    normalizeTitleForCompare(value)
      .split(' ')
      .filter((token) => token.length >= 2)
  );
}

function scoreTmdbResult(result, originalName, { isShow = false } = {}) {
  const normalizedQuery = normalizeTitleForCompare(originalName);
  const queryTokens = getTokenSet(originalName);
  const yearHint = extractYearHint(originalName);
  const titleKey = isShow ? 'name' : 'title';
  const dateKey = isShow ? 'first_air_date' : 'release_date';
  const title = result?.[titleKey] || '';
  const normalizedTitle = normalizeTitleForCompare(title);
  const titleTokens = getTokenSet(title);
  const resultYear = extractYearHint(result?.[dateKey] || '');

  let score = 0;
  if (normalizedTitle && normalizedQuery) {
    if (normalizedTitle === normalizedQuery) score += 80;
    else if (normalizedTitle.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedTitle)) score += 40;
    else if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) score += 22;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) overlap += 1;
  }
  score += overlap * 10;

  if (yearHint && resultYear) {
    const delta = Math.abs(yearHint - resultYear);
    if (delta === 0) score += 20;
    else if (delta === 1) score += 10;
    else if (delta > 4) score -= 8;
  }

  if (Number.isFinite(result?.popularity)) {
    score += Math.min(result.popularity / 200, 5);
  }

  return score;
}

function rankTmdbResults(results, originalName, options = {}) {
  if (!Array.isArray(results) || !results.length) return [];
  return [...results].sort((a, b) => {
    const delta = scoreTmdbResult(b, originalName, options) - scoreTmdbResult(a, originalName, options);
    if (delta !== 0) return delta;

    const aDate = Date.parse(a?.release_date || a?.first_air_date || '') || 0;
    const bDate = Date.parse(b?.release_date || b?.first_air_date || '') || 0;
    return bDate - aDate;
  });
}

function pickBestTmdbResult(results, originalName, options = {}) {
  return rankTmdbResults(results, originalName, options)[0] || null;
}

async function fetchTmdbCandidates(value, searchFn, options = {}) {
  const queries = buildSearchQueries(value);
  const unique = new Map();

  for (const query of queries) {
    const data = await searchFn(query);
    for (const result of data?.results || []) {
      if (!result?.id) continue;
      if (!unique.has(result.id)) {
        unique.set(result.id, result);
      }
    }
  }

  return rankTmdbResults(Array.from(unique.values()), value, options);
}

function buildTmdbPosterUrl(posterPath, size = 154) {
  return posterPath ? `https://image.tmdb.org/t/p/w${size}${posterPath}` : '';
}

function buildTmdbBackdropUrl(backdropPath, size = 780) {
  return backdropPath ? `https://image.tmdb.org/t/p/w${size}${backdropPath}` : '';
}

function formatTmdbCandidateFacts(result, { isShow = false } = {}) {
  const dateValue = isShow ? result?.first_air_date : result?.release_date;
  const year = dateValue ? String(dateValue).slice(0, 4) : 'Year unknown';
  const rating = Number.isFinite(result?.vote_average) && result.vote_average > 0
    ? `${result.vote_average.toFixed(1)}/10`
    : 'No rating';
  return `${year} • ${rating}`;
}

function promptTmdbSelection({
  title = 'Choose metadata',
  originalName = '',
  results = [],
  isShow = false,
} = {}) {
  return new Promise((resolve) => {
    const candidates = Array.isArray(results) ? results.slice(0, 8) : [];
    if (!candidates.length) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay tmdb-picker-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog tmdb-picker-dialog';

    const heading = document.createElement('div');
    heading.className = 'tmdb-picker-header';

    const headingTitle = document.createElement('h3');
    headingTitle.className = 'tmdb-picker-title';
    headingTitle.textContent = title;

    const headingCopy = document.createElement('p');
    headingCopy.className = 'tmdb-picker-copy';
    headingCopy.textContent = `More than one match was found for "${originalName}". Pick the right one or skip metadata for now.`;

    const list = document.createElement('div');
    list.className = 'tmdb-poster-grid';

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });

    for (const [index, result] of candidates.entries()) {
      const card = document.createElement('div');
      card.className = 'tmdb-picker-card';

      const poster = document.createElement(result?.poster_path ? 'img' : 'div');
      if (result?.poster_path) {
        poster.className = 'tmdb-picker-poster';
        poster.src = buildTmdbPosterUrl(result.poster_path);
        poster.alt = `${result?.title || result?.name || 'Result'} poster`;
        poster.loading = 'lazy';
      } else {
        poster.className = 'tmdb-picker-poster tmdb-picker-poster-fallback';
        poster.textContent = 'No poster';
      }

      const body = document.createElement('div');
      body.className = 'tmdb-picker-body';

      const name = document.createElement('h4');
      name.className = 'tmdb-picker-name';
      name.textContent = result?.title || result?.name || 'Untitled';

      const facts = document.createElement('p');
      facts.className = 'tmdb-picker-facts';
      facts.textContent = formatTmdbCandidateFacts(result, { isShow });

      const overview = document.createElement('p');
      overview.className = 'tmdb-picker-overview';
      overview.textContent = result?.overview || 'No description available.';

      const actionRow = document.createElement('div');
      actionRow.className = 'tmdb-picker-actions';

      if (index === 0) {
        const badge = document.createElement('span');
        badge.className = 'tmdb-picker-badge';
        badge.textContent = 'Recommended';
        actionRow.appendChild(badge);
      }

      const selectBtn = document.createElement('button');
      selectBtn.className = 'settings-btn';
      selectBtn.textContent = 'Use This';
      selectBtn.addEventListener('click', () => close(result));

      actionRow.appendChild(selectBtn);
      body.appendChild(name);
      body.appendChild(facts);
      body.appendChild(overview);
      body.appendChild(actionRow);
      card.appendChild(poster);
      card.appendChild(body);
      list.appendChild(card);
    }

    const footer = document.createElement('div');
    footer.className = 'confirm-actions';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'settings-btn secondary';
    skipBtn.textContent = 'Skip Metadata';
    skipBtn.addEventListener('click', () => close(null));

    footer.appendChild(skipBtn);
    heading.appendChild(headingTitle);
    heading.appendChild(headingCopy);
    dialog.appendChild(heading);
    dialog.appendChild(list);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

async function fetchTmdbMatch(value, searchFn, options = {}) {
  const results = await fetchTmdbCandidates(value, searchFn, options);
  if (!results.length) return null;
  if (options.promptOnMultiple && results.length > 1) {
    return promptTmdbSelection({
      title: options.pickerTitle || 'Choose metadata',
      originalName: value,
      results,
      isShow: !!options.isShow,
    });
  }
  return results[0] || null;
}

// fetch TMDB data
async function fetchMovieData(name, options = {}) {
  if (!window.api?.tmdbMovieSearch) return null;
  return fetchTmdbMatch(
    name,
    (query) => window.api.tmdbMovieSearch(query),
    { isShow: false, ...options }
  );
}

async function fetchTVData(name, options = {}) {
  if (!window.api?.tmdbTvSearch) return null;
  return fetchTmdbMatch(
    name,
    (query) => window.api.tmdbTvSearch(query),
    { isShow: true, ...options }
  );
}

async function fetchShowCredits(showId) {
  if (!window.api?.tmdbTvCredits) return null;
  return window.api.tmdbTvCredits(showId);
}

async function fetchEpisodeDetails(showId, seasonNumber, episodeNumber) {
  if (!window.api?.tmdbTvEpisode) return null;
  return window.api.tmdbTvEpisode(showId, seasonNumber, episodeNumber);
}

async function fetchMovieDetails(movieId) {
  if (!window.api?.tmdbMovieDetails) return null;
  return window.api.tmdbMovieDetails(movieId);
}

async function fetchMovieCredits(movieId) {
  if (!window.api?.tmdbMovieCredits) return null;
  return window.api.tmdbMovieCredits(movieId);
}

async function fetchMovieVideos(movieId) {
  if (!window.api?.tmdbMovieVideos) return null;
  return window.api.tmdbMovieVideos(movieId);
}

async function fetchMovieImages(movieId) {
  if (!window.api?.tmdbMovieImages) return null;
  return window.api.tmdbMovieImages(movieId);
}

async function fetchTvImages(tvId) {
  if (!window.api?.tmdbTvImages) return null;
  return window.api.tmdbTvImages(tvId);
}

function pickBestMovieTrailer(videos) {
  const items = Array.isArray(videos?.results) ? videos.results : [];
  const youtube = items.filter((video) => video?.site === 'YouTube' && video?.key);
  if (!youtube.length) return null;

  const ranked = youtube.sort((a, b) => {
    const aOfficial = a.official ? 1 : 0;
    const bOfficial = b.official ? 1 : 0;
    if (aOfficial !== bOfficial) return bOfficial - aOfficial;

    const aTrailer = String(a.type || '').toLowerCase() === 'trailer' ? 1 : 0;
    const bTrailer = String(b.type || '').toLowerCase() === 'trailer' ? 1 : 0;
    if (aTrailer !== bTrailer) return bTrailer - aTrailer;

    const aPublished = Date.parse(a.published_at || '') || 0;
    const bPublished = Date.parse(b.published_at || '') || 0;
    return bPublished - aPublished;
  });

  return ranked[0] || null;
}

function rankTmdbPosterImages(images = []) {
  return [...images].sort((a, b) => {
    const langA = a?.iso_639_1 === 'en' ? 1 : 0;
    const langB = b?.iso_639_1 === 'en' ? 1 : 0;
    if (langA !== langB) return langB - langA;

    const voteA = Number(a?.vote_average) || 0;
    const voteB = Number(b?.vote_average) || 0;
    if (voteA !== voteB) return voteB - voteA;

    const countA = Number(a?.vote_count) || 0;
    const countB = Number(b?.vote_count) || 0;
    if (countA !== countB) return countB - countA;

    const widthA = Number(a?.width) || 0;
    const widthB = Number(b?.width) || 0;
    return widthB - widthA;
  });
}

function formatTmdbPosterFacts(image) {
  const size = image?.width && image?.height ? `${image.width} x ${image.height}` : 'Unknown size';
  const language = image?.iso_639_1 ? image.iso_639_1.toUpperCase() : 'No language';
  const votes = Number(image?.vote_count) || 0;
  return `${language} • ${size} • ${votes} vote${votes === 1 ? '' : 's'}`;
}

function promptTmdbPosterChoice(results, title, originalName) {
  return new Promise((resolve) => {
    const posters = rankTmdbPosterImages(Array.isArray(results) ? results : []).filter((image) => !!image?.file_path).slice(0, 18);
    if (!posters.length) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay tmdb-picker-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog tmdb-picker-dialog';

    const heading = document.createElement('div');
    heading.className = 'tmdb-picker-header';

    const headingTitle = document.createElement('h3');
    headingTitle.className = 'tmdb-picker-title';
    headingTitle.textContent = title;

    const headingCopy = document.createElement('p');
    headingCopy.className = 'tmdb-picker-copy';
    headingCopy.textContent = `Choose a TMDB poster for "${originalName}".`;

    const list = document.createElement('div');
    list.className = 'tmdb-poster-grid';

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });

    for (const [index, image] of posters.entries()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tmdb-poster-option';
      card.addEventListener('click', () => close(image.file_path));

      const poster = document.createElement('img');
      poster.className = 'tmdb-poster-option-image';
      poster.src = buildTmdbPosterUrl(image.file_path, 342);
      poster.alt = `${originalName} poster option ${index + 1}`;
      poster.loading = 'lazy';

      if (index === 0) {
        const badge = document.createElement('span');
        badge.className = 'tmdb-poster-option-badge';
        badge.textContent = 'Recommended';
        card.appendChild(badge);
      }

      card.appendChild(poster);
      list.appendChild(card);
    }

    const footer = document.createElement('div');
    footer.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-btn secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(null));

    footer.appendChild(cancelBtn);
    heading.appendChild(headingTitle);
    heading.appendChild(headingCopy);
    dialog.appendChild(heading);
    dialog.appendChild(list);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function buildYoutubeEmbedUrl(videoKey) {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoKey)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
}

function buildYoutubeWatchUrl(videoKey) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoKey)}`;
}

function showTrailerModal(embedUrl, titleText = 'Trailer') {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay trailer-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'trailer-dialog';

  const header = document.createElement('div');
  header.className = 'trailer-header';

  const title = document.createElement('h3');
  title.className = 'trailer-title';
  title.textContent = titleText;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-btn secondary';
  closeBtn.textContent = 'Close';

  const frameWrap = document.createElement('div');
  frameWrap.className = 'trailer-frame-wrap';

  const frame = document.createElement('iframe');
  frame.className = 'trailer-frame';
  frame.src = embedUrl;
  frame.title = titleText;
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'origin';

  const close = () => overlay.remove();

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  frameWrap.appendChild(frame);
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);
  dialog.appendChild(frameWrap);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function setRatingStars(container, rating, withNumber = false) {
  container.innerHTML = '';
  if (!Number.isFinite(rating)) return;

  const starsOutOfFive = Math.max(0, Math.min(5, rating / 2));
  const rounded = Math.round(starsOutOfFive * 2) / 2;
  const fullCount = Math.floor(rounded);
  const halfCount = rounded % 1 !== 0 ? 1 : 0;
  const emptyCount = 5 - fullCount - halfCount;

  for (let i = 0; i < fullCount; i++) {
    container.appendChild(createStarSvg('full'));
  }
  if (halfCount) {
    container.appendChild(createStarSvg('half'));
  }
  for (let i = 0; i < emptyCount; i++) {
    container.appendChild(createStarSvg('empty'));
  }

  if (withNumber) {
    const number = document.createElement('span');
    number.classList.add('rating-number');
    const truncated = Math.floor(starsOutOfFive * 10) / 10;
    const display = Number.isFinite(truncated) ? truncated.toFixed(1) : '';
    number.textContent = display ? `(${display})` : '';
    container.appendChild(number);
  }
}

function createStarSvg(type) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('star-icon', `star-${type}`);

  const pathD = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

  if (type === 'half') {
    const defs = document.createElementNS(ns, 'defs');
    const clipPath = document.createElementNS(ns, 'clipPath');
    const clipId = `half-${Math.random().toString(36).slice(2, 10)}`;
    clipPath.setAttribute('id', clipId);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '12');
    rect.setAttribute('height', '24');
    clipPath.appendChild(rect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    const base = document.createElementNS(ns, 'path');
    base.setAttribute('d', pathD);
    base.classList.add('star-path', 'star-empty');
    svg.appendChild(base);

    const half = document.createElementNS(ns, 'path');
    half.setAttribute('d', pathD);
    half.classList.add('star-path', 'star-full');
    half.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(half);
    return svg;
  }

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathD);
  path.classList.add('star-path', type === 'full' ? 'star-full' : 'star-empty');
  svg.appendChild(path);
  return svg;
}

function createPeopleGroup(label) {
  const wrap = document.createElement('div');
  wrap.classList.add('details-people-group');

  const title = document.createElement('p');
  title.classList.add('details-people-label');
  title.textContent = `${label}:`;

  const chips = document.createElement('div');
  chips.classList.add('details-people-chips');

  wrap.appendChild(title);
  wrap.appendChild(chips);
  return { wrap, chips };
}

function fillPeopleChips(chipsContainer, names, fallback = 'Unknown') {
  if (!chipsContainer) return;
  chipsContainer.replaceChildren();

  const normalized = Array.isArray(names)
    ? names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const values = normalized.length ? normalized : [fallback];

  for (const value of values) {
    const chip = document.createElement('span');
    chip.classList.add('details-person-chip');
    if (value === fallback) {
      chip.classList.add('is-fallback');
    }
    chip.textContent = value;
    chipsContainer.appendChild(chip);
  }
}

function buildHomeLayout() {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <h2 id="continueHeading">Continue Watching</h2>
    <div id="continueSection" class="continue-row"></div>

    <h2 id="moviesHeading">Movies</h2>
    <div id="moviesSection" class="grid"></div>

    <h2 id="showsHeading">TV Shows</h2>
    <div id="showsSection" class="grid"></div>
  `;

  continueSection = document.getElementById('continueSection');
  continueHeading = document.getElementById('continueHeading');
  moviesSection = document.getElementById('moviesSection');
  showsSection = document.getElementById('showsSection');
  moviesHeading = document.getElementById('moviesHeading');
  showsHeading = document.getElementById('showsHeading');
}

function ensureHomeLayout() {
  if (continueSection && moviesSection && showsSection) return;
  buildHomeLayout();
}

function applyView(view) {
  currentView = view;
  ensureHomeLayout();

  const showMovies = view === 'all' || view === 'movies';
  const showShows = view === 'all' || view === 'shows';
  const showContinue = view === 'all';

  if (continueHeading) continueHeading.style.display = showContinue ? '' : 'none';
  if (continueSection) continueSection.style.display = showContinue ? '' : 'none';

  if (moviesHeading) moviesHeading.style.display = showMovies ? '' : 'none';
  if (moviesSection) moviesSection.style.display = showMovies ? '' : 'none';
  if (showsHeading) showsHeading.style.display = showShows ? '' : 'none';
  if (showsSection) showsSection.style.display = showShows ? '' : 'none';

  setSideActive(view === 'movies' ? 'movies' : view === 'shows' ? 'shows' : null);
}

function showHome(view = currentView) {
  buildHomeLayout();
  applyView(view);
  renderLibrary(currentLibrary, view);
  if (view === 'all') {
    setSideActive('home');
  }
}

function setSideActive(target) {
  if (sideHome) sideHome.classList.toggle('active', target === 'home');
  if (sideMovies) sideMovies.classList.toggle('active', target === 'movies');
  if (sideShows) sideShows.classList.toggle('active', target === 'shows');
  if (sideSettings) sideSettings.classList.toggle('active', target === 'settings');
  if (sideAccount) sideAccount.classList.toggle('active', target === 'account');
}

function matchesQuery(text, query) {
  if (!query) return true;
  if (!text) return false;
  return text.toLowerCase().includes(query);
}

function isLibraryViewVisible() {
  const content = document.getElementById('content');
  if (!content) return false;
  return Boolean(content.querySelector('#moviesSection') && content.querySelector('#showsSection'));
}

function rerenderLibraryIfVisible() {
  if (!isLibraryViewVisible()) return;
  renderLibrary(currentLibrary, currentView);
}

function getGroupedShowsCached(library) {
  if (groupedShowsCache.source === library) {
    return groupedShowsCache.value;
  }
  const groups = groupShows(library);
  groupedShowsCache = { source: library, value: groups };
  return groups;
}

function isPerfDebugEnabled() {
  try {
    return localStorage.getItem('perfDebug') === '1';
  } catch (err) {
    return false;
  }
}

function logRenderPerf(durationMs, stats) {
  if (!isPerfDebugEnabled() && durationMs < SLOW_RENDER_LOG_MS) return;
  const summary = `movies=${stats.movies}, shows=${stats.shows}, continue=${stats.continueCount}, query="${stats.query}"`;
  if (durationMs >= SLOW_RENDER_LOG_MS) {
    console.warn(`[Perf] renderLibrary took ${durationMs.toFixed(1)}ms (${summary})`);
    return;
  }
  console.debug(`[Perf] renderLibrary ${durationMs.toFixed(1)}ms (${summary})`);
}

function loadLog() {
  try {
    const saved = localStorage.getItem('activityLog');
    activityLog = saved ? JSON.parse(saved) : [];
  } catch (err) {
    activityLog = [];
  }
}

function addLog(message, type = 'info') {
  const entry = {
    time: new Date().toLocaleString(),
    message,
    type,
  };
  activityLog.unshift(entry);
  activityLog = activityLog.slice(0, 100);
  localStorage.setItem('activityLog', JSON.stringify(activityLog));
  renderLogPanel();
}

function renderLogPanel() {
  const list = document.getElementById('logList');
  if (!list) return;
  list.innerHTML = '';
  for (const entry of activityLog) {
    const item = document.createElement('div');
    item.classList.add('log-item');
    item.textContent = `[${entry.time}] ${entry.message}`;
    list.appendChild(item);
  }
}

function getWatchPercent(entry) {
  const percent = entry?.watchProgress?.percent;
  if (!Number.isFinite(percent)) return 0;
  const safe = Math.max(0, Math.min(100, percent));
  if (safe >= WATCH_COMPLETE_THRESHOLD_PERCENT) return 100;
  return safe;
}

function getShowWatchPercent(group) {
  if (!group?.episodes?.length) return 0;
  const percents = group.episodes.map((ep) => getWatchPercent(ep));
  const total = percents.reduce((sum, value) => sum + value, 0);
  return total / percents.length;
}

function getShowContinueState(group) {
  if (!group?.episodes?.length) return null;

  const episodeStates = group.episodes.map((episode) => ({
    episode,
    percent: getWatchPercent(episode),
    updatedAt: Number(episode?.watchProgress?.updatedAt) || 0,
  }));

  const inProgressEpisodes = episodeStates
    .filter((entry) => entry.percent > 0 && entry.percent < 100 && entry.updatedAt > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (inProgressEpisodes.length) {
    const latest = inProgressEpisodes[0];
    return {
      episode: latest.episode,
      percent: latest.percent,
      updatedAt: latest.updatedAt,
      subtitle: formatEpisodeLabel(latest.episode),
    };
  }

  let hasWatchedEpisode = false;
  let latestWatchedUpdatedAt = 0;
  for (const entry of episodeStates) {
    if (entry.percent >= 100) {
      hasWatchedEpisode = true;
      latestWatchedUpdatedAt = Math.max(latestWatchedUpdatedAt, entry.updatedAt);
      continue;
    }

    if (hasWatchedEpisode) {
      return {
        episode: entry.episode,
        percent: getShowWatchPercent(group),
        updatedAt: latestWatchedUpdatedAt,
        subtitle: `Next: ${formatEpisodeLabel(entry.episode)}`,
      };
    }
  }

  return null;
}

function hasSubtitlesOnItem(item) {
  return Array.isArray(item?.subtitles) && item.subtitles.length > 0;
}

function hasSubtitlesOnShow(group) {
  return Array.isArray(group?.episodes) && group.episodes.some((episode) => hasSubtitlesOnItem(episode));
}

function appendCcBadge(card) {
  const badge = document.createElement('span');
  badge.classList.add('cc-badge');
  badge.textContent = 'CC';
  card.appendChild(badge);
}

function getGenresFromItem(item) {
  if (!item) return [];
  if (Array.isArray(item?.movieExtras?.details?.genres) && item.movieExtras.details.genres.length) {
    return item.movieExtras.details.genres.map((genre) => genre?.name).filter(Boolean);
  }
  if (Array.isArray(item?.data?.genres) && item.data.genres.length) {
    return item.data.genres.map((genre) => genre?.name).filter(Boolean);
  }
  if (Array.isArray(item?.data?.genre_ids)) {
    return item.data.genre_ids
      .map((id) => GENRE_ID_TO_NAME.get(id))
      .filter(Boolean);
  }
  return [];
}

function getGenresFromGroup(group) {
  if (!group) return [];
  if (Array.isArray(group?.data?.genres) && group.data.genres.length) {
    return group.data.genres.map((genre) => genre?.name).filter(Boolean);
  }
  if (Array.isArray(group?.data?.genre_ids)) {
    return group.data.genre_ids
      .map((id) => GENRE_ID_TO_NAME.get(id))
      .filter(Boolean);
  }
  return [];
}

function getRuntimeForItem(item) {
  const runtime = item?.movieExtras?.details?.runtime ?? item?.data?.runtime;
  return Number.isFinite(runtime) ? runtime : null;
}

function getRuntimeForGroup(group) {
  const runtime = Array.isArray(group?.data?.episode_run_time) ? group.data.episode_run_time[0] : null;
  return Number.isFinite(runtime) ? runtime : null;
}

function getReleaseDateForItem(item) {
  return item?.data?.release_date || item?.data?.first_air_date || null;
}

function getReleaseDateForGroup(group) {
  return group?.data?.first_air_date || null;
}

function compareNullableNumbers(a, b, direction = 'asc') {
  const aNum = Number.isFinite(a) ? a : null;
  const bNum = Number.isFinite(b) ? b : null;
  if (aNum === null && bNum === null) return 0;
  if (aNum === null) return 1;
  if (bNum === null) return -1;
  return direction === 'asc' ? aNum - bNum : bNum - aNum;
}

function applySortToMovies(items) {
  const sorted = [...items];
  switch (selectedSort) {
    case 'release_desc':
      sorted.sort((a, b) => compareNullableNumbers(
        Date.parse(getReleaseDateForItem(a) || ''),
        Date.parse(getReleaseDateForItem(b) || ''),
        'desc'
      ));
      break;
    case 'release_asc':
      sorted.sort((a, b) => compareNullableNumbers(
        Date.parse(getReleaseDateForItem(a) || ''),
        Date.parse(getReleaseDateForItem(b) || ''),
        'asc'
      ));
      break;
    case 'rating_desc':
      sorted.sort((a, b) => compareNullableNumbers(a?.data?.vote_average, b?.data?.vote_average, 'desc'));
      break;
    case 'rating_asc':
      sorted.sort((a, b) => compareNullableNumbers(a?.data?.vote_average, b?.data?.vote_average, 'asc'));
      break;
    case 'runtime_asc':
      sorted.sort((a, b) => compareNullableNumbers(getRuntimeForItem(a), getRuntimeForItem(b), 'asc'));
      break;
    case 'runtime_desc':
      sorted.sort((a, b) => compareNullableNumbers(getRuntimeForItem(a), getRuntimeForItem(b), 'desc'));
      break;
    default:
      break;
  }
  return sorted;
}

function applySortToShows(groups) {
  const sorted = [...groups];
  switch (selectedSort) {
    case 'release_desc':
      sorted.sort((a, b) => compareNullableNumbers(
        Date.parse(getReleaseDateForGroup(a) || ''),
        Date.parse(getReleaseDateForGroup(b) || ''),
        'desc'
      ));
      break;
    case 'release_asc':
      sorted.sort((a, b) => compareNullableNumbers(
        Date.parse(getReleaseDateForGroup(a) || ''),
        Date.parse(getReleaseDateForGroup(b) || ''),
        'asc'
      ));
      break;
    case 'rating_desc':
      sorted.sort((a, b) => compareNullableNumbers(a?.data?.vote_average, b?.data?.vote_average, 'desc'));
      break;
    case 'rating_asc':
      sorted.sort((a, b) => compareNullableNumbers(a?.data?.vote_average, b?.data?.vote_average, 'asc'));
      break;
    case 'runtime_asc':
      sorted.sort((a, b) => compareNullableNumbers(getRuntimeForGroup(a), getRuntimeForGroup(b), 'asc'));
      break;
    case 'runtime_desc':
      sorted.sort((a, b) => compareNullableNumbers(getRuntimeForGroup(a), getRuntimeForGroup(b), 'desc'));
      break;
    default:
      break;
  }
  return sorted;
}

function refreshGenreFilterOptions(library, showGroups = []) {
  if (!genreFilterSelect) return;
  const current = selectedGenreFilter;
  const genres = new Set();

  for (const item of library) {
    if (item.isShow) continue;
    getGenresFromItem(item).forEach((genre) => genres.add(genre));
  }

  for (const group of showGroups) {
    getGenresFromGroup(group).forEach((genre) => genres.add(genre));
  }

  const options = ['all', ...Array.from(genres).sort((a, b) => a.localeCompare(b))];
  const optionsKey = options.join('|');
  if (optionsKey !== cachedGenreOptionsKey) {
    const frag = document.createDocumentFragment();
    for (const value of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'all' ? 'All Genres' : value;
      frag.appendChild(option);
    }
    genreFilterSelect.replaceChildren(frag);
    cachedGenreOptionsKey = optionsKey;
  }

  if (options.includes(current)) {
    selectedGenreFilter = current;
  } else {
    selectedGenreFilter = 'all';
  }
  genreFilterSelect.value = selectedGenreFilter;
}

function createCardProgressBar(percent) {
  const progress = document.createElement('div');
  progress.classList.add('card-progress');

  const fill = document.createElement('div');
  fill.classList.add('card-progress-fill');
  fill.style.width = `${percent}%`;
  progress.appendChild(fill);

  return progress;
}

function getContinueCardImageSrc(entry) {
  if (entry.type === 'movie') {
    return buildTmdbBackdropUrl(entry.item?.data?.backdrop_path, 780)
      || getMoviePosterSrc(entry.item, 342);
  }
  return buildTmdbBackdropUrl(entry.group?.data?.backdrop_path, 780)
    || getShowPosterSrc(entry.group, 342);
}

function createContinueCard(entry) {
  const card = document.createElement('div');
  card.classList.add('movie', 'continue-card', 'continue-card-landscape');

  const media = document.createElement('div');
  media.classList.add('continue-media');

  const img = document.createElement('img');
  img.classList.add('continue-image');
  img.src = getContinueCardImageSrc(entry);
  img.loading = 'lazy';
  img.decoding = 'async';
  media.appendChild(img);

  const hasCc = entry.type === 'movie'
    ? hasSubtitlesOnItem(entry.item)
    : hasSubtitlesOnShow(entry.group);
  if (hasCc) {
    appendCcBadge(media);
  }

  const overlay = document.createElement('div');
  overlay.classList.add('continue-overlay');

  const title = document.createElement('p');
  title.classList.add('continue-title');
  title.textContent = entry.type === 'movie'
    ? (entry.item.data?.title || entry.item.name)
    : (entry.group.data?.name || entry.group.name);
  overlay.appendChild(title);

  if (entry.subtitle) {
    const subtitle = document.createElement('span');
    subtitle.classList.add('continue-subtitle');
    subtitle.textContent = entry.subtitle;
    overlay.appendChild(subtitle);
  }

  overlay.appendChild(createCardProgressBar(entry.percent));
  media.appendChild(overlay);
  card.appendChild(media);

  if (entry.type === 'movie') {
    card.addEventListener('click', () => showDetails(entry.item));
  } else {
    card.addEventListener('click', () => showShowDetails(entry.group));
  }

  return card;
}

function scheduleLibrarySave(delayMs = 350) {
  if (!window.api?.saveLibrary) return;
  if (isSharedLibraryMode()) return;
  if (librarySaveTimer) {
    clearTimeout(librarySaveTimer);
  }
  librarySaveTimer = setTimeout(() => {
    window.api.saveLibrary(currentLibrary);
    librarySaveTimer = null;
  }, delayMs);
}

function updateWatchProgressForPath(filePath, currentTime, duration, forceComplete = false) {
  if (!filePath || !Number.isFinite(duration) || duration <= 0) return;
  if (!currentAccountUser) return;
  const sourceItem = currentLibrary.find((entry) => entry.path === filePath) || null;
  const safeTime = Math.max(0, Number(currentTime) || 0);
  const rawPercent = (safeTime / duration) * 100;
  let percent = Math.max(0, Math.min(100, rawPercent));
  if (forceComplete || safeTime >= duration - 2 || percent >= WATCH_COMPLETE_THRESHOLD_PERCENT) {
    percent = 100;
  }

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== filePath) return entry;
    return {
      ...entry,
      watchProgress: {
        position: Math.min(safeTime, duration),
        duration,
        percent,
        updatedAt: Date.now(),
      },
    };
  });
  scheduleLibrarySave();

  if (currentAccountUser && window.api?.saveAccountWatchProgress) {
    window.api.saveAccountWatchProgress({
      mediaPath: filePath,
      mediaName: sourceItem?.name || sourceItem?.data?.title || sourceItem?.data?.name || '',
      isShow: !!sourceItem?.isShow,
      position: Math.min(safeTime, duration),
      duration,
      percent,
      updatedAt: Date.now(),
    }).catch(() => {});
  }
}

function stripLibraryWatchProgress(items) {
  return Array.isArray(items)
    ? items.map((item) => ({ ...item, watchProgress: null }))
    : [];
}

function applyPosterOverrideToCurrentLibrary({ mediaPath = '', showKey = '', localPath = '', tmdbPath = '' } = {}) {
  currentLibrary = currentLibrary.map((entry) => {
    const isMatch = entry?.isShow
      ? (!!showKey && getShowKeyForFile(entry) === showKey)
      : (!!mediaPath && entry?.path === mediaPath);
    if (!isMatch) return entry;

    const next = { ...entry };
    if (localPath) {
      next.customPosterPath = localPath;
      delete next.customPosterTmdbPath;
    } else if (tmdbPath) {
      next.customPosterTmdbPath = tmdbPath;
      delete next.customPosterPath;
    }
    return next;
  });
}

function clearPosterOverrideFromCurrentLibrary({ mediaPath = '', showKey = '' } = {}) {
  currentLibrary = currentLibrary.map((entry) => {
    const isMatch = entry?.isShow
      ? (!!showKey && getShowKeyForFile(entry) === showKey)
      : (!!mediaPath && entry?.path === mediaPath);
    if (!isMatch) return entry;

    const next = { ...entry };
    delete next.customPosterPath;
    delete next.customPosterTmdbPath;
    return next;
  });
}

function stripLibraryPosterOverrides(items) {
  return Array.isArray(items)
    ? items.map((item) => {
      const next = { ...item };
      delete next.customPosterPath;
      delete next.customPosterTmdbPath;
      return next;
    })
    : [];
}

function toggleImportDropdown(forceOpen) {
  if (!importDropdown) return;
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !importDropdown.classList.contains('open');
  importDropdown.classList.toggle('open', shouldOpen);
}

function createPosterEditControl({ hasPosterOverride, onAddCustomPoster, onChooseTmdbPoster, onResetPoster }) {
  const wrap = document.createElement('div');
  wrap.classList.add('details-edit-wrap');

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit Poster';
  editBtn.classList.add('details-secondary-btn');
  wrap.appendChild(editBtn);

  const menu = document.createElement('div');
  menu.classList.add('details-edit-menu');

  const addBtn = document.createElement('button');
  addBtn.classList.add('details-edit-item');
  addBtn.textContent = 'Upload Custom Poster';

  const tmdbBtn = document.createElement('button');
  tmdbBtn.classList.add('details-edit-item');
  tmdbBtn.textContent = 'Choose from TMDB';

  menu.appendChild(addBtn);
  menu.appendChild(tmdbBtn);
  let resetBtn = null;
  if (hasPosterOverride) {
    resetBtn = document.createElement('button');
    resetBtn.classList.add('details-edit-item', 'reset');
    resetBtn.textContent = 'Reset to Original';
    menu.appendChild(resetBtn);
  }
  wrap.appendChild(menu);

  let outsideHandler = null;
  const closeMenu = () => {
    menu.classList.remove('open');
    if (outsideHandler) {
      document.removeEventListener('click', outsideHandler, true);
      outsideHandler = null;
    }
  };

  const openMenu = () => {
    menu.classList.add('open');
    outsideHandler = (event) => {
      if (!wrap.contains(event.target)) {
        closeMenu();
      }
    };
    setTimeout(() => {
      if (outsideHandler) {
        document.addEventListener('click', outsideHandler, true);
      }
    }, 0);
  };

  editBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  addBtn.addEventListener('click', async () => {
    closeMenu();
    await onAddCustomPoster();
  });

  tmdbBtn.addEventListener('click', async () => {
    closeMenu();
    if (onChooseTmdbPoster) {
      await onChooseTmdbPoster();
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      closeMenu();
      if (onResetPoster) {
        await onResetPoster();
      }
    });
  }

  return wrap;
}

async function importFiles(files, sourceLabel, subtitleFiles = []) {
  clearUiErrors();

  if (!files.length) {
    // User canceled or no files found: keep this silent.
    return;
  }

  const library = Array.isArray(currentLibrary) ? [...currentLibrary] : [];
  let newCount = 0;
  const subtitleAssignments = assignSubtitlesToMediaFiles(files, subtitleFiles);
  const showMetadataCache = new Map();
  const episodeMetadataCache = new Map();

  for (const file of files) {
    if (library.some((item) => item.path === file.path)) continue;

    const isShow = isTVShow(file.name);
    const episode = isShow ? parseEpisodeInfo(file.name) : null;
    const fallbackShowName = isShow ? normalizeShowName(file.name) : null;

    let data = null;
    try {
      if (isShow) {
        const showLookupName = fallbackShowName || file.name;
        const showLookupKey = String(showLookupName || '').trim().toLowerCase();
        if (showLookupKey && showMetadataCache.has(showLookupKey)) {
          data = showMetadataCache.get(showLookupKey);
        } else {
          data = await fetchTVData(showLookupName, {
            promptOnMultiple: true,
            pickerTitle: 'Choose the correct TV series',
          });
          if (showLookupKey) {
            showMetadataCache.set(showLookupKey, data || null);
          }
        }
      } else {
        data = await fetchMovieData(file.name, {
          promptOnMultiple: true,
          pickerTitle: 'Choose the correct movie',
        });
      }
    } catch (err) {
      console.error('Metadata fetch failed for:', file.name, err);
    }

    const showName = isShow ? (data?.name || fallbackShowName || file.name) : null;
    const showKey = isShow && showName
      ? (data?.id ? `tmdb:${data.id}` : showName.toLowerCase())
      : null;
    let displayName = file.name;

    if (isShow && data?.id && episode?.season && episode?.episode) {
      const episodeLookupKey = `${data.id}:${episode.season}:${episode.episode}`;
      let episodeMeta = null;
      if (episodeMetadataCache.has(episodeLookupKey)) {
        episodeMeta = episodeMetadataCache.get(episodeLookupKey);
      } else {
        try {
          episodeMeta = await fetchEpisodeDetails(data.id, episode.season, episode.episode);
        } catch (err) {
          console.error('Episode metadata fetch failed for:', file.name, err);
        }
        episodeMetadataCache.set(episodeLookupKey, episodeMeta || null);
      }

      displayName = formatImportedEpisodeDisplayName(
        showName,
        episode,
        episodeMeta?.name || '',
        file.name
      );
    }

    let matchedSubtitles = subtitleAssignments.get(file.path) || [];
    if (!matchedSubtitles.length && files.length === 1 && subtitleFiles.length) {
      matchedSubtitles = subtitleFiles;
    }

    library.push({
      name: displayName,
      path: file.path,
      isShow,
      data,
      episode,
      showName,
      showKey,
      subtitles: mergeSubtitleLists([], matchedSubtitles),
    });
    newCount += 1;
  }

  currentLibrary = library;
  await window.api.saveLibrary(currentLibrary);
  if (newCount > 0) {
    addLog(`Imported ${newCount} item(s) from ${sourceLabel}.`);
  } else {
    addLog(`No new items imported from ${sourceLabel}.`);
  }
  showHome(currentView);
}

function normalizeFileNameForMatch(name) {
  return (name || '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function tokenizeForMatching(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
  );
}

function readMediaMatchContext(file) {
  const fileName = file?.name || '';
  const cleaned = fileName.replace(/\.[^/.]+$/, '').replace(/[\._-]+/g, ' ');
  const episode = parseEpisodeInfo(fileName);
  return {
    normalizedBase: normalizeFileNameForMatch(fileName),
    episode,
    tokens: tokenizeForMatching(cleaned),
  };
}

function scoreSubtitleForMedia(file, subtitle) {
  if (!subtitle?.path) return -1;
  const media = readMediaMatchContext(file);
  const subtitleBase = normalizeFileNameForMatch(subtitle?.name);
  const subtitleEpisode = subtitle?.analysis?.episode || parseEpisodeInfo(subtitle?.name || '');
  const subtitleHeader = subtitle?.analysis?.headerText || '';
  const subtitleTokens = new Set(subtitle?.analysis?.tokens || []);

  let score = 0;
  if (subtitleBase && media.normalizedBase) {
    if (subtitleBase === media.normalizedBase) score += 12;
    else if (subtitleBase.startsWith(media.normalizedBase) || media.normalizedBase.startsWith(subtitleBase)) score += 8;
    else if (subtitleBase.includes(media.normalizedBase) || media.normalizedBase.includes(subtitleBase)) score += 5;
  }

  if (media.episode && subtitleEpisode) {
    if (media.episode.season === subtitleEpisode.season && media.episode.episode === subtitleEpisode.episode) {
      score += 14;
    } else if (media.episode.season === subtitleEpisode.season) {
      score += 2;
    } else {
      score -= 4;
    }
  }

  let overlap = 0;
  for (const token of media.tokens) {
    if (subtitleTokens.has(token)) overlap += 1;
  }
  if (overlap >= 2) score += Math.min(overlap * 2, 8);

  const mediaJoined = Array.from(media.tokens).join(' ');
  if (mediaJoined && subtitleHeader && subtitleHeader.includes(mediaJoined.slice(0, 20))) {
    score += 3;
  }

  return score;
}

function assignSubtitlesToMediaFiles(files, subtitleFiles) {
  const assignment = new Map();
  for (const file of files) {
    assignment.set(file.path, []);
  }

  for (const subtitle of subtitleFiles || []) {
    let best = null;
    let bestScore = -Infinity;

    for (const file of files) {
      const score = scoreSubtitleForMedia(file, subtitle);
      if (score > bestScore) {
        bestScore = score;
        best = file;
      }
    }

    if (best && bestScore >= 5) {
      assignment.get(best.path)?.push(subtitle);
    }
  }

  return assignment;
}

function mergeSubtitleLists(existingSubtitles, incomingSubtitles) {
  const merged = new Map();
  for (const subtitle of existingSubtitles || []) {
    if (!subtitle?.path) continue;
    merged.set(subtitle.path.toLowerCase(), subtitle);
  }
  for (const subtitle of incomingSubtitles || []) {
    if (!subtitle?.path) continue;
    merged.set(subtitle.path.toLowerCase(), subtitle);
  }
  return Array.from(merged.values());
}

function getSubtitleFontSize() {
  return localStorage.getItem('subtitleFontSize') || '20px';
}

function setSubtitleFontSize(size) {
  const allowed = new Set(['16px', '20px', '24px']);
  const value = allowed.has(size) ? size : '20px';
  document.documentElement.style.setProperty('--subtitle-font-size', value);
  localStorage.setItem('subtitleFontSize', value);
}

function findMatchingSubtitlesForMedia(mediaFile, subtitleFiles) {
  if (!Array.isArray(subtitleFiles) || !subtitleFiles.length) return [];
  return subtitleFiles
    .map((subtitle) => ({ subtitle, score: scoreSubtitleForMedia(mediaFile, subtitle) }))
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.subtitle);
}

function buildMediaLabel(item) {
  if (item.isShow) {
    const showName = item.showName || item.data?.name || normalizeShowName(item.name);
    return `${showName} - ${formatEpisodeLabel(item)}`;
  }
  return item.data?.title || item.name;
}

function renderSelectList(items, labelFn, onSelect, actionLabel = 'Select') {
  const list = document.getElementById('clearList');
  if (!list) return;
  renderSelectListInto(list, items, labelFn, onSelect, actionLabel);
}

function renderSelectListInto(list, items, labelFn, onSelect, actionLabel = 'Select') {
  if (!list) return;
  list.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.classList.add('settings-item');
    empty.textContent = 'No items found.';
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.classList.add('settings-item');

    const title = document.createElement('span');
    title.classList.add('item-title');
    title.textContent = labelFn(item);

    const actionBtn = document.createElement('button');
    actionBtn.classList.add('settings-btn', 'secondary');
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', () => onSelect(item));

    row.appendChild(title);
    row.appendChild(actionBtn);
    list.appendChild(row);
  }
}

function renderDeleteListInto(list, items, labelFn, onDelete) {
  if (!list) return;
  list.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.classList.add('settings-item');
    empty.textContent = 'No items found.';
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.classList.add('settings-item');

    const title = document.createElement('span');
    title.classList.add('item-title');
    title.textContent = labelFn(item);

    const actions = document.createElement('div');
    actions.classList.add('delete-actions');

    const delBtn = document.createElement('button');
    delBtn.classList.add('settings-btn', 'settings-danger');
    delBtn.textContent = 'Delete';

    const confirmBtn = document.createElement('button');
    confirmBtn.classList.add('settings-btn', 'settings-danger');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.display = 'none';

    const cancelBtn = document.createElement('button');
    cancelBtn.classList.add('settings-btn', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.display = 'none';

    delBtn.addEventListener('click', () => {
      delBtn.style.display = 'none';
      confirmBtn.style.display = 'inline-flex';
      cancelBtn.style.display = 'inline-flex';
    });

    cancelBtn.addEventListener('click', () => {
      delBtn.style.display = 'inline-flex';
      confirmBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    });

    confirmBtn.addEventListener('click', () => onDelete(item));

    actions.appendChild(delBtn);
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    row.appendChild(title);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function ensurePlayableSubtitles(subtitles) {
  const output = [];
  const input = Array.isArray(subtitles) ? subtitles : [];

  for (const subtitle of input) {
    const subtitleSource = resolveSubtitleSource(subtitle);
    if (!subtitleSource) continue;
    if (subtitle.trackUrl) {
      output.push(subtitle);
      continue;
    }
    if (subtitle.src && !subtitle.path) {
      output.push({ ...subtitle, path: subtitleSource });
      continue;
    }

    if (window.api?.prepareSubtitleFile) {
      try {
        const prepared = await window.api.prepareSubtitleFile(subtitle.path);
        if (prepared) {
          output.push({ ...subtitle, ...prepared });
          continue;
        }
      } catch (err) {
        console.error('Failed to prepare subtitle for playback:', subtitle.path, err);
      }
    }

    output.push({ ...subtitle, path: subtitleSource });
  }

  return output;
}

function showManageSubtitles() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="subtitleManageBackBtn"><- Back</button>
      <h2>Manage Subtitles</h2>
      <div class="settings-section">
        <button id="subtitleImportModeBtn" class="settings-btn secondary">Import Subtitle</button>
        <button id="subtitleDeleteModeBtn" class="settings-btn secondary">Delete Subtitle</button>
      </div>
      <div id="clearList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  document.getElementById('subtitleManageBackBtn')?.addEventListener('click', showSettings);
  document.getElementById('subtitleImportModeBtn')?.addEventListener('click', showSubtitleImportList);
  document.getElementById('subtitleDeleteModeBtn')?.addEventListener('click', showSubtitleDeleteList);
}

function showSubtitleImportList() {
  const mediaItems = [...currentLibrary].sort((a, b) => buildMediaLabel(a).localeCompare(buildMediaLabel(b)));
  renderSelectList(
    mediaItems,
    (item) => buildMediaLabel(item),
    async (item) => {
      try {
        const subtitleFiles = await window.api.selectSubtitleFiles?.();
        if (!subtitleFiles || !subtitleFiles.length) return;

        currentLibrary = currentLibrary.map((entry) => {
          if (entry.path !== item.path) return entry;
          const subtitles = mergeSubtitleLists(entry.subtitles || [], subtitleFiles);
          return { ...entry, subtitles };
        });

        await window.api.saveLibrary(currentLibrary);
        addLog(`Imported ${subtitleFiles.length} subtitle file(s) for ${buildMediaLabel(item)}.`);
        showManageSubtitles();
      } catch (err) {
        console.error('Subtitle import failed:', err);
        showUiError('Import subtitle file failed. Check the console for details.');
      }
    },
    'Attach'
  );
}

function showSubtitleDeleteList() {
  const mediaWithSubtitles = currentLibrary
    .filter((item) => Array.isArray(item.subtitles) && item.subtitles.length)
    .sort((a, b) => buildMediaLabel(a).localeCompare(buildMediaLabel(b)));

  renderSelectList(
    mediaWithSubtitles,
    (item) => buildMediaLabel(item),
    (item) => {
      renderDeleteList(
        item.subtitles || [],
        (subtitle) => subtitle.name || subtitle.path,
        async (subtitle) => {
          currentLibrary = currentLibrary.map((entry) => {
            if (entry.path !== item.path) return entry;
            const filtered = (entry.subtitles || []).filter((sub) => sub.path !== subtitle.path);
            return { ...entry, subtitles: filtered };
          });
          await window.api.saveLibrary(currentLibrary);
          addLog(`Deleted subtitle "${subtitle.name || subtitle.path}" from ${buildMediaLabel(item)}.`);
          showManageSubtitles();
        }
      );
    },
    'Select'
  );
}

async function reconnectMovieMetadata(item, manualTitle) {
  const nextTitle = String(manualTitle || '').trim();
  if (!nextTitle) return;

  let data = null;
  try {
    data = await fetchMovieData(nextTitle, {
      promptOnMultiple: true,
      pickerTitle: 'Choose the correct movie',
    });
  } catch (err) {
    console.error('Movie metadata reconnect failed:', err);
  }

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;
    const fallbackData = {
      ...(entry.data || {}),
      title: nextTitle,
    };
    return {
      ...entry,
      name: nextTitle,
      data: data || fallbackData,
      movieExtras: null,
    };
  });

  await window.api.saveLibrary(currentLibrary);
  if (data) {
    addLog(`Reconnected movie metadata: ${nextTitle}`);
  } else {
    addLog(`Updated movie title but TMDB match was not found: ${nextTitle}`, 'error');
  }
}

async function reconnectShowMetadata(group, manualTitle) {
  const nextShowName = String(manualTitle || '').trim();
  if (!nextShowName) return;

  let data = null;
  try {
    data = await fetchTVData(nextShowName, {
      promptOnMultiple: true,
      pickerTitle: 'Choose the correct TV series',
    });
  } catch (err) {
    console.error('Show metadata reconnect failed:', err);
  }

  const resolvedShowName = data?.name || nextShowName;
  const nextShowKey = data?.id ? `tmdb:${data.id}` : resolvedShowName.toLowerCase();
  currentLibrary = currentLibrary.map((entry) => {
    if (!entry.isShow) return entry;
    if (getShowKeyForFile(entry) !== group.key) return entry;
    const fallbackData = {
      ...(entry.data || {}),
      name: resolvedShowName,
    };
    return {
      ...entry,
      showName: resolvedShowName,
      showKey: nextShowKey,
      data: data || fallbackData,
    };
  });

  await window.api.saveLibrary(currentLibrary);
  if (data) {
    addLog(`Reconnected show metadata: ${nextShowName}`);
  } else {
    addLog(`Updated show title but TMDB match was not found: ${nextShowName}`, 'error');
  }
}

async function reconnectEpisodeMetadata(item, manualName) {
  const nextName = String(manualName || '').trim();
  if (!nextName) return;

  const nextEpisode = parseEpisodeInfo(nextName) || item.episode || null;
  const nextShowName = item.showName || normalizeShowName(nextName);

  let data = null;
  try {
    data = await fetchTVData(nextShowName, {
      promptOnMultiple: true,
      pickerTitle: 'Choose the correct TV series',
    });
  } catch (err) {
    console.error('Episode metadata reconnect failed:', err);
  }

  const resolvedShowName = data?.name || nextShowName;
  const resolvedShowKey = data?.id ? `tmdb:${data.id}` : resolvedShowName.toLowerCase();

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;
    const fallbackData = {
      ...(entry.data || {}),
      name: resolvedShowName,
    };
    return {
      ...entry,
      name: nextName,
      episode: nextEpisode,
      showName: resolvedShowName,
      showKey: resolvedShowKey,
      data: data || fallbackData,
    };
  });

  await window.api.saveLibrary(currentLibrary);
  if (data) {
    addLog(`Reconnected episode metadata: ${formatEpisodeLabel({ ...item, name: nextName, episode: nextEpisode })}`);
  } else {
    addLog(`Updated episode name but TMDB show match was not found: ${nextName}`, 'error');
  }
}

function normalizeMetadataDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return raw;
}

function parseOptionalNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGenresInput(value) {
  return String(value || '')
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

function buildMovieMetadataDraft(item) {
  return {
    title: item?.data?.title || item?.name || '',
    releaseDate: getReleaseDateForItem(item) || '',
    overview: item?.movieExtras?.details?.overview || item?.data?.overview || '',
    rating: Number.isFinite(item?.movieExtras?.details?.vote_average)
      ? String(item.movieExtras.details.vote_average)
      : (Number.isFinite(item?.data?.vote_average) ? String(item.data.vote_average) : ''),
    runtime: Number.isFinite(getRuntimeForItem(item)) ? String(getRuntimeForItem(item)) : '',
    genres: getGenresFromItem(item).join(', '),
  };
}

function buildShowMetadataDraft(group) {
  return {
    name: group?.data?.name || group?.name || '',
    firstAirDate: getReleaseDateForGroup(group) || '',
    overview: group?.data?.overview || '',
    rating: Number.isFinite(group?.data?.vote_average) ? String(group.data.vote_average) : '',
    runtime: Number.isFinite(getRuntimeForGroup(group)) ? String(getRuntimeForGroup(group)) : '',
    genres: getGenresFromGroup(group).join(', '),
  };
}

function buildEpisodeMetadataDraft(item) {
  return {
    displayName: item?.name || '',
    season: item?.episode?.season ? String(item.episode.season) : '',
    episode: item?.episode?.episode ? String(item.episode.episode) : '',
  };
}

async function saveMovieMetadataEdits(item, values) {
  const title = String(values?.title || '').trim() || item?.data?.title || item?.name || 'Movie';
  const releaseDate = normalizeMetadataDateInput(values?.releaseDate);
  const overview = String(values?.overview || '').trim();
  const rating = parseOptionalNumber(values?.rating);
  const runtime = parseOptionalNumber(values?.runtime);
  const genres = parseGenresInput(values?.genres);

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;

    const nextData = {
      ...(entry.data || {}),
      title,
      release_date: releaseDate || null,
      overview: overview || '',
      vote_average: rating ?? null,
      runtime: runtime ?? null,
    };

    if (genres.length) {
      nextData.genres = genres;
      nextData.genre_ids = [];
    } else {
      delete nextData.genres;
      nextData.genre_ids = [];
    }

    const nextMovieExtras = {
      ...(entry.movieExtras || {}),
      details: {
        ...(entry.movieExtras?.details || {}),
        title,
        release_date: releaseDate || null,
        overview: overview || '',
        vote_average: rating ?? null,
        runtime: runtime ?? null,
        genres,
      },
    };

    return {
      ...entry,
      name: title,
      data: nextData,
      movieExtras: nextMovieExtras,
    };
  });

  await window.api.saveLibrary(currentLibrary);
  addLog(`Updated movie metadata: ${title}`);
}

async function saveShowMetadataEdits(group, values) {
  const name = String(values?.name || '').trim() || group?.data?.name || group?.name || 'TV Show';
  const firstAirDate = normalizeMetadataDateInput(values?.firstAirDate);
  const overview = String(values?.overview || '').trim();
  const rating = parseOptionalNumber(values?.rating);
  const runtime = parseOptionalNumber(values?.runtime);
  const genres = parseGenresInput(values?.genres);
  const nextShowKey = group?.tmdbId ? `tmdb:${group.tmdbId}` : name.toLowerCase();

  currentLibrary = currentLibrary.map((entry) => {
    if (!entry.isShow || getShowKeyForFile(entry) !== group.key) return entry;

    const nextData = {
      ...(entry.data || {}),
      name,
      first_air_date: firstAirDate || null,
      overview: overview || '',
      vote_average: rating ?? null,
      episode_run_time: runtime ? [runtime] : [],
    };

    if (genres.length) {
      nextData.genres = genres;
      nextData.genre_ids = [];
    } else {
      delete nextData.genres;
      nextData.genre_ids = [];
    }

    return {
      ...entry,
      showName: name,
      showKey: nextShowKey,
      data: nextData,
    };
  });

  await window.api.saveLibrary(currentLibrary);
  addLog(`Updated show metadata: ${name}`);
}

async function saveEpisodeMetadataEdits(item, values) {
  const displayName = String(values?.displayName || '').trim() || item?.name || '';
  const season = Math.max(1, Math.floor(parseOptionalNumber(values?.season) || item?.episode?.season || 1));
  const episode = Math.max(1, Math.floor(parseOptionalNumber(values?.episode) || item?.episode?.episode || 1));

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;
    return {
      ...entry,
      name: displayName,
      episode: {
        season,
        episode,
      },
    };
  });

  await window.api.saveLibrary(currentLibrary);
  addLog(`Updated episode metadata: ${formatEpisodeLabel({ ...item, name: displayName, episode: { season, episode } })}`);
}

function getPlaybackMarkers(item) {
  const markers = item?.playbackMarkers || {};
  return {
    introStart: Number.isFinite(markers?.introStart) ? markers.introStart : null,
    introEnd: Number.isFinite(markers?.introEnd) ? markers.introEnd : null,
    creditsStart: Number.isFinite(markers?.creditsStart) ? markers.creditsStart : null,
  };
}

function parseMarkerValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function splitMarkerTimeParts(value) {
  if (!Number.isFinite(value) || value < 0) {
    return { hours: '', minutes: '', seconds: '' };
  }
  const totalSeconds = Math.floor(value);
  return {
    hours: String(Math.floor(totalSeconds / 3600)),
    minutes: String(Math.floor((totalSeconds % 3600) / 60)),
    seconds: String(totalSeconds % 60),
  };
}

function parseMarkerInput(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const hasAny = Object.values(value).some((part) => String(part ?? '').trim() !== '');
    if (!hasAny) return null;
    const hours = Math.max(0, Math.floor(Number(value.hours) || 0));
    const minutes = Math.max(0, Math.floor(Number(value.minutes) || 0));
    const seconds = Math.max(0, Math.floor(Number(value.seconds) || 0));
    return (hours * 3600) + (minutes * 60) + seconds;
  }
  return parseMarkerValue(value);
}

function formatMarkerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const tenths = Math.floor((seconds - totalSeconds) * 10);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
  return tenths > 0 ? `${base}.${tenths}` : base;
}

async function savePlaybackMarkers(item, markers) {
  const normalized = {};
  const introStart = parseMarkerInput(markers?.introStart);
  const introEnd = parseMarkerInput(markers?.introEnd);
  const creditsStart = parseMarkerInput(markers?.creditsStart);

  if (introStart !== null) normalized.introStart = introStart;
  if (introEnd !== null) normalized.introEnd = introEnd;
  if (creditsStart !== null) normalized.creditsStart = creditsStart;

  currentLibrary = currentLibrary.map((entry) => {
    if (entry.path !== item.path) return entry;
    const next = { ...entry };
    if (Object.keys(normalized).length) {
      next.playbackMarkers = normalized;
    } else {
      delete next.playbackMarkers;
    }
    return next;
  });

  await window.api.saveLibrary(currentLibrary);
  addLog(`Updated playback markers: ${buildMediaLabel(item)}`);
}

function showPlaybackMarkerEditor(item, options = {}) {
  const content = document.getElementById('content');
  if (!content) return;
  setSideActive('settings');

  const markers = getPlaybackMarkers(item);
  const isEpisode = !!item?.isShow;
  const backTarget = typeof options.onBack === 'function' ? options.onBack : showPlaybackMarkerTools;

  content.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'settings-page';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '<- Back';

  const heading = document.createElement('h2');
  heading.textContent = 'Playback Markers';

  const card = document.createElement('div');
  card.className = 'marker-editor-card';

  const title = document.createElement('h3');
  title.className = 'metadata-editor-title';
  title.textContent = buildMediaLabel(item);

  const copy = document.createElement('p');
  copy.className = 'metadata-editor-copy';
  copy.textContent = isEpisode
    ? 'Pause on the exact frame you want, then use the buttons below to capture intro and credits timings.'
    : 'Pause on the exact frame you want, then capture the intro timing for this movie.';

  const preview = document.createElement('video');
  preview.className = 'marker-preview-video';
  preview.src = resolveMediaSource(item);
  preview.controls = true;
  preview.preload = 'metadata';
  preview.playsInline = true;

  const currentTime = document.createElement('div');
  currentTime.className = 'marker-current-time';
  currentTime.textContent = 'Current time: 0:00';

  const form = document.createElement('form');
  form.className = 'marker-editor-form';

  const makeMarkerRow = (labelText, fieldName, initialValue) => {
    const row = document.createElement('div');
    row.className = 'marker-row';

    const label = document.createElement('span');
    label.className = 'metadata-editor-label';
    label.textContent = labelText;

    const parts = splitMarkerTimeParts(initialValue);
    const timeInputs = document.createElement('div');
    timeInputs.className = 'marker-time-inputs';

    const buildPartInput = (partLabel, partValue) => {
      const wrap = document.createElement('label');
      wrap.className = 'marker-time-part';

      const hint = document.createElement('span');
      hint.className = 'marker-time-part-label';
      hint.textContent = partLabel;

      const input = document.createElement('input');
      input.className = 'prompt-input marker-time-input';
      input.type = 'number';
      input.step = '1';
      input.min = '0';
      input.value = partValue;

      wrap.appendChild(hint);
      wrap.appendChild(input);
      timeInputs.appendChild(wrap);
      return input;
    };

    const hoursInput = buildPartInput('Hour', parts.hours);
    const minutesInput = buildPartInput('Minute', parts.minutes);
    const secondsInput = buildPartInput('Second', parts.seconds);

    const pretty = document.createElement('span');
    pretty.className = 'marker-time-label';
    pretty.textContent = initialValue !== null ? formatMarkerTime(initialValue) : '--:--';

    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'settings-btn secondary';
    setBtn.textContent = 'Use Current';

    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'settings-btn secondary';
    jumpBtn.textContent = 'Preview';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'settings-btn secondary';
    clearBtn.textContent = 'Clear';

    const getPartsValue = () => ({
      hours: hoursInput.value,
      minutes: minutesInput.value,
      seconds: secondsInput.value,
    });

    const syncPretty = () => {
      const parsed = parseMarkerInput(getPartsValue());
      pretty.textContent = parsed !== null ? formatMarkerTime(parsed) : '--:--';
    };

    hoursInput.addEventListener('input', syncPretty);
    minutesInput.addEventListener('input', syncPretty);
    secondsInput.addEventListener('input', syncPretty);
    setBtn.addEventListener('click', () => {
      const previewParts = splitMarkerTimeParts(preview.currentTime);
      hoursInput.value = previewParts.hours;
      minutesInput.value = previewParts.minutes;
      secondsInput.value = previewParts.seconds;
      syncPretty();
    });
    jumpBtn.addEventListener('click', () => {
      const parsed = parseMarkerInput(getPartsValue());
      if (parsed === null) return;
      preview.currentTime = parsed;
      preview.pause();
    });
    clearBtn.addEventListener('click', () => {
      hoursInput.value = '';
      minutesInput.value = '';
      secondsInput.value = '';
      syncPretty();
    });

    row.appendChild(label);
    row.appendChild(timeInputs);
    row.appendChild(pretty);
    row.appendChild(setBtn);
    row.appendChild(jumpBtn);
    row.appendChild(clearBtn);

    return { row, getValue: getPartsValue, syncPretty, fieldName };
  };

  const rows = [
    makeMarkerRow('Intro start', 'introStart', markers.introStart),
    makeMarkerRow('Intro end', 'introEnd', markers.introEnd),
  ];

  if (isEpisode) {
    rows.push(makeMarkerRow('Credits start', 'creditsStart', markers.creditsStart));
  }

  rows.forEach((entry) => form.appendChild(entry.row));

  const actions = document.createElement('div');
  actions.className = 'metadata-editor-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-btn secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    preview.pause();
    backTarget();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'settings-btn';
  saveBtn.textContent = 'Save Markers';

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  preview.addEventListener('timeupdate', () => {
    currentTime.textContent = `Current time: ${formatMarkerTime(preview.currentTime)}`;
  });
  preview.addEventListener('loadedmetadata', () => {
    currentTime.textContent = `Current time: ${formatMarkerTime(preview.currentTime)}`;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const nextMarkers = {};
      rows.forEach((entry) => {
        nextMarkers[entry.fieldName] = entry.getValue();
      });
      await savePlaybackMarkers(item, nextMarkers);
      preview.pause();
      backTarget();
    } catch (err) {
      console.error('Playback marker save failed:', err);
      showUiError('Could not save playback markers.');
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  card.appendChild(title);
  card.appendChild(copy);
  card.appendChild(preview);
  card.appendChild(currentTime);
  card.appendChild(form);
  page.appendChild(backBtn);
  page.appendChild(heading);
  page.appendChild(card);
  content.appendChild(page);

  backBtn.addEventListener('click', () => {
    preview.pause();
    backTarget();
  });
}

function createMetadataEditorField({ name, label, value = '', type = 'text', placeholder = '', rows = 0 }) {
  const wrap = document.createElement('label');
  wrap.className = 'metadata-editor-field';
  if (rows > 0) {
    wrap.classList.add('full-width');
  }

  const labelNode = document.createElement('span');
  labelNode.className = 'metadata-editor-label';
  labelNode.textContent = label;

  const input = rows > 0
    ? document.createElement('textarea')
    : document.createElement('input');

  input.className = 'prompt-input metadata-editor-input';
  input.name = name;
  input.placeholder = placeholder;
  if (rows > 0) {
    input.rows = rows;
  } else {
    input.type = type;
  }
  input.value = value;

  wrap.appendChild(labelNode);
  wrap.appendChild(input);

  return { wrap, input };
}

function showMetadataEditForm({ pageTitle, itemTitle, copy, fields, onSave, onBack }) {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'settings-page';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '<- Back';
  backBtn.addEventListener('click', onBack);

  const heading = document.createElement('h2');
  heading.textContent = pageTitle;

  const card = document.createElement('div');
  card.className = 'metadata-editor-card';

  const title = document.createElement('h3');
  title.className = 'metadata-editor-title';
  title.textContent = itemTitle;

  const copyNode = document.createElement('p');
  copyNode.className = 'metadata-editor-copy';
  copyNode.textContent = copy;

  const form = document.createElement('form');
  form.className = 'metadata-editor-form';

  const refs = {};
  fields.forEach((field) => {
    const built = createMetadataEditorField(field);
    refs[field.name] = built.input;
    form.appendChild(built.wrap);
  });

  const actions = document.createElement('div');
  actions.className = 'metadata-editor-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'settings-btn secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onBack);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'settings-btn';
  saveBtn.textContent = 'Save Metadata';

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const values = {};
      Object.keys(refs).forEach((key) => {
        values[key] = refs[key].value;
      });
      await onSave(values);
      onBack();
    } catch (err) {
      console.error('Metadata save failed:', err);
      showUiError('Could not save metadata changes.');
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  card.appendChild(title);
  card.appendChild(copyNode);
  card.appendChild(form);
  page.appendChild(backBtn);
  page.appendChild(heading);
  page.appendChild(card);
  content.appendChild(page);

  const firstField = fields[0]?.name;
  if (firstField && refs[firstField]) {
    refs[firstField].focus();
    if (typeof refs[firstField].select === 'function' && refs[firstField].tagName === 'INPUT') {
      refs[firstField].select();
    }
  }
}

function showMovieMetadataEditor(item) {
  const draft = buildMovieMetadataDraft(item);
  showMetadataEditForm({
    pageTitle: 'Edit Metadata',
    itemTitle: draft.title || item?.name || 'Movie',
    copy: 'Update this movie metadata manually. These values are stored in your local library.',
    fields: [
      { name: 'title', label: 'Title', value: draft.title, placeholder: 'Movie title' },
      { name: 'releaseDate', label: 'Release date or year', value: draft.releaseDate, placeholder: '2024 or 2024-05-01' },
      { name: 'overview', label: 'Overview', value: draft.overview, rows: 5, placeholder: 'Movie description' },
      { name: 'rating', label: 'Rating (/10)', value: draft.rating, placeholder: '8.4' },
      { name: 'runtime', label: 'Runtime (minutes)', value: draft.runtime, placeholder: '120' },
      { name: 'genres', label: 'Genres', value: draft.genres, placeholder: 'Action, Adventure' },
    ],
    onSave: (values) => saveMovieMetadataEdits(item, values),
    onBack: showManualMetadataTools,
  });
}

function showShowMetadataEditor(group) {
  const draft = buildShowMetadataDraft(group);
  showMetadataEditForm({
    pageTitle: 'Edit Metadata',
    itemTitle: draft.name || group?.name || 'TV Show',
    copy: 'Update this show metadata manually. The changes apply to every episode in this show.',
    fields: [
      { name: 'name', label: 'Show title', value: draft.name, placeholder: 'Show title' },
      { name: 'firstAirDate', label: 'First air date or year', value: draft.firstAirDate, placeholder: '2012 or 2012-09-29' },
      { name: 'overview', label: 'Overview', value: draft.overview, rows: 5, placeholder: 'Show description' },
      { name: 'rating', label: 'Rating (/10)', value: draft.rating, placeholder: '8.1' },
      { name: 'runtime', label: 'Episode runtime (minutes)', value: draft.runtime, placeholder: '24' },
      { name: 'genres', label: 'Genres', value: draft.genres, placeholder: 'Animation, Action & Adventure' },
    ],
    onSave: (values) => saveShowMetadataEdits(group, values),
    onBack: showManualMetadataTools,
  });
}

function showEpisodeMetadataEditor(item) {
  const draft = buildEpisodeMetadataDraft(item);
  showMetadataEditForm({
    pageTitle: 'Edit Episode Metadata',
    itemTitle: buildMediaLabel(item),
    copy: 'Update this single episode label and numbering manually.',
    fields: [
      { name: 'displayName', label: 'Episode display name', value: draft.displayName, placeholder: 'Show.Name.S01E01.Episode.Title' },
      { name: 'season', label: 'Season number', value: draft.season, type: 'number', placeholder: '1' },
      { name: 'episode', label: 'Episode number', value: draft.episode, type: 'number', placeholder: '1' },
    ],
    onSave: (values) => saveEpisodeMetadataEdits(item, values),
    onBack: showManualMetadataTools,
  });
}

async function refreshAccountState({ mergeProgress = false, persistLibrary = false, syncProgress = false } = {}) {
  if (window.api?.getAppContext) {
    try {
      const context = await window.api.getAppContext();
      desktopAppContext = {
        sharedServerConfigured: !!context?.sharedServerConfigured,
        useSharedLibrary: !!context?.useSharedLibrary,
      };
    } catch (err) {
      desktopAppContext = { sharedServerConfigured: false, useSharedLibrary: false };
    }
  }

  if (!window.api?.getCurrentAccountUser) {
    currentAccountUser = null;
    currentLibrary = stripLibraryPosterOverrides(stripLibraryWatchProgress(currentLibrary));
    refreshAdminUi();
    return { user: null, items: currentLibrary };
  }

  const session = await window.api.getCurrentAccountUser();
  currentAccountUser = session?.user || null;
  if (desktopAppContext.sharedServerConfigured) {
    desktopAppContext.useSharedLibrary = !currentAccountUser?.isAdmin;
  }
  refreshAdminUi();

  if (!currentAccountUser) {
    currentLibrary = stripLibraryPosterOverrides(stripLibraryWatchProgress(currentLibrary));
    return {
      user: null,
      items: currentLibrary,
    };
  }

  if (currentAccountUser && mergeProgress && window.api.refreshLibraryAccountProgress) {
    const result = await window.api.refreshLibraryAccountProgress(currentLibrary);
    if (Array.isArray(result?.items)) {
      currentLibrary = result.items;
      if (persistLibrary && window.api.saveLibrary && !isSharedLibraryMode()) {
        await window.api.saveLibrary(currentLibrary);
      }
    }
  }

  if (currentAccountUser && syncProgress && window.api.syncLibraryAccountProgress) {
    await window.api.syncLibraryAccountProgress(currentLibrary);
  }

  return {
    user: currentAccountUser,
    items: currentLibrary,
  };
}

function setAccountFieldState(fieldRefs, fieldName, message = '') {
  const field = fieldRefs[fieldName];
  if (!field) return;
  field.input.classList.toggle('account-input-error', !!message);
  field.error.textContent = message || '';
}

function clearAccountFieldStates(fieldRefs) {
  Object.keys(fieldRefs).forEach((fieldName) => setAccountFieldState(fieldRefs, fieldName, ''));
}

function createAccountField(name, labelText, type = 'text') {
  const wrap = document.createElement('label');
  wrap.className = 'account-form-field';

  const label = document.createElement('span');
  label.className = 'account-form-label';
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'prompt-input account-form-input';
  input.type = type;
  input.name = name;

  const error = document.createElement('span');
  error.className = 'account-form-error';

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(error);
  return { wrap, input, error };
}

function openAccountAuthModal(mode) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog account-auth-dialog';

    const heading = document.createElement('p');
    heading.className = 'confirm-message';
    heading.textContent = mode === 'signup' ? 'Create account' : 'Log in';

    const subheading = document.createElement('p');
    subheading.className = 'account-auth-copy';
    subheading.textContent = mode === 'signup'
      ? 'Create an account to sync your progress across desktop and web.'
      : 'Log in to sync your watch progress.';

    const form = document.createElement('form');
    form.className = 'account-auth-form';

    const fieldRefs = {};
    const fieldDefs = mode === 'signup'
      ? [
        ['firstName', 'First name'],
        ['lastName', 'Last name'],
        ['email', 'Email', 'email'],
        ['password', 'Password', 'password'],
        ['confirmPassword', 'Confirm password', 'password'],
      ]
      : [
        ['email', 'Email', 'email'],
        ['password', 'Password', 'password'],
      ];

    fieldDefs.forEach(([name, labelText, type]) => {
      const field = createAccountField(name, labelText, type || 'text');
      fieldRefs[name] = field;
      form.appendChild(field.wrap);
    });

    const status = document.createElement('p');
    status.className = 'account-auth-status';

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'settings-btn secondary';
    cancelBtn.textContent = 'Cancel';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'settings-btn';
    submitBtn.textContent = mode === 'signup' ? 'Sign Up' : 'Log In';

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => close(false));
    submitBtn.addEventListener('click', () => {
      form.requestSubmit();
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearAccountFieldStates(fieldRefs);
      status.textContent = '';

      const payload = {};
      for (const [name, field] of Object.entries(fieldRefs)) {
        payload[name] = field.input.value.trim();
      }

      let hasClientErrors = false;
      fieldDefs.forEach(([name, labelText]) => {
        if (!payload[name]) {
          setAccountFieldState(fieldRefs, name, `${labelText} is required.`);
          hasClientErrors = true;
        }
      });

      if (mode === 'signup' && payload.password && payload.confirmPassword && payload.password !== payload.confirmPassword) {
        setAccountFieldState(fieldRefs, 'confirmPassword', 'Passwords do not match.');
        hasClientErrors = true;
      }

      if (hasClientErrors) return;

      status.textContent = 'Verifying...';
      submitBtn.disabled = true;
      cancelBtn.disabled = true;

      try {
        const result = mode === 'signup'
          ? await window.api.signUpAccount(payload)
          : await window.api.logInAccount(payload);

        if (!result?.ok) {
          if (result?.fieldErrors) {
            Object.entries(result.fieldErrors).forEach(([name, message]) => {
              setAccountFieldState(fieldRefs, name, message);
            });
          }
          status.textContent = result?.authError || result?.error || 'Unable to verify your account.';
          return;
        }

        await refreshAccountState({ mergeProgress: true, persistLibrary: true, syncProgress: true });
        if (window.api?.getLibrary) {
          const loaded = await window.api.getLibrary();
          currentLibrary = Array.isArray(loaded) ? loaded : [];
        }
        close(true);
      } catch (err) {
        status.textContent = 'Unable to verify your account.';
      } finally {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    dialog.appendChild(heading);
    dialog.appendChild(subheading);
    dialog.appendChild(form);
    dialog.appendChild(status);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const firstField = fieldDefs[0]?.[0];
    if (firstField && fieldRefs[firstField]) {
      setTimeout(() => fieldRefs[firstField].input.focus(), 0);
    }
  });
}

function getDesktopAccountDisplayName() {
  if (!currentAccountUser) return '';
  return currentAccountUser.fullName
    || `${currentAccountUser.firstName || ''} ${currentAccountUser.lastName || ''}`.trim()
    || currentAccountUser.email
    || '';
}

function showAccountPage() {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="accountBackBtn"><- Back</button>
      <h2>Account</h2>
      <div class="settings-grid">
        <div class="settings-left">
          <div class="account-summary-card">
            <h3 id="accountTitle">${currentAccountUser ? getDesktopAccountDisplayName() : 'Optional account'}</h3>
            <p id="accountDescription" class="account-summary-text">
              ${currentAccountUser
                ? (currentAccountUser.isAdmin
                  ? 'Progress sync is active, and admin tools are unlocked for this account.'
                  : 'Progress sync is active for this account.')
                : 'Sign in or create an account to sync your continue-watching progress with the websites.'}
            </p>
            <p id="accountEmail" class="account-summary-text${currentAccountUser ? '' : ' hidden'}">
              ${currentAccountUser?.email || ''}
            </p>
            <div class="account-action-row" id="accountActionRow"></div>
          </div>
        </div>

        <div class="settings-right">
          <div class="analytics-card">
            <h3 class="analytics-title">Sync</h3>
            <div class="analytics-item"><span>Status</span><span>${currentAccountUser ? 'Signed In' : 'Guest'}</span></div>
            <div class="analytics-item"><span>Role</span><span>${currentAccountUser ? (currentAccountUser.isAdmin ? 'Admin' : 'Viewer') : 'Guest'}</span></div>
            <div class="analytics-item"><span>Progress</span><span>${currentAccountUser ? 'Synced' : 'Local Only'}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  setSideActive('account');

  document.getElementById('accountBackBtn')?.addEventListener('click', () => showHome(currentView));

  const actionRow = document.getElementById('accountActionRow');
  if (!actionRow) return;

  if (!currentAccountUser) {
    const loginBtn = document.createElement('button');
    loginBtn.className = 'settings-btn secondary';
    loginBtn.textContent = 'Log In';
    loginBtn.addEventListener('click', async () => {
      const success = await openAccountAuthModal('login');
      if (success) {
        showHome('all');
      }
    });

    const signupBtn = document.createElement('button');
    signupBtn.className = 'settings-btn';
    signupBtn.textContent = 'Sign Up';
    signupBtn.addEventListener('click', async () => {
      const success = await openAccountAuthModal('signup');
      if (success) {
        showHome('all');
      }
    });

    actionRow.appendChild(loginBtn);
    actionRow.appendChild(signupBtn);
    return;
  }

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'settings-btn secondary';
  logoutBtn.textContent = 'Log Out';
  logoutBtn.addEventListener('click', async () => {
    await window.api.logOutAccount?.();
    await refreshAccountState({ mergeProgress: false, persistLibrary: false, syncProgress: false });
    if (window.api?.getLibrary) {
      const loaded = await window.api.getLibrary();
      currentLibrary = Array.isArray(loaded) ? loaded : [];
    }
    showAccountPage();
  });

  actionRow.appendChild(logoutBtn);

  const favoriteMovies = currentLibrary.filter((item) => !item?.isShow && !!item?.isFavorite);
  const favoriteShows = groupShows(currentLibrary).filter((group) => isShowFavorite(group));
  const favoriteItems = [...favoriteMovies, ...favoriteShows];

  const favoritesWrap = document.createElement('div');
  favoritesWrap.className = 'account-favorites-section';

  const favoritesTitle = document.createElement('h3');
  favoritesTitle.className = 'analytics-title';
  favoritesTitle.textContent = 'Favorites';
  favoritesWrap.appendChild(favoritesTitle);

  if (!favoriteItems.length) {
    const empty = document.createElement('p');
    empty.className = 'account-summary-text';
    empty.textContent = 'No favorites yet. Tap the heart on a movie or show to save it here.';
    favoritesWrap.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'account-favorites-grid';

    favoriteMovies.forEach((item) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'account-favorite-card';
      card.addEventListener('click', () => showDetails(item));

      const img = document.createElement('img');
      img.className = 'account-favorite-poster';
      img.src = getMoviePosterSrc(item, 154);
      img.alt = item.data?.title || item.name || 'Movie';

      const label = document.createElement('span');
      label.className = 'account-favorite-label';
      label.textContent = item.data?.title || item.name || 'Movie';

      card.appendChild(img);
      card.appendChild(label);
      list.appendChild(card);
    });

    favoriteShows.forEach((group) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'account-favorite-card';
      card.addEventListener('click', () => showShowDetails(group));

      const img = document.createElement('img');
      img.className = 'account-favorite-poster';
      img.src = getShowPosterSrc(group, 154);
      img.alt = group.data?.name || group.name || 'TV Show';

      const label = document.createElement('span');
      label.className = 'account-favorite-label';
      label.textContent = group.data?.name || group.name || 'TV Show';

      card.appendChild(img);
      card.appendChild(label);
      list.appendChild(card);
    });

    favoritesWrap.appendChild(list);
  }

  document.querySelector('.settings-left')?.appendChild(favoritesWrap);
}

function showMetadataReconnectTools() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="metadataBackBtn"><- Back</button>
      <h2>Reconnect Metadata</h2>
      <div class="settings-section">
        <button id="reconnectMovieBtn" class="settings-btn secondary">Fix One Movie</button>
        <button id="reconnectShowBtn" class="settings-btn secondary">Fix One Show</button>
        <button id="reconnectEpisodeBtn" class="settings-btn secondary">Fix One Episode</button>
      </div>
      <div id="clearList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  document.getElementById('metadataBackBtn')?.addEventListener('click', showSettings);

  document.getElementById('reconnectMovieBtn')?.addEventListener('click', () => {
    const movies = currentLibrary.filter((item) => !item.isShow);
    renderSelectList(
      movies,
      (item) => item.data?.title || item.name,
      async (item) => {
        const currentTitle = item.data?.title || item.name;
        const nextTitle = await askTextInput({
          title: 'Enter movie title for metadata lookup:',
          initialValue: currentTitle,
          placeholder: 'Movie title',
          submitLabel: 'Reconnect',
        });
        if (nextTitle === null) return;
        await reconnectMovieMetadata(item, nextTitle);
        showMetadataReconnectTools();
      },
      'Edit & Reconnect'
    );
  });

  document.getElementById('reconnectShowBtn')?.addEventListener('click', () => {
    const shows = groupShows(currentLibrary);
    renderSelectList(
      shows,
      (group) => group.data?.name || group.name,
      async (group) => {
        const currentTitle = group.data?.name || group.name;
        const nextTitle = await askTextInput({
          title: 'Enter show title for metadata lookup:',
          initialValue: currentTitle,
          placeholder: 'Show title',
          submitLabel: 'Reconnect',
        });
        if (nextTitle === null) return;
        await reconnectShowMetadata(group, nextTitle);
        showMetadataReconnectTools();
      },
      'Edit & Reconnect'
    );
  });

  document.getElementById('reconnectEpisodeBtn')?.addEventListener('click', () => {
    const episodes = currentLibrary.filter((item) => item.isShow);
    renderSelectList(
      episodes,
      (item) => buildMediaLabel(item),
      async (item) => {
        const nextName = await askTextInput({
          title: 'Enter episode filename/title (use SxxExx if possible):',
          initialValue: item.name || '',
          placeholder: 'Show.Name.S01E01.Episode',
          submitLabel: 'Reconnect',
        });
        if (nextName === null) return;
        await reconnectEpisodeMetadata(item, nextName);
        showMetadataReconnectTools();
      },
      'Edit & Reconnect'
    );
  });
}

function showManualMetadataTools() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="metadataEditBackBtn"><- Back</button>
      <h2>Edit Metadata</h2>
      <div class="settings-section">
        <button id="editMovieMetadataBtn" class="settings-btn secondary">Edit One Movie</button>
        <button id="editShowMetadataBtn" class="settings-btn secondary">Edit One Show</button>
        <button id="editEpisodeMetadataBtn" class="settings-btn secondary">Edit One Episode</button>
      </div>
      <div id="clearList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  document.getElementById('metadataEditBackBtn')?.addEventListener('click', showSettings);

  document.getElementById('editMovieMetadataBtn')?.addEventListener('click', () => {
    const movies = currentLibrary.filter((item) => !item.isShow);
    renderSelectList(
      movies,
      (item) => item.data?.title || item.name,
      (item) => showMovieMetadataEditor(item),
      'Edit'
    );
  });

  document.getElementById('editShowMetadataBtn')?.addEventListener('click', () => {
    const shows = groupShows(currentLibrary);
    renderSelectList(
      shows,
      (group) => group.data?.name || group.name,
      (group) => showShowMetadataEditor(group),
      'Edit'
    );
  });

  document.getElementById('editEpisodeMetadataBtn')?.addEventListener('click', () => {
    showEpisodeHierarchyPicker({
      pageTitle: 'Edit Episode Metadata',
      introCopy: 'Choose a show, then a season, then an episode to edit.',
      actionLabel: 'Edit',
      onEpisodeSelect: (item) => showEpisodeMetadataEditor(item),
      onBack: showManualMetadataTools,
    });
  });
}

function showPlaybackMarkerTools() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="markerToolsBackBtn"><- Back</button>
      <h2>Playback Markers</h2>
      <div class="settings-section">
        <button id="editMovieMarkersBtn" class="settings-btn secondary">Mark One Movie</button>
        <button id="editEpisodeMarkersBtn" class="settings-btn secondary">Mark One Episode</button>
      </div>
      <div id="clearList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  document.getElementById('markerToolsBackBtn')?.addEventListener('click', showSettings);

  document.getElementById('editMovieMarkersBtn')?.addEventListener('click', () => {
    const movies = currentLibrary.filter((item) => !item.isShow);
    renderSelectList(
      movies,
      (item) => item.data?.title || item.name,
      (item) => showPlaybackMarkerEditor(item, { onBack: showPlaybackMarkerTools }),
      'Mark'
    );
  });

  document.getElementById('editEpisodeMarkersBtn')?.addEventListener('click', () => {
    showEpisodeHierarchyPicker({
      pageTitle: 'Playback Markers',
      introCopy: 'Choose a show, then a season, then an episode to assign intro and credits markers.',
      actionLabel: 'Mark',
      onEpisodeSelect: (item) => showPlaybackMarkerEditor(item, { onBack: showPlaybackMarkerTools }),
      onBack: showPlaybackMarkerTools,
    });
  });
}

async function updateAnalyticsPanel() {
  const moviesCount = currentLibrary.filter((item) => !item.isShow).length;
  const episodesCount = currentLibrary.filter((item) => item.isShow).length;

  const showKeys = new Set();
  const seasonKeys = new Set();
  for (const item of currentLibrary) {
    if (!item.isShow) continue;
    const key = getShowKeyForFile(item);
    showKeys.add(key);
    if (item.episode?.season) {
      seasonKeys.add(`${key}-S${item.episode.season}`);
    }
  }

  const showsCount = showKeys.size;
  const seasonsCount = seasonKeys.size;

  const statMovies = document.getElementById('statMovies');
  const statShows = document.getElementById('statShows');
  const statSeasons = document.getElementById('statSeasons');
  const statEpisodes = document.getElementById('statEpisodes');
  const statSize = document.getElementById('statSize');

  if (statMovies) statMovies.textContent = moviesCount;
  if (statShows) statShows.textContent = showsCount;
  if (statSeasons) statSeasons.textContent = seasonsCount;
  if (statEpisodes) statEpisodes.textContent = episodesCount;

  if (statSize && window.api?.getLibraryStats) {
    try {
      const stats = await window.api.getLibraryStats(currentLibrary);
      const gb = stats?.totalBytes ? stats.totalBytes / (1024 ** 3) : 0;
      statSize.textContent = `${gb.toFixed(2)} GB`;
    } catch (err) {
      statSize.textContent = 'N/A';
    }
  }
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  setTheme(saved);
}

function showSettings() {
  const content = document.getElementById('content');
  if (!content) return;
  const adminToolsMarkup = isCurrentUserAdmin()
    ? `
          <div class="settings-section">
            <button id="importLibraryBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 21l-4-4h3V11h2v6h3l-4 4zm-7-14h14V5H5v2z"/>
                </svg>
              </span>
              <span>Import Library</span>
            </button>
            <button id="exportLibraryBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l4 4h-3v6h-2V7H8l4-4zm-7 14h14v2H5v-2z"/>
                </svg>
              </span>
              <span>Export Library</span>
            </button>
            <button id="importSubtitleBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h16v14H8l-4 4V4zm3 4v2h2V8H7zm4 0v2h6V8h-6zm-4 4v2h10v-2H7z"/>
                </svg>
              </span>
              <span>Manage Subtitles</span>
            </button>
            <button id="libraryQualityBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 4h18v12H3V4zm2 2v8h14V6H5zm4 12h6v2H9v-2zm-2-5h2v2H7v-2zm4-3h2v5h-2V10zm4-2h2v7h-2V8z"/>
                </svg>
              </span>
              <span>Library Quality</span>
            </button>
            <button id="metadataReconnectBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4a8 8 0 0 1 7.74 6h-2.09a6 6 0 1 0-1.66 6.09l1.42 1.42A8 8 0 1 1 12 4zm7 0v5h-5l1.8-1.8A7.96 7.96 0 0 1 19 4z"/>
                </svg>
              </span>
              <span>Reconnect Metadata</span>
            </button>
            <button id="metadataEditBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 17.25V20h2.75L17.8 8.95l-2.75-2.75L4 17.25zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-1.5-1.5a1.003 1.003 0 0 0-1.42 0l-1.17 1.17 2.75 2.75 1.34-1z"/>
                </svg>
              </span>
              <span>Edit Metadata</span>
            </button>
            <button id="playbackMarkersBtn" class="settings-btn secondary">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4a8 8 0 0 1 8 8c0 2.64-1.28 4.98-3.25 6.44l1.6 1.6-1.41 1.41-1.89-1.89A7.93 7.93 0 0 1 12 20a8 8 0 1 1 0-16zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-.75 2h1.5v4.19l3.03 1.75-.75 1.3-3.78-2.18V8z"/>
                </svg>
              </span>
              <span>Playback Markers</span>
            </button>
            <button id="clearLibraryBtn" class="settings-btn settings-danger">
              <span class="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/>
                </svg>
              </span>
              <span>Delete Library</span>
            </button>
          </div>
    `
    : `
          <div class="settings-section">
            <div class="settings-status">
              Sign in with the admin account to unlock library import, cleanup, subtitle, poster, and metadata tools.
            </div>
          </div>
    `;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="settingsBackBtn"><- Back</button>
      <h2>Settings</h2>

      <div class="settings-grid">
        <div class="settings-left">
          <div class="settings-section">
            <div class="settings-row">
              <span>Theme</span>
              <div class="theme-switch">
                <span class="theme-label" id="lightLabel">Light</span>
                <label class="toggle">
                  <input type="checkbox" id="themeToggle">
                  <span class="toggle-slider"></span>
                </label>
                <span class="theme-label" id="darkLabel">Dark</span>
              </div>
            </div>
          </div>
          ${adminToolsMarkup}

          <div id="settingsStatus" class="settings-status"></div>
        </div>

        <div class="settings-right">
          <div class="analytics-card">
            <h3 class="analytics-title">Analytics</h3>
            <div class="analytics-item"><span>Movies</span><span id="statMovies">0</span></div>
            <div class="analytics-item"><span>Shows</span><span id="statShows">0</span></div>
            <div class="analytics-item"><span>Seasons</span><span id="statSeasons">0</span></div>
            <div class="analytics-item"><span>Episodes</span><span id="statEpisodes">0</span></div>
            <div class="analytics-item"><span>Total Size</span><span id="statSize">0 GB</span></div>
          </div>

          <div class="log-panel">
            <div class="log-header">Log panel</div>
            <div id="logList" class="log-list"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  setSideActive('settings');

  const backBtn = document.getElementById('settingsBackBtn');
  backBtn?.addEventListener('click', () => showHome(currentView));

  const themeToggle = document.getElementById('themeToggle');
  const darkLabel = document.getElementById('darkLabel');
  const lightLabel = document.getElementById('lightLabel');
  if (themeToggle && darkLabel && lightLabel) {
    const isDark = document.body.dataset.theme === 'dark';
    themeToggle.checked = isDark;
    darkLabel.classList.toggle('active', isDark);
    lightLabel.classList.toggle('active', !isDark);
    themeToggle.addEventListener('change', () => {
      const nextTheme = themeToggle.checked ? 'dark' : 'light';
      setTheme(nextTheme);
      darkLabel.classList.toggle('active', themeToggle.checked);
      lightLabel.classList.toggle('active', !themeToggle.checked);
    });
  }

  const setStatus = () => {};

  document.getElementById('clearLibraryBtn')?.addEventListener('click', showClearOptions);
  document.getElementById('importSubtitleBtn')?.addEventListener('click', showManageSubtitles);
  document.getElementById('libraryQualityBtn')?.addEventListener('click', showLibraryQualityTools);
  document.getElementById('metadataEditBtn')?.addEventListener('click', showManualMetadataTools);
  document.getElementById('playbackMarkersBtn')?.addEventListener('click', showPlaybackMarkerTools);
  document.getElementById('metadataReconnectBtn')?.addEventListener('click', showMetadataReconnectTools);
  document.getElementById('exportLibraryBtn')?.addEventListener('click', async () => {
    try {
      const result = await window.api.exportLibrary(currentLibrary);
      if (result?.canceled) return;
      addLog('Exported library successfully.');
    } catch (err) {
      console.error('Export failed:', err);
      addLog('Export failed.', 'error');
    }
  });
  document.getElementById('importLibraryBtn')?.addEventListener('click', async () => {
    try {
      const result = await window.api.importLibrary();
      if (result?.canceled) return;
      if (!Array.isArray(result?.items)) {
        addLog('Import failed.', 'error');
        return;
      }

      const merged = Array.isArray(currentLibrary) ? [...currentLibrary] : [];
      for (const item of result.items) {
        if (!item?.path) continue;
        if (merged.some((existing) => existing.path === item.path)) continue;
        merged.push(item);
      }

      currentLibrary = merged;
      await window.api.saveLibrary(currentLibrary);
      addLog(`Imported ${result.items.length} items from library file.`);
      showHome(currentView);
    } catch (err) {
      console.error('Import failed:', err);
      addLog('Import failed.', 'error');
    }
  });

  updateAnalyticsPanel();
  renderLogPanel();
}

function showClearOptions() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="clearBackBtn"><- Back</button>
      <h2>Delete Library</h2>
      <div class="settings-section">
        <button id="deleteMovieBtn" class="settings-btn secondary">Delete One Movie</button>
        <button id="deleteShowBtn" class="settings-btn secondary">Delete One Show</button>
        <button id="deleteSeasonBtn" class="settings-btn secondary">Delete One Season</button>
        <button id="deleteEpisodeBtn" class="settings-btn secondary">Delete One Episode</button>
        <button id="deleteAllBtn" class="settings-btn settings-danger">Delete Entire Library</button>
      </div>
      <div id="clearList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  document.getElementById('clearBackBtn')?.addEventListener('click', showSettings);

  document.getElementById('deleteAllBtn')?.addEventListener('click', async () => {
    if (!confirm('Delete the entire library?')) return;
    currentLibrary = [];
    await window.api.saveLibrary(currentLibrary);
    addLog('Deleted entire library.');
    showClearOptions();
  });

  document.getElementById('deleteMovieBtn')?.addEventListener('click', () => {
    const movies = currentLibrary.filter((item) => !item.isShow);
    renderDeleteList(
      movies,
      (item) => item.data?.title || item.name,
      async (item) => {
        currentLibrary = currentLibrary.filter((entry) => entry.path !== item.path);
        await window.api.saveLibrary(currentLibrary);
        addLog(`Deleted movie: ${item.data?.title || item.name}`);
        showClearOptions();
      }
    );
  });

  document.getElementById('deleteShowBtn')?.addEventListener('click', () => {
    const groups = groupShows(currentLibrary);
    renderDeleteList(
      groups,
      (group) => group.data?.name || group.name,
      async (group) => {
        currentLibrary = currentLibrary.filter((entry) => {
          if (!entry.isShow) return true;
          return getShowKeyForFile(entry) !== group.key;
        });
        await window.api.saveLibrary(currentLibrary);
        addLog(`Deleted show: ${group.data?.name || group.name}`);
        showClearOptions();
      }
    );
  });

  document.getElementById('deleteSeasonBtn')?.addEventListener('click', () => {
    const seasonGroups = groupSeasons(currentLibrary);
    renderDeleteList(
      seasonGroups,
      (season) => season.label,
      async (season) => {
        currentLibrary = currentLibrary.filter((entry) => {
          if (!entry.isShow) return true;
          const key = getShowKeyForFile(entry);
          return !(key === season.key && entry.episode?.season === season.season);
        });
        await window.api.saveLibrary(currentLibrary);
        addLog(`Deleted season: ${season.label}`);
        showClearOptions();
      }
    );
  });

  document.getElementById('deleteEpisodeBtn')?.addEventListener('click', () => {
    showDeleteEpisodeHierarchy();
  });
}

function applyRelinkEntries(relinks) {
  if (!Array.isArray(relinks) || !relinks.length) return 0;
  let changed = 0;

  currentLibrary = currentLibrary.map((entry, index) => {
    const hit = relinks.find((relink) => relink.index === index);
    if (!hit?.newPath) return entry;
    changed += 1;
    return {
      ...entry,
      path: hit.newPath,
      name: getFileNameFromPath(hit.newPath),
    };
  });

  return changed;
}

async function showLibraryQualityTools() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="settings-page">
      <button class="back-btn" id="qualityBackBtn"><- Back</button>
      <h2>Library Quality</h2>
      <div class="settings-section">
        <button id="scanMissingBtn" class="settings-btn secondary">Scan Missing Files</button>
        <button id="autoRelinkBtn" class="settings-btn secondary">Auto Relink From Folder</button>
      </div>
      <div id="qualityStatus" class="settings-status"></div>
      <div id="qualityList" class="settings-list"></div>
    </div>
  `;

  setSideActive('settings');

  const status = document.getElementById('qualityStatus');
  const list = document.getElementById('qualityList');
  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('status-error', !!isError);
  };

  const renderMissingRows = (missing) => {
    if (!list) return;
    list.innerHTML = '';

    if (!missing.length) {
      const row = document.createElement('div');
      row.classList.add('settings-item');
      row.textContent = 'No missing media files found.';
      list.appendChild(row);
      return;
    }

    for (const entry of missing) {
      const row = document.createElement('div');
      row.classList.add('settings-item', 'quality-item');

      const labelWrap = document.createElement('div');
      labelWrap.classList.add('quality-text');

      const title = document.createElement('div');
      title.classList.add('item-title');
      title.textContent = entry.isShow
        ? `${entry.showName || normalizeShowName(entry.name || '')} - ${entry.name || 'Episode'}`
        : (entry.name || 'Movie');

      const oldPath = document.createElement('code');
      oldPath.classList.add('quality-path');
      oldPath.textContent = entry.path || '';

      labelWrap.appendChild(title);
      labelWrap.appendChild(oldPath);

      const relinkBtn = document.createElement('button');
      relinkBtn.classList.add('settings-btn', 'secondary');
      relinkBtn.textContent = 'Relink';
      relinkBtn.addEventListener('click', async () => {
        if (!window.api?.selectRelinkFile) return;
        const selected = await window.api.selectRelinkFile(entry.path);
        if (!selected) return;
        const changed = applyRelinkEntries([{ index: entry.index, oldPath: entry.path, newPath: selected }]);
        if (changed > 0) {
          await window.api.saveLibrary(currentLibrary);
          addLog(`Relinked media file: ${getFileNameFromPath(selected)}`);
          showLibraryQualityTools();
        }
      });

      row.appendChild(labelWrap);
      row.appendChild(relinkBtn);
      list.appendChild(row);
    }
  };

  const runScan = async () => {
    setStatus('Scanning library files...');
    if (!window.api?.scanMissingLibraryItems) {
      setStatus('Missing-file scanner is unavailable.', true);
      return;
    }

    const result = await window.api.scanMissingLibraryItems(currentLibrary);
    if (!result?.ok) {
      setStatus(result?.error || 'Scan failed.', true);
      return;
    }

    setStatus(result.missing.length
      ? `Found ${result.missing.length} missing item(s).`
      : 'All media files are available.');
    renderMissingRows(result.missing);
  };

  document.getElementById('qualityBackBtn')?.addEventListener('click', showSettings);
  document.getElementById('scanMissingBtn')?.addEventListener('click', runScan);
  document.getElementById('autoRelinkBtn')?.addEventListener('click', async () => {
    if (!window.api?.autoRelinkLibrary) {
      setStatus('Auto relink is unavailable.', true);
      return;
    }
    setStatus('Scanning selected folder and trying to relink...');
    const result = await window.api.autoRelinkLibrary(currentLibrary);
    if (!result?.ok) {
      setStatus(result?.error || 'Auto relink failed.', true);
      return;
    }
    if (result.canceled) {
      setStatus('Auto relink canceled.');
      return;
    }

    const changed = applyRelinkEntries(result.relinks || []);
    if (changed > 0) {
      await window.api.saveLibrary(currentLibrary);
      addLog(`Auto relink fixed ${changed} file(s).`);
    }
    setStatus(`Auto relink scanned ${result.scanned || 0} file(s) and fixed ${changed} item(s).`);
    runScan();
  });

  runScan();
}

function renderDeleteList(items, labelFn, onDelete) {
  const list = document.getElementById('clearList');
  if (!list) return;
  renderDeleteListInto(list, items, labelFn, onDelete);
}

function getShowKeyForFile(file) {
  const tmdbId = Number.parseInt(file?.data?.id, 10);
  if (tmdbId) return `tmdb:${tmdbId}`;
  const showName = file.showName || normalizeShowName(file.name);
  return (file.showKey || showName || file.name).toLowerCase();
}

function groupSeasons(library) {
  const map = new Map();
  for (const item of library) {
    if (!item.isShow || !item.episode?.season) continue;
    const key = getShowKeyForFile(item);
    const season = item.episode.season;
    const mapKey = `${key}-S${season}`;
    if (!map.has(mapKey)) {
      const showName = item.showName || normalizeShowName(item.name);
      map.set(mapKey, {
        key,
        season,
        label: `${showName} - Season ${season}`,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function groupShows(library) {
  const map = new Map();

  for (const file of library) {
    if (!file.isShow) continue;

    const showName = file.showName || normalizeShowName(file.name);
    const key = getShowKeyForFile(file);

    if (!map.has(key)) {
      map.set(key, {
        key,
        name: showName || file.name,
        data: file.data || null,
        tmdbId: file.data?.id || file.tmdbId || null,
        episodes: [],
      });
    }

    const group = map.get(key);
    if (!group.data && file.data) group.data = file.data;
    if (!group.tmdbId && (file.data?.id || file.tmdbId)) group.tmdbId = file.data?.id || file.tmdbId;
    group.episodes.push(file);
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => a.name.localeCompare(b.name));
  for (const group of groups) {
    group.episodes.sort((a, b) => {
      if (a.episode && b.episode) {
        if (a.episode.season !== b.episode.season) {
          return a.episode.season - b.episode.season;
        }
        return a.episode.episode - b.episode.episode;
      }
      return a.name.localeCompare(b.name);
    });
  }

  return groups;
}

function getSeasonEntriesForGroup(group) {
  const seasonMap = new Map();
  const episodes = Array.isArray(group?.episodes) ? group.episodes : [];
  episodes.forEach((episode) => {
    const seasonNumber = episode?.episode?.season;
    if (!Number.isFinite(seasonNumber)) return;
    if (!seasonMap.has(seasonNumber)) {
      seasonMap.set(seasonNumber, []);
    }
    seasonMap.get(seasonNumber).push(episode);
  });

  return Array.from(seasonMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([season, items]) => ({
      season,
      episodes: items.sort((a, b) => (a?.episode?.episode || 0) - (b?.episode?.episode || 0)),
      label: `Season ${season} (${items.length} episode${items.length === 1 ? '' : 's'})`,
    }));
}

function showEpisodeHierarchyPicker({ pageTitle, introCopy, actionLabel = 'Select', onEpisodeSelect, onBack }) {
  const content = document.getElementById('content');
  if (!content) return;
  setSideActive('settings');

  content.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'settings-page';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '<- Back';

  const heading = document.createElement('h2');
  heading.textContent = pageTitle;

  const copy = document.createElement('p');
  copy.className = 'settings-status';
  copy.textContent = introCopy || 'Choose a show first.';

  const list = document.createElement('div');
  list.className = 'settings-list';

  page.appendChild(backBtn);
  page.appendChild(heading);
  page.appendChild(copy);
  page.appendChild(list);
  content.appendChild(page);

  const renderShowStep = () => {
    backBtn.onclick = onBack;
    heading.textContent = pageTitle;
    copy.textContent = introCopy || 'Choose a show first.';
    const shows = groupShows(currentLibrary);
    renderSelectListInto(
      list,
      shows,
      (group) => group.data?.name || group.name,
      (group) => renderSeasonStep(group),
      'Open'
    );
  };

  const renderSeasonStep = (group) => {
    backBtn.onclick = renderShowStep;
    heading.textContent = group.data?.name || group.name || pageTitle;
    copy.textContent = 'Choose a season.';
    const seasons = getSeasonEntriesForGroup(group);
    renderSelectListInto(
      list,
      seasons,
      (seasonEntry) => seasonEntry.label,
      (seasonEntry) => renderEpisodeStep(group, seasonEntry),
      'Open'
    );
  };

  const renderEpisodeStep = (group, seasonEntry) => {
    backBtn.onclick = () => renderSeasonStep(group);
    heading.textContent = `${group.data?.name || group.name || 'TV Show'} - Season ${seasonEntry.season}`;
    copy.textContent = 'Choose an episode.';
    renderSelectListInto(
      list,
      seasonEntry.episodes,
      (episode) => formatEpisodeLabel(episode),
      (episode) => onEpisodeSelect(episode, { group, season: seasonEntry.season, episodes: seasonEntry.episodes }),
      actionLabel
    );
  };

  renderShowStep();
}

function showDeleteEpisodeHierarchy() {
  if (!ensureAdminAccess()) return;
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'settings-page';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '<- Back';

  const heading = document.createElement('h2');
  const copy = document.createElement('p');
  copy.className = 'settings-status';
  const list = document.createElement('div');
  list.className = 'settings-list';

  page.appendChild(backBtn);
  page.appendChild(heading);
  page.appendChild(copy);
  page.appendChild(list);
  content.appendChild(page);
  setSideActive('settings');

  const renderShowStep = () => {
    backBtn.onclick = showClearOptions;
    heading.textContent = 'Delete Episode';
    copy.textContent = 'Choose a show first.';
    const shows = groupShows(currentLibrary);
    renderSelectListInto(
      list,
      shows,
      (group) => group.data?.name || group.name,
      (group) => renderSeasonStep(group),
      'Open'
    );
  };

  const renderSeasonStep = (group) => {
    backBtn.onclick = renderShowStep;
    heading.textContent = group.data?.name || group.name || 'Delete Episode';
    copy.textContent = 'Choose a season.';
    const seasons = getSeasonEntriesForGroup(group);
    renderSelectListInto(
      list,
      seasons,
      (seasonEntry) => seasonEntry.label,
      (seasonEntry) => renderEpisodeStep(group, seasonEntry.season),
      'Open'
    );
  };

  const renderEpisodeStep = (group, seasonNumber) => {
    backBtn.onclick = () => renderSeasonStep(group);
    heading.textContent = `${group.data?.name || group.name || 'TV Show'} - Season ${seasonNumber}`;
    copy.textContent = 'Choose the episode to delete.';
    const refreshedGroup = groupShows(currentLibrary).find((entry) => entry.key === group.key) || group;
    const seasonEpisodes = refreshedGroup.episodes.filter((episode) => episode?.episode?.season === seasonNumber);
    renderDeleteListInto(
      list,
      seasonEpisodes,
      (episode) => formatEpisodeLabel(episode),
      async (episode) => {
        currentLibrary = currentLibrary.filter((entry) => entry.path !== episode.path);
        await window.api.saveLibrary(currentLibrary);
        addLog(`Deleted episode: ${formatEpisodeLabel(episode)}`);

        const nextGroup = groupShows(currentLibrary).find((entry) => entry.key === group.key);
        if (!nextGroup) {
          renderShowStep();
          return;
        }

        const nextSeasonEpisodes = nextGroup.episodes.filter((entry) => entry?.episode?.season === seasonNumber);
        if (!nextSeasonEpisodes.length) {
          renderSeasonStep(nextGroup);
          return;
        }

        renderEpisodeStep(nextGroup, seasonNumber);
      }
    );
  };

  renderShowStep();
}

function getContinueWatchingEntries(library, showGroupsOverride = null) {
  const entries = [];

  for (const item of library) {
    if (item.isShow) continue;
    const percent = getWatchPercent(item);
    const updatedAt = Number(item?.watchProgress?.updatedAt) || 0;
    if (percent <= 0 || percent >= 100 || !updatedAt) continue;

    entries.push({
      type: 'movie',
      item,
      percent,
      updatedAt,
      subtitle: null,
    });
  }

  const showGroups = Array.isArray(showGroupsOverride) ? showGroupsOverride : groupShows(library);
  for (const group of showGroups) {
    const continueState = getShowContinueState(group);
    if (!continueState) continue;

    entries.push({
      type: 'show',
      group,
      percent: continueState.percent,
      updatedAt: continueState.updatedAt,
      subtitle: continueState.subtitle,
    });
  }

  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderContinueWatching(library, query = '', showGroups = null) {
  if (!continueSection) return;
  continueSection.replaceChildren();

  let entries = getContinueWatchingEntries(library, showGroups);
  if (selectedGenreFilter !== 'all') {
    entries = entries.filter((entry) => {
      if (entry.type === 'movie') {
        return getGenresFromItem(entry.item).includes(selectedGenreFilter);
      }
      return getGenresFromGroup(entry.group).includes(selectedGenreFilter);
    });
  }
  if (query) {
    entries = entries.filter((entry) => {
      const title = entry.type === 'movie'
        ? (entry.item.data?.title || entry.item.name)
        : (entry.group.data?.name || entry.group.name);
      return matchesQuery(title, query) || matchesQuery(entry.subtitle, query);
    });
  }

  if (!entries.length) {
    if (continueHeading) continueHeading.style.display = 'none';
    continueSection.style.display = 'none';
    return;
  }

  if (continueHeading) continueHeading.style.display = '';
  continueSection.style.display = '';

  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    frag.appendChild(createContinueCard(entry));
  }
  continueSection.appendChild(frag);
}

// render the library
function renderLibrary(libraryOverride, viewOverride) {
  if (!window.api || !window.api.getLibrary) {
    showUiError('Import is unavailable: preload bridge not found.');
    return;
  }

  const startTime = performance.now();
  ensureHomeLayout();

  const library = Array.isArray(libraryOverride) ? libraryOverride : currentLibrary;
  const view = viewOverride || currentView;
  const query = searchQuery.trim().toLowerCase();
  const genreQuery = selectedGenreFilter;
  const showGroupsBase = getGroupedShowsCached(library);

  if (continueSection) continueSection.replaceChildren();
  moviesSection.replaceChildren();
  showsSection.replaceChildren();
  refreshGenreFilterOptions(library, showGroupsBase);

  if (view === 'all') {
    renderContinueWatching(library, query, showGroupsBase);
  }

  let movieItems = library.filter((file) => !file.isShow);
  if (view === 'shows') {
    movieItems = [];
  }
  if (query) {
    movieItems = movieItems.filter((file) => matchesQuery(file.data?.title || file.name, query));
  }
  if (genreQuery !== 'all') {
    movieItems = movieItems.filter((file) => getGenresFromItem(file).includes(genreQuery));
  }
  movieItems = applySortToMovies(movieItems);
  const moviesFrag = document.createDocumentFragment();
  for (const file of movieItems) {

    const div = document.createElement('div');
    div.classList.add('movie');

    const img = document.createElement('img');
    img.src = getMoviePosterSrc(file, 200);
    img.loading = 'lazy';
    img.decoding = 'async';

    const title = document.createElement('p');
    title.textContent = file.data?.title || file.name;

    const posterWrap = document.createElement('div');
    posterWrap.classList.add('card-poster-wrap');
    posterWrap.appendChild(img);
    if (hasSubtitlesOnItem(file)) {
      appendCcBadge(posterWrap);
    }

    div.appendChild(posterWrap);
    const movieProgress = getWatchPercent(file);
    if (movieProgress > 0) {
      div.appendChild(createCardProgressBar(movieProgress));
    }
    div.appendChild(title);
    div.addEventListener('click', () => showDetails(file));

    moviesFrag.appendChild(div);
  }
  moviesSection.appendChild(moviesFrag);

  let showGroups = showGroupsBase;
  if (view === 'movies') {
    showGroups = [];
  }
  if (query) {
    showGroups = showGroups.filter((group) => {
      const name = group.data?.name || group.name;
      return matchesQuery(name, query);
    });
  }
  if (genreQuery !== 'all') {
    showGroups = showGroups.filter((group) => getGenresFromGroup(group).includes(genreQuery));
  }
  showGroups = applySortToShows(showGroups);
  const showsFrag = document.createDocumentFragment();
  for (const group of showGroups) {

    const div = document.createElement('div');
    div.classList.add('movie');

    const img = document.createElement('img');
    img.src = getShowPosterSrc(group, 200);
    img.loading = 'lazy';
    img.decoding = 'async';

    const title = document.createElement('p');
    title.textContent = group.data?.name || group.name;

    const posterWrap = document.createElement('div');
    posterWrap.classList.add('card-poster-wrap');
    posterWrap.appendChild(img);
    if (hasSubtitlesOnShow(group)) {
      appendCcBadge(posterWrap);
    }

    div.appendChild(posterWrap);
    const showProgress = getShowWatchPercent(group);
    if (showProgress > 0) {
      div.appendChild(createCardProgressBar(showProgress));
    }
    div.appendChild(title);
    div.addEventListener('click', () => showShowDetails(group));

    showsFrag.appendChild(div);
  }
  showsSection.appendChild(showsFrag);

  logRenderPerf(performance.now() - startTime, {
    movies: movieItems.length,
    shows: showGroups.length,
    continueCount: view === 'all' && continueSection ? continueSection.children.length : 0,
    query,
  });
}

async function showEpisodePlayer(file, onBack, options = {}) {
  if (activePlayerKeyHandler) {
    window.removeEventListener('keydown', activePlayerKeyHandler);
    activePlayerKeyHandler = null;
  }

  const content = document.getElementById('content');
  content.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.textContent = '<- Back';
  backBtn.classList.add('back-btn');
  backBtn.addEventListener('click', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      updateWatchProgressForPath(file.path, video.currentTime, video.duration, false);
    }
    cleanupPlayerHandlers();
    onBack();
  });
  content.appendChild(backBtn);

  const playerWrap = document.createElement('div');
  playerWrap.classList.add('player-container');
  setSubtitleFontSize(getSubtitleFontSize());

  const playerStage = document.createElement('div');
  playerStage.classList.add('player-stage');
  playerStage.classList.add('controls-visible');

  const video = document.createElement('video');
  video.src = resolveMediaSource(file);
  video.controls = false;
  video.autoplay = true;
  video.muted = false;
  video.defaultMuted = false;
  video.volume = 1;
  video.playsInline = true;
  video.classList.add('media-player');
  video.preload = 'metadata';
  video.addEventListener('canplay', () => {
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
  });

  const resumePercent = getWatchPercent(file);
  const resumePosition = Number(file?.watchProgress?.position) || 0;
  if (resumePercent > 1 && resumePercent < 100 && resumePosition > 0) {
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const safeResume = Math.min(resumePosition, Math.max(video.duration - 2, 0));
        video.currentTime = safeResume;
      }
    }, { once: true });
  }

  const playbackSequence = Array.isArray(options.episodes) && options.episodes.length
    ? [...options.episodes]
    : (file.isShow
      ? (groupShows(currentLibrary).find((group) => group.key === getShowKeyForFile(file))?.episodes || [file])
      : [file]);
  const currentEpisodeIndex = playbackSequence.findIndex((entry) => entry.path === file.path);
  const nextEpisode = currentEpisodeIndex >= 0 && currentEpisodeIndex < playbackSequence.length - 1
    ? playbackSequence[currentEpisodeIndex + 1]
    : null;
  const playbackMarkers = getPlaybackMarkers(file);

  let lastProgressSave = 0;
  let controlsHideTimer = null;
  let clickToggleTimer = null;
  let controlsFrameId = 0;
  const saveWatchProgress = (forceComplete = false) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const now = Date.now();
    if (!forceComplete && now - lastProgressSave < 2500) return;
    lastProgressSave = now;
    updateWatchProgressForPath(file.path, video.currentTime, video.duration, forceComplete);
  };

  video.addEventListener('timeupdate', () => saveWatchProgress(false));
  video.addEventListener('pause', () => saveWatchProgress(false));
  video.addEventListener('ended', () => saveWatchProgress(true));

  video.play().catch(() => {
    // Autoplay might be blocked; user can press play manually.
  });

  const stopControlSyncLoop = () => {
    if (controlsFrameId) {
      cancelAnimationFrame(controlsFrameId);
      controlsFrameId = 0;
    }
  };

  const startControlSyncLoop = () => {
    stopControlSyncLoop();
    const tick = () => {
      syncPlayerControls();
      if (video.currentSrc && !video.paused && !video.ended) {
        controlsFrameId = requestAnimationFrame(tick);
      } else {
        controlsFrameId = 0;
      }
    };
    controlsFrameId = requestAnimationFrame(tick);
  };

  const cleanupPlayerHandlers = () => {
    if (activePlayerKeyHandler) {
      window.removeEventListener('keydown', activePlayerKeyHandler);
      activePlayerKeyHandler = null;
    }
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('pointermove', handleDocumentPointerMove);
    document.removeEventListener('mousemove', handleDocumentPointerMove);
    video.removeEventListener('pointermove', handleStagePointerActivity);
    video.removeEventListener('mousemove', handleStagePointerActivity);
    stopControlSyncLoop();
    clearControlsHideTimer();
    if (clickToggleTimer) {
      clearTimeout(clickToggleTimer);
      clickToggleTimer = null;
    }
  };

  const clearControlsHideTimer = () => {
    if (controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
  };

  const showControls = (scheduleHide = true) => {
    playerStage.classList.add('controls-visible');
    clearControlsHideTimer();
    if (!scheduleHide || video.paused || video.ended || !video.currentSrc) return;
    controlsHideTimer = setTimeout(() => {
      playerStage.classList.remove('controls-visible');
    }, 2200);
  };

  const isShortcutEditableTarget = (target) => {
    const node = target && target.nodeType === 1 ? target : null;
    if (!node) return false;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (node.isContentEditable) return true;
    return false;
  };

  const handleDocumentPointerMove = (event) => {
    if (!video.currentSrc) return;
    showControls(true);
  };

  const toggleFullscreenForPlayer = async () => {
    try {
      const fullElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullElement === playerStage || fullElement === playerWrap || fullElement === video) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          return;
        }
        if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        return;
      }

      if (playerStage.requestFullscreen) {
        await playerStage.requestFullscreen();
        return;
      }
      if (playerStage.webkitRequestFullscreen) {
        playerStage.webkitRequestFullscreen();
        return;
      }
      if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      }
    } catch (err) {
      // Ignore fullscreen errors (platform restrictions, transient focus state).
    }
  };

  const handleFullscreenChange = () => {
    syncPlayerControls();
    showControls(true);
  };

  const controls = document.createElement('div');
  controls.classList.add('player-controls');

  const timelineWrap = document.createElement('div');
  timelineWrap.classList.add('player-timeline-wrap');

  const controlRow = document.createElement('div');
  controlRow.classList.add('player-control-row');

  const leftControls = document.createElement('div');
  leftControls.classList.add('player-left-controls');

  const centerControls = document.createElement('div');
  centerControls.classList.add('player-center-controls');

  const rightControls = document.createElement('div');
  rightControls.classList.add('player-right-controls');

  const volumeGroup = document.createElement('div');
  volumeGroup.classList.add('player-volume-group');

  const volumeRangeShell = document.createElement('div');
  volumeRangeShell.classList.add('player-range-shell');

  const backSeekBtn = document.createElement('button');
  backSeekBtn.type = 'button';
  backSeekBtn.classList.add('player-control-btn');
  setPlayerButtonIcon(backSeekBtn, 'replay', `Go back ${PLAYER_SEEK_SECONDS} seconds`);

  const playPauseBtn = document.createElement('button');
  playPauseBtn.type = 'button';
  playPauseBtn.classList.add('player-control-btn', 'primary');
  setPlayerButtonIcon(playPauseBtn, 'pause', 'Pause');

  const forwardSeekBtn = document.createElement('button');
  forwardSeekBtn.type = 'button';
  forwardSeekBtn.classList.add('player-control-btn');
  setPlayerButtonIcon(forwardSeekBtn, 'forward', `Go forward ${PLAYER_SEEK_SECONDS} seconds`);

  const currentTimeLabel = document.createElement('span');
  currentTimeLabel.classList.add('player-time');
  currentTimeLabel.textContent = '0:00';

  const timeline = document.createElement('input');
  timeline.type = 'range';
  timeline.min = '0';
  timeline.max = '1000';
  timeline.value = '0';
  timeline.classList.add('player-timeline');

  const durationLabel = document.createElement('span');
  durationLabel.classList.add('player-time', 'player-time-end');
  durationLabel.textContent = '0:00';

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.classList.add('player-control-btn', 'subtle');
  setPlayerButtonIcon(muteBtn, 'volume', 'Mute');

  const volumeRange = document.createElement('input');
  volumeRange.type = 'range';
  volumeRange.min = '0';
  volumeRange.max = '100';
  volumeRange.value = '100';
  volumeRange.classList.add('player-range');

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.type = 'button';
  fullscreenBtn.classList.add('player-control-btn', 'subtle');
  setPlayerButtonIcon(fullscreenBtn, 'fullscreen', 'Fullscreen');

  const cueActions = document.createElement('div');
  cueActions.classList.add('player-cue-actions');

  const skipIntroBtn = document.createElement('button');
  skipIntroBtn.type = 'button';
  skipIntroBtn.classList.add('settings-btn', 'secondary', 'player-cue-btn', 'hidden');
  skipIntroBtn.textContent = 'Skip Intro';

  const nextEpisodeBtn = document.createElement('button');
  nextEpisodeBtn.type = 'button';
  nextEpisodeBtn.classList.add('settings-btn', 'player-cue-btn', 'hidden');
  nextEpisodeBtn.textContent = 'Next Episode';

  cueActions.appendChild(skipIntroBtn);
  cueActions.appendChild(nextEpisodeBtn);

  const syncPlayerControls = () => {
    const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    currentTimeLabel.textContent = formatPlayerTime(currentTime);
    durationLabel.textContent = formatPlayerTime(hasDuration ? video.duration : 0);
    timeline.disabled = !hasDuration;
    timeline.value = hasDuration ? String(Math.round((currentTime / video.duration) * 1000)) : '0';

    const isPaused = video.paused || video.ended || !video.currentSrc;
    setPlayerButtonIcon(playPauseBtn, isPaused ? 'play' : 'pause', isPaused ? 'Play' : 'Pause');

    const effectiveVolume = video.muted ? 0 : video.volume;
    volumeRange.value = String(Math.round((Number.isFinite(effectiveVolume) ? effectiveVolume : 1) * 100));
    setPlayerButtonIcon(muteBtn, effectiveVolume <= 0 ? 'mute' : 'volume', effectiveVolume <= 0 ? 'Unmute' : 'Mute');

    const fullscreenActive = !!(document.fullscreenElement || document.webkitFullscreenElement);
    setPlayerButtonIcon(fullscreenBtn, fullscreenActive ? 'fullscreenExit' : 'fullscreen', fullscreenActive ? 'Exit Fullscreen' : 'Fullscreen');
  };

  const togglePlayback = () => {
    if (!video.currentSrc) return;
    if (video.paused || video.ended) {
      video.play().catch(() => {
        // Manual play can still fail transiently if media source is not ready yet.
      });
      return;
    }
    video.pause();
  };

  const updateCueButtons = () => {
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const hasIntroWindow =
      Number.isFinite(playbackMarkers.introStart)
      && Number.isFinite(playbackMarkers.introEnd)
      && playbackMarkers.introEnd > playbackMarkers.introStart;
    const showSkipIntro = hasIntroWindow
      && currentTime >= playbackMarkers.introStart
      && currentTime < playbackMarkers.introEnd;

    const showNextEpisode = !!nextEpisode && (
      (Number.isFinite(playbackMarkers.creditsStart) && currentTime >= playbackMarkers.creditsStart)
      || video.ended
    );

    skipIntroBtn.classList.toggle('hidden', !showSkipIntro);
    nextEpisodeBtn.classList.toggle('hidden', !showNextEpisode);
  };

  const handleStagePointerActivity = () => {
    if (!video.currentSrc) return;
    showControls(true);
  };

  const handleStageSingleClick = (event) => {
    if (event.target?.closest?.('.player-controls')) return;
    if (clickToggleTimer) {
      clearTimeout(clickToggleTimer);
      clickToggleTimer = null;
    }
    clickToggleTimer = setTimeout(() => {
      clickToggleTimer = null;
      togglePlayback();
      showControls(true);
    }, 220);
  };

  backSeekBtn.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - PLAYER_SEEK_SECONDS);
    showControls(true);
    syncPlayerControls();
  });
  forwardSeekBtn.addEventListener('click', () => {
    const maxTime = Number.isFinite(video.duration) ? video.duration : video.currentTime + PLAYER_SEEK_SECONDS;
    video.currentTime = Math.min(maxTime, video.currentTime + PLAYER_SEEK_SECONDS);
    showControls(true);
    syncPlayerControls();
  });
  playPauseBtn.addEventListener('click', togglePlayback);
  video.addEventListener('click', handleStageSingleClick);
  video.addEventListener('dblclick', (event) => {
    event.preventDefault();
    if (clickToggleTimer) {
      clearTimeout(clickToggleTimer);
      clickToggleTimer = null;
    }
    showControls(true);
    toggleFullscreenForPlayer();
  });
  timeline.addEventListener('input', () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = (Number(timeline.value) / 1000) * video.duration;
    showControls(true);
    syncPlayerControls();
    updateCueButtons();
  });
  muteBtn.addEventListener('click', () => {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) {
        video.volume = 1;
      }
    } else {
      video.muted = true;
    }
    showControls(true);
    syncPlayerControls();
  });
  volumeRange.addEventListener('input', () => {
    const nextVolume = Math.max(0, Math.min(1, Number(volumeRange.value) / 100));
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    showControls(true);
    syncPlayerControls();
  });
  fullscreenBtn.addEventListener('click', () => {
    showControls(true);
    toggleFullscreenForPlayer();
  });
  skipIntroBtn.addEventListener('click', () => {
    if (!Number.isFinite(playbackMarkers.introEnd)) return;
    video.currentTime = playbackMarkers.introEnd;
    showControls(true);
    syncPlayerControls();
    updateCueButtons();
    if (video.paused && !video.ended) {
      video.play().catch(() => {});
    }
  });
  nextEpisodeBtn.addEventListener('click', () => {
    if (!nextEpisode) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      updateWatchProgressForPath(file.path, video.duration, video.duration, true);
    }
    cleanupPlayerHandlers();
    showEpisodePlayer(nextEpisode, onBack, { episodes: playbackSequence });
  });
  cueActions.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  cueActions.addEventListener('dblclick', (event) => {
    event.stopPropagation();
  });

  video.addEventListener('loadedmetadata', syncPlayerControls);
  video.addEventListener('play', () => {
    syncPlayerControls();
    showControls(true);
    startControlSyncLoop();
    updateCueButtons();
  });
  video.addEventListener('pause', () => {
    syncPlayerControls();
    showControls(false);
    stopControlSyncLoop();
    updateCueButtons();
  });
  video.addEventListener('ended', () => {
    syncPlayerControls();
    showControls(false);
    stopControlSyncLoop();
    updateCueButtons();
  });
  video.addEventListener('volumechange', syncPlayerControls);
  video.addEventListener('durationchange', syncPlayerControls);
  video.addEventListener('timeupdate', updateCueButtons);
  video.addEventListener('seeked', updateCueButtons);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('pointermove', handleDocumentPointerMove);
  document.addEventListener('mousemove', handleDocumentPointerMove);
  playerStage.addEventListener('pointermove', handleStagePointerActivity);
  playerStage.addEventListener('mousemove', handleStagePointerActivity);
  video.addEventListener('pointermove', handleStagePointerActivity);
  video.addEventListener('mousemove', handleStagePointerActivity);
  playerStage.addEventListener('touchstart', () => showControls(true), { passive: true });
  playerStage.addEventListener('mouseenter', () => showControls(true));
  playerStage.addEventListener('mousedown', () => showControls(true));
  playerStage.addEventListener('click', handleStageSingleClick);
  playerStage.addEventListener('dblclick', (event) => {
    event.preventDefault();
    if (clickToggleTimer) {
      clearTimeout(clickToggleTimer);
      clickToggleTimer = null;
    }
    showControls(true);
    toggleFullscreenForPlayer();
  });
  playerStage.addEventListener('focusin', () => showControls(true));

  timelineWrap.appendChild(timeline);
  leftControls.appendChild(playPauseBtn);
  leftControls.appendChild(backSeekBtn);
  leftControls.appendChild(forwardSeekBtn);
  centerControls.appendChild(currentTimeLabel);
  centerControls.appendChild(durationLabel);
  volumeRangeShell.appendChild(volumeRange);
  volumeGroup.appendChild(muteBtn);
  volumeGroup.appendChild(volumeRangeShell);
  rightControls.appendChild(volumeGroup);
  rightControls.appendChild(fullscreenBtn);
  controlRow.appendChild(leftControls);
  controlRow.appendChild(centerControls);
  controlRow.appendChild(rightControls);
  controls.appendChild(timelineWrap);
  controls.appendChild(controlRow);

  activePlayerKeyHandler = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isShortcutEditableTarget(event.target)) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      video.currentTime = Math.min((video.duration || Infinity), video.currentTime + PLAYER_SEEK_SECONDS);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - PLAYER_SEEK_SECONDS);
    }
    if (event.code === 'KeyF' || event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFullscreenForPlayer();
    }
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      togglePlayback();
    }
  };
  window.addEventListener('keydown', activePlayerKeyHandler);

  const preparedSubtitles = await ensurePlayableSubtitles(file.subtitles);
  const availableSubtitles = preparedSubtitles.filter((subtitle) => !!resolveSubtitleSource(subtitle));
  availableSubtitles.forEach((subtitle, index) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = subtitle.name || `Subtitle ${index + 1}`;
    track.srclang = subtitle.language || 'en';
    track.src = resolveSubtitleSource(subtitle);
    if (index === 0) track.default = true;
    video.appendChild(track);
  });

  playerStage.appendChild(video);
  playerStage.appendChild(cueActions);
  playerStage.appendChild(controls);
  playerWrap.appendChild(playerStage);

  if (availableSubtitles.length) {
    const subtitleControls = document.createElement('div');
    subtitleControls.classList.add('subtitle-controls');

    const subtitleLabel = document.createElement('label');
    subtitleLabel.classList.add('subtitle-label');
    subtitleLabel.textContent = 'Subtitles';

    const subtitleToggle = document.createElement('select');
    subtitleToggle.classList.add('subtitle-select');

    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = 'Off';
    subtitleToggle.appendChild(offOption);

    availableSubtitles.forEach((subtitle, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = subtitle.name || `Subtitle ${index + 1}`;
      subtitleToggle.appendChild(option);
    });

    const sizeLabel = document.createElement('label');
    sizeLabel.classList.add('subtitle-label');
    sizeLabel.textContent = 'Size';

    const subtitleSize = document.createElement('select');
    subtitleSize.classList.add('subtitle-size-select');
    [
      { value: '16px', label: 'Small' },
      { value: '20px', label: 'Medium' },
      { value: '24px', label: 'Large' },
    ].forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      subtitleSize.appendChild(option);
    });
    subtitleSize.value = getSubtitleFontSize();

    const applyTrackMode = (selectedIndex) => {
      const textTracks = Array.from(video.textTracks || []);
      textTracks.forEach((track, index) => {
        track.mode = index === selectedIndex ? 'showing' : 'disabled';
      });
    };

    subtitleToggle.addEventListener('change', () => {
      if (subtitleToggle.value === 'off') {
        applyTrackMode(-1);
        return;
      }
      applyTrackMode(parseInt(subtitleToggle.value, 10));
    });

    subtitleSize.addEventListener('change', () => {
      setSubtitleFontSize(subtitleSize.value);
    });

    video.addEventListener('loadedmetadata', () => {
      subtitleToggle.value = '0';
      applyTrackMode(0);
    });

    subtitleControls.appendChild(subtitleLabel);
    subtitleControls.appendChild(subtitleToggle);
    subtitleControls.appendChild(sizeLabel);
    subtitleControls.appendChild(subtitleSize);
    playerWrap.appendChild(subtitleControls);
  }

  const episodes = Array.isArray(options.episodes) ? options.episodes : null;
  if (episodes && episodes.length) {
    const selector = document.createElement('select');
    selector.classList.add('episode-select');

    for (const ep of episodes) {
      const option = document.createElement('option');
      option.value = ep.path;
      option.textContent = formatEpisodeLabel(ep);
      selector.appendChild(option);
    }

    selector.value = file.path;
    selector.addEventListener('change', () => {
      const next = episodes.find((ep) => ep.path === selector.value);
      if (next) {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          updateWatchProgressForPath(file.path, video.currentTime, video.duration, false);
        }
        cleanupPlayerHandlers();
        showEpisodePlayer(next, onBack, { episodes });
      }
    });

    playerWrap.appendChild(selector);
  }

  content.appendChild(playerWrap);
  syncPlayerControls();
  updateCueButtons();
  if (!video.paused && !video.ended) {
    startControlSyncLoop();
  }
}

function formatEpisodeLabel(file) {
  if (file.episode) {
    const s = String(file.episode.season).padStart(2, '0');
    const e = String(file.episode.episode).padStart(2, '0');
    const title = extractEpisodeTitle(file.name);
    return title ? `S${s}E${e}: ${title}` : `S${s}E${e}: ${file.name}`;
  }
  return file.name;
}

function extractEpisodeTitle(name) {
  const noExt = name.replace(/\.[^/.]+$/, "");
  const match = noExt.match(/S\d{1,2}E\d{1,2}/i);
  if (!match || match.index === undefined) return null;

  const after = noExt.slice(match.index + match[0].length);
  const cleaned = after.replace(/^[\s._-]+/, '').replace(/[\s._-]+/g, ' ').trim();
  return cleaned || null;
}

async function showShowDetails(group) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.textContent = '<- Back';
  backBtn.classList.add('back-btn');
  backBtn.addEventListener('click', () => {
    showHome(currentView);
  });
  content.appendChild(backBtn);

  const header = document.createElement('div');
  header.classList.add('details-header');

  const poster = document.createElement('img');
  poster.src = getShowPosterSrc(group);
  poster.classList.add('details-poster');
  header.appendChild(poster);

  const info = document.createElement('div');
  info.classList.add('details-info');
  const titleRow = document.createElement('div');
  titleRow.classList.add('title-row');

  const title = document.createElement('h2');
  title.textContent = group.data?.name || group.name;
  titleRow.appendChild(title);

  const ratingStars = document.createElement('span');
  ratingStars.classList.add('rating-stars');
  const baseRating = group.data?.vote_average;
  if (baseRating) setRatingStars(ratingStars, baseRating, true);
  titleRow.appendChild(ratingStars);

  const year = document.createElement('p');
  const firstAirDate = group.data?.first_air_date;
  year.textContent = firstAirDate ? `Year: ${firstAirDate.slice(0, 4)}` : '';

  const overview = document.createElement('p');
  overview.classList.add('details-overview');
  overview.textContent = group.data?.overview || 'No description available.';

  const separator = document.createElement('div');
  separator.classList.add('details-separator');

  const metaGrid = document.createElement('div');
  metaGrid.classList.add('details-meta-grid');

  const directorGroup = createPeopleGroup('Director');
  fillPeopleChips(directorGroup.chips, []);

  const genres = document.createElement('p');
  const showGenres = getGenresFromGroup(group).join(', ');
  genres.textContent = showGenres ? `Genres: ${showGenres}` : 'Genres: Unknown';

  const seasonCount = Number.isFinite(group?.data?.number_of_seasons) ? group.data.number_of_seasons : null;
  const seasonsLine = document.createElement('p');
  seasonsLine.textContent = seasonCount ? `Seasons: ${seasonCount}` : 'Seasons: Unknown';

  const castGroup = createPeopleGroup('Cast');
  fillPeopleChips(castGroup.chips, []);

  const primaryCard = document.createElement('div');
  primaryCard.classList.add('details-card');
  primaryCard.appendChild(year);
  primaryCard.appendChild(directorGroup.wrap);
  primaryCard.appendChild(genres);
  primaryCard.appendChild(seasonsLine);

  const castCard = document.createElement('div');
  castCard.classList.add('details-card');
  castCard.appendChild(castGroup.wrap);

  metaGrid.appendChild(primaryCard);
  metaGrid.appendChild(castCard);

  info.appendChild(titleRow);
  info.appendChild(overview);
  info.appendChild(separator);
  info.appendChild(metaGrid);

  const detailsActions = document.createElement('div');
  detailsActions.classList.add('details-actions');
  if (currentAccountUser) {
    detailsActions.appendChild(createFavoriteButton(isShowFavorite(group), async () => {
      const nextFavorite = !isShowFavorite(group);
      const success = await setShowFavorite(group, nextFavorite);
      if (!success) return;
      const refreshedGroup = groupShows(currentLibrary).find((item) => item.key === group.key) || group;
      showShowDetails(refreshedGroup);
    }));
  }
  if (isCurrentUserAdmin()) {
    const hasPosterOverride = group.episodes.some((episode) => !!episode.customPosterPath || !!episode.customPosterTmdbPath);
    const editPosterControl = createPosterEditControl({
      hasPosterOverride,
      onAddCustomPoster: async () => {
        if (!window.api?.selectPosterFile || !window.api?.saveAccountPosterOverride) return;
        try {
          const selected = await window.api.selectPosterFile();
          if (!selected?.path) return;

          const result = await window.api.saveAccountPosterOverride({
            isShow: true,
            showKey: group.key,
            localPath: selected.path,
          });
          if (!result?.ok) {
            showUiError(result?.error || 'Could not update show poster.');
            return;
          }

          applyPosterOverrideToCurrentLibrary({
            showKey: group.key,
            localPath: selected.path,
          });
          addLog(`Updated poster for show: ${group.data?.name || group.name}`);

          const refreshedGroup = groupShows(currentLibrary).find((item) => item.key === group.key);
          showShowDetails(refreshedGroup || group);
        } catch (err) {
          console.error('Failed to update show poster:', err);
          showUiError('Could not update show poster.');
        }
      },
      onChooseTmdbPoster: async () => {
        const showId = Number(group?.data?.id);
        if (!showId) {
          showUiError('This show does not have TMDB metadata yet.');
          return;
        }

        try {
          const images = await fetchTvImages(showId);
          const selectedPosterPath = await promptTmdbPosterChoice(
            images?.posters,
            'Choose TMDB Poster',
            group.data?.name || group.name
          );
          if (!selectedPosterPath) return;

          const result = await window.api.saveAccountPosterOverride({
            isShow: true,
            showKey: group.key,
            tmdbPath: selectedPosterPath,
          });
          if (!result?.ok) {
            showUiError(result?.error || 'Could not update show poster.');
            return;
          }

          applyPosterOverrideToCurrentLibrary({
            showKey: group.key,
            tmdbPath: selectedPosterPath,
          });
          addLog(`Updated TMDB poster for show: ${group.data?.name || group.name}`);

          const refreshedGroup = groupShows(currentLibrary).find((item) => item.key === group.key);
          showShowDetails(refreshedGroup || group);
        } catch (err) {
          console.error('Failed to choose TMDB poster for show:', err);
          showUiError('Could not load TMDB posters for this show.');
        }
      },
      onResetPoster: async () => {
        try {
          const result = await window.api.clearAccountPosterOverride?.({
            isShow: true,
            showKey: group.key,
          });
          if (result && !result.ok) {
            showUiError(result?.error || 'Could not reset show poster.');
            return;
          }

          clearPosterOverrideFromCurrentLibrary({ showKey: group.key });
          addLog(`Reset poster for show: ${group.data?.name || group.name}`);

          const refreshedGroup = groupShows(currentLibrary).find((item) => item.key === group.key);
          showShowDetails(refreshedGroup || group);
        } catch (err) {
          console.error('Failed to reset show poster:', err);
          showUiError('Could not reset show poster.');
        }
      },
    });
    detailsActions.appendChild(editPosterControl);
  }
  info.appendChild(detailsActions);
  header.appendChild(info);

  content.appendChild(header);

  const seasonTabs = document.createElement('div');
  seasonTabs.classList.add('season-tabs');
  const list = document.createElement('div');
  list.classList.add('episode-list');
  const seasons = Array.from(new Set(
    group.episodes
      .map((episode) => episode?.episode?.season)
      .filter((season) => Number.isFinite(season))
  )).sort((a, b) => a - b);
  const selectedSeason = seasons.length ? seasons[0] : null;

  const renderSeasonEpisodes = (seasonNumber) => {
    list.innerHTML = '';
    const seasonEpisodes = group.episodes.filter((episode) => episode?.episode?.season === seasonNumber);

    for (const ep of seasonEpisodes) {
      const row = document.createElement('div');
      row.classList.add('episode-row');

      const thumbWrap = document.createElement('div');
      thumbWrap.classList.add('episode-thumb-wrap');

      const thumb = document.createElement('img');
      thumb.classList.add('episode-thumb');
      thumb.alt = `${formatEpisodeLabel(ep)} thumbnail`;
      thumb.loading = 'lazy';

      const thumbFallback = document.createElement('div');
      thumbFallback.classList.add('episode-thumb-fallback');
      thumbFallback.textContent = 'No image';

      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(thumbFallback);

      const left = document.createElement('div');
      left.classList.add('episode-left');

      const label = document.createElement('span');
      label.classList.add('episode-title');
      label.textContent = formatEpisodeLabel(ep);
      left.appendChild(label);

      const overview = document.createElement('p');
      overview.classList.add('episode-overview');
      overview.textContent = 'Episode details loading...';
      left.appendChild(overview);

      const episodeWatchPercent = getWatchPercent(ep);
      if (episodeWatchPercent > 0) {
        const progressWrap = document.createElement('div');
        progressWrap.classList.add('episode-progress-compact');

        const progressTrack = document.createElement('div');
        progressTrack.classList.add('episode-progress-track');

        const progressFill = document.createElement('div');
        progressFill.classList.add('episode-progress-fill');
        progressFill.style.width = `${episodeWatchPercent}%`;
        progressTrack.appendChild(progressFill);

        const progressLabel = document.createElement('span');
        progressLabel.classList.add('episode-progress-label');
        progressLabel.textContent = `${Math.round(episodeWatchPercent)}% watched`;

        progressWrap.appendChild(progressTrack);
        progressWrap.appendChild(progressLabel);
        left.appendChild(progressWrap);
      }

      const meta = document.createElement('span');
      meta.classList.add('episode-meta');

      const epRating = document.createElement('span');
      epRating.classList.add('rating-stars');
      meta.appendChild(epRating);

      const runtime = document.createElement('span');
      runtime.classList.add('episode-runtime');
      meta.appendChild(runtime);

      const playBtn = document.createElement('button');
      playBtn.classList.add('episode-play');
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', () => {
        showEpisodePlayer(ep, () => showShowDetails(group), { episodes: group.episodes });
      });

      row.appendChild(thumbWrap);
      row.appendChild(left);
      row.appendChild(meta);
      row.appendChild(playBtn);
      list.appendChild(row);

      if (group.data?.id && ep.episode?.season && ep.episode?.episode) {
        fetchEpisodeDetails(group.data.id, ep.episode.season, ep.episode.episode)
          .then((details) => {
            if (details?.vote_average) {
              setRatingStars(epRating, details.vote_average, true);
            }
            if (details?.runtime) {
              runtime.textContent = `${details.runtime} min`;
            }
            if (details?.overview) {
              overview.textContent = details.overview;
            } else {
              overview.textContent = 'No episode description available.';
            }
            if (details?.still_path) {
              thumb.src = `https://image.tmdb.org/t/p/w300${details.still_path}`;
              thumb.style.display = '';
              thumbFallback.style.display = 'none';
            } else {
              thumb.style.display = 'none';
              thumbFallback.style.display = '';
            }
          })
          .catch((err) => {
            console.error('Failed to load episode details:', err);
            overview.textContent = 'Could not load episode details.';
            thumb.style.display = 'none';
            thumbFallback.style.display = '';
          });
      } else {
        overview.textContent = 'No episode description available.';
        thumb.style.display = 'none';
        thumbFallback.style.display = '';
      }
    }
  };

  if (seasons.length) {
    for (const season of seasons) {
      const tab = document.createElement('button');
      tab.classList.add('season-tab');
      tab.textContent = `Season ${season}`;
      if (season === selectedSeason) {
        tab.classList.add('active');
      }
      tab.addEventListener('click', () => {
        seasonTabs.querySelectorAll('.season-tab').forEach((node) => node.classList.remove('active'));
        tab.classList.add('active');
        renderSeasonEpisodes(season);
      });
      seasonTabs.appendChild(tab);
    }
    content.appendChild(seasonTabs);
    renderSeasonEpisodes(selectedSeason);
  } else {
    const empty = document.createElement('div');
    empty.classList.add('settings-item');
    empty.textContent = 'No season metadata available.';
    list.appendChild(empty);
  }

  content.appendChild(list);

  if (group.data?.id) {
    try {
      const credits = await fetchShowCredits(group.data.id);
      const directorName =
        credits?.crew?.find((person) => person.job === 'Director')?.name
        || credits?.crew?.find((person) => person.department === 'Directing')?.name;
      fillPeopleChips(directorGroup.chips, directorName ? [directorName] : []);
      const castNames = credits?.cast?.slice(0, 8).map((person) => person.name).filter(Boolean) || [];
      fillPeopleChips(castGroup.chips, castNames);
    } catch (err) {
      console.error('Failed to load show credits:', err);
    }
  }
}

// show details page
async function showDetails(file) {
  const content = document.getElementById('content');
  content.innerHTML = '';
  const header = document.createElement('div');
  header.classList.add('details-header');

  // back button
  const backBtn = document.createElement('button');
  backBtn.textContent = '<- Back';
  backBtn.classList.add('back-btn');
  backBtn.addEventListener('click', () => {
    showHome(currentView);
  });
  content.appendChild(backBtn);

  // poster
  const poster = document.createElement('img');
  poster.src = getMoviePosterSrc(file);
  poster.classList.add('details-poster');
  header.appendChild(poster);

  // info
  const info = document.createElement('div');
  info.classList.add('details-info');

  const titleRow = document.createElement('div');
  titleRow.classList.add('title-row');

  const hTitle = document.createElement('h2');
  hTitle.textContent = file.data?.title || file.name;
  titleRow.appendChild(hTitle);

  const ratingStars = document.createElement('span');
  ratingStars.classList.add('rating-stars');
  const baseRating = file.data?.vote_average;
  if (baseRating) setRatingStars(ratingStars, baseRating, true);
  titleRow.appendChild(ratingStars);

  const year = document.createElement('p');
  const releaseDate = file.data?.release_date;
  year.textContent = releaseDate ? `Year: ${releaseDate.slice(0, 4)}` : '';

  const overview = document.createElement('p');
  overview.classList.add('details-overview');
  overview.textContent = file.data?.overview || 'No description available.';

  const separator = document.createElement('div');
  separator.classList.add('details-separator');

  const metaGrid = document.createElement('div');
  metaGrid.classList.add('details-meta-grid');

  const primaryCard = document.createElement('div');
  primaryCard.classList.add('details-card');

  const directorGroup = createPeopleGroup('Director');
  fillPeopleChips(directorGroup.chips, []);

  const runtime = document.createElement('p');
  runtime.textContent = 'Runtime: Unknown';

  const genres = document.createElement('p');
  genres.textContent = 'Genres: Unknown';

  primaryCard.appendChild(year);
  primaryCard.appendChild(directorGroup.wrap);
  primaryCard.appendChild(runtime);
  primaryCard.appendChild(genres);

  const castCard = document.createElement('div');
  castCard.classList.add('details-card');

  const castGroup = createPeopleGroup('Cast');
  fillPeopleChips(castGroup.chips, []);
  castCard.appendChild(castGroup.wrap);

  metaGrid.appendChild(primaryCard);
  metaGrid.appendChild(castCard);

  info.appendChild(titleRow);
  info.appendChild(overview);
  info.appendChild(separator);
  info.appendChild(metaGrid);

  const detailsActions = document.createElement('div');
  detailsActions.classList.add('details-actions');

  // play button
  const playBtn = document.createElement('button');
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => {
    showEpisodePlayer(file, () => showDetails(file));
  });
  detailsActions.appendChild(playBtn);

  const trailerBtn = document.createElement('button');
  trailerBtn.textContent = 'Watch Trailer';
  trailerBtn.classList.add('details-secondary-btn');
  trailerBtn.disabled = true;
  trailerBtn.addEventListener('click', async () => {
    if (!file.data?.id) return;
    try {
      if (!file.movieExtras?.videos) {
        file.movieExtras = file.movieExtras || {};
        file.movieExtras.videos = await fetchMovieVideos(file.data.id);
      }

      const trailer = pickBestMovieTrailer(file.movieExtras.videos);
      if (!trailer?.key) {
        showUiError('No trailer was found for this movie.');
        return;
      }

      const trailerUrl = buildYoutubeEmbedUrl(trailer.key);
      const watchUrl = buildYoutubeWatchUrl(trailer.key);
      const trailerTitle = `${file.data?.title || file.name} Trailer`;
      if (window.api?.openTrailerWindow) {
        const result = await window.api.openTrailerWindow(watchUrl, trailerTitle);
        if (!result?.ok) {
          showTrailerModal(trailerUrl, trailerTitle);
        }
      } else {
        showTrailerModal(trailerUrl, trailerTitle);
      }
    } catch (err) {
      console.error('Failed to load movie trailer:', err);
      showUiError('Could not load trailer right now.');
    }
  });
  detailsActions.appendChild(trailerBtn);
  if (currentAccountUser) {
    detailsActions.appendChild(createFavoriteButton(isMovieFavorite(file), async () => {
      const nextFavorite = !isMovieFavorite(file);
      const success = await setMovieFavorite(file, nextFavorite);
      if (!success) return;
      const refreshed = currentLibrary.find((entry) => entry.path === file.path) || file;
      showDetails(refreshed);
    }));
  }

  if (isCurrentUserAdmin()) {
    const hasPosterOverride = !!file.customPosterPath || !!file.customPosterTmdbPath;
    const editPosterControl = createPosterEditControl({
      hasPosterOverride,
      onAddCustomPoster: async () => {
        if (!window.api?.selectPosterFile || !window.api?.saveAccountPosterOverride) return;
        try {
          const selected = await window.api.selectPosterFile();
          if (!selected?.path) return;

          const result = await window.api.saveAccountPosterOverride({
            isShow: false,
            mediaPath: file.path,
            localPath: selected.path,
          });
          if (!result?.ok) {
            showUiError(result?.error || 'Could not update movie poster.');
            return;
          }

          applyPosterOverrideToCurrentLibrary({
            mediaPath: file.path,
            localPath: selected.path,
          });
          addLog(`Updated poster for movie: ${file.data?.title || file.name}`);

          const refreshed = currentLibrary.find((entry) => entry.path === file.path) || file;
          showDetails(refreshed);
        } catch (err) {
          console.error('Failed to update movie poster:', err);
          showUiError('Could not update movie poster.');
        }
      },
      onChooseTmdbPoster: async () => {
        const movieId = Number(file?.data?.id);
        if (!movieId) {
          showUiError('This movie does not have TMDB metadata yet.');
          return;
        }

        try {
          const images = await fetchMovieImages(movieId);
          const selectedPosterPath = await promptTmdbPosterChoice(
            images?.posters,
            'Choose TMDB Poster',
            file.data?.title || file.name
          );
          if (!selectedPosterPath) return;

          const result = await window.api.saveAccountPosterOverride({
            isShow: false,
            mediaPath: file.path,
            tmdbPath: selectedPosterPath,
          });
          if (!result?.ok) {
            showUiError(result?.error || 'Could not update movie poster.');
            return;
          }

          applyPosterOverrideToCurrentLibrary({
            mediaPath: file.path,
            tmdbPath: selectedPosterPath,
          });
          addLog(`Updated TMDB poster for movie: ${file.data?.title || file.name}`);

          const refreshed = currentLibrary.find((entry) => entry.path === file.path) || file;
          showDetails(refreshed);
        } catch (err) {
          console.error('Failed to choose TMDB poster for movie:', err);
          showUiError('Could not load TMDB posters for this movie.');
        }
      },
      onResetPoster: async () => {
        try {
          const result = await window.api.clearAccountPosterOverride?.({
            isShow: false,
            mediaPath: file.path,
          });
          if (result && !result.ok) {
            showUiError(result?.error || 'Could not reset movie poster.');
            return;
          }

          clearPosterOverrideFromCurrentLibrary({ mediaPath: file.path });
          addLog(`Reset poster for movie: ${file.data?.title || file.name}`);

          const refreshed = currentLibrary.find((entry) => entry.path === file.path) || file;
          showDetails(refreshed);
        } catch (err) {
          console.error('Failed to reset movie poster:', err);
          showUiError('Could not reset movie poster.');
        }
      },
    });
    detailsActions.appendChild(editPosterControl);
  }

  info.appendChild(detailsActions);
  header.appendChild(info);
  content.appendChild(header);

  // load extra movie details
  if (file.data?.id) {
    try {
      let details = null;
      let credits = null;

      if (file.movieExtras) {
        details = file.movieExtras.details;
        credits = file.movieExtras.credits;
      } else {
        [details, credits] = await Promise.all([
          fetchMovieDetails(file.data.id),
          fetchMovieCredits(file.data.id),
        ]);
        file.movieExtras = { details, credits };
      }

      const directorName = credits?.crew?.find((person) => person.job === 'Director')?.name;
      const runtimeValue = details?.runtime;
      const ratingValue = details?.vote_average ?? file.data?.vote_average;
      const genreValue = details?.genres?.map((genre) => genre.name).join(', ');
      const castNames = credits?.cast?.slice(0, 8).map((person) => person.name).filter(Boolean) || [];

      fillPeopleChips(directorGroup.chips, directorName ? [directorName] : []);
      runtime.textContent = runtimeValue ? `Runtime: ${runtimeValue} min` : 'Runtime: Unknown';
      genres.textContent = genreValue ? `Genres: ${genreValue}` : 'Genres: Unknown';
      fillPeopleChips(castGroup.chips, castNames);
      if (ratingValue) setRatingStars(ratingStars, ratingValue, true);

      const videos = file.movieExtras?.videos || await fetchMovieVideos(file.data.id);
      file.movieExtras.videos = videos;
      trailerBtn.disabled = !pickBestMovieTrailer(videos);
    } catch (err) {
      console.error('Failed to load movie details:', err);
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadLog();
  setSubtitleFontSize(getSubtitleFontSize());

  button = document.getElementById('importBtn');
  importDropdown = document.getElementById('importDropdown');
  importFromDeviceBtn = document.getElementById('importFromDeviceBtn');
  importFromCdBtn = document.getElementById('importFromCdBtn');
  moviesSection = document.getElementById('moviesSection');
  showsSection = document.getElementById('showsSection');
  homeLogo = document.getElementById('homeLogo');
  moviesHeading = document.getElementById('moviesHeading');
  showsHeading = document.getElementById('showsHeading');
  searchInput = document.getElementById('searchInput');
  genreFilterSelect = document.getElementById('genreFilter');
  sortFilterSelect = document.getElementById('sortFilter');
  sideMovies = document.getElementById('sideMovies');
  sideShows = document.getElementById('sideShows');
  sideSettings = document.getElementById('sideSettings');
  sideAccount = document.getElementById('sideAccount');
  sideHome = document.getElementById('sideHome');
  refreshAdminUi();

  if (!button || !moviesSection || !showsSection) {
    showUiError('UI failed to load: missing required elements.');
    return;
  }

  if (!window.api) {
    showUiError('Import is unavailable: preload bridge not found.');
    return;
  }

  window.addEventListener('beforeunload', () => {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    if (librarySaveTimer) {
      clearTimeout(librarySaveTimer);
      librarySaveTimer = null;
    }
    if (!isSharedLibraryMode()) {
      window.api.saveLibrary(currentLibrary);
    }
  });

  // on app start, render saved library
  const loaded = await window.api.getLibrary();
  currentLibrary = Array.isArray(loaded) ? loaded : [];
  await refreshAccountState({ mergeProgress: true, persistLibrary: true, syncProgress: true });
  showHome('all');

  if (homeLogo) {
    homeLogo.addEventListener('click', () => {
      showHome('all');
    });
  }

  if (sideMovies) {
    sideMovies.addEventListener('click', () => {
      showHome('movies');
    });
  }

  if (sideShows) {
    sideShows.addEventListener('click', () => {
      showHome('shows');
    });
  }

  if (sideHome) {
    sideHome.addEventListener('click', () => {
      showHome('all');
    });
  }

  if (sideSettings) {
    sideSettings.addEventListener('click', () => {
      showSettings();
    });
  }

  if (sideAccount) {
    sideAccount.addEventListener('click', () => {
      showAccountPage();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value || '';
      if (searchRenderTimer) {
        clearTimeout(searchRenderTimer);
      }
      searchRenderTimer = setTimeout(() => {
        searchRenderTimer = null;
        rerenderLibraryIfVisible();
      }, SEARCH_RENDER_DEBOUNCE_MS);
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchInput.value = '';
        searchQuery = '';
        if (searchRenderTimer) {
          clearTimeout(searchRenderTimer);
          searchRenderTimer = null;
        }
        rerenderLibraryIfVisible();
      }
    });
  }

  if (genreFilterSelect) {
    genreFilterSelect.value = selectedGenreFilter;
    genreFilterSelect.addEventListener('change', () => {
      selectedGenreFilter = genreFilterSelect.value || 'all';
      rerenderLibraryIfVisible();
    });
  }

  if (sortFilterSelect) {
    sortFilterSelect.value = selectedSort;
    sortFilterSelect.addEventListener('change', () => {
      selectedSort = sortFilterSelect.value || 'default';
      rerenderLibraryIfVisible();
    });
  }

  if (button) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleImportDropdown();
    });
  }

  if (importFromDeviceBtn) {
    importFromDeviceBtn.addEventListener('click', async () => {
      if (!ensureAdminAccess()) return;
      try {
        toggleImportDropdown(false);
        const selectMedia = window.api.selectMedia || window.api.selectFolder;
        if (!selectMedia) {
          showUiError('Import is unavailable: device import is not wired.');
          return;
        }

        const files = await selectMedia();
        let subtitleFiles = [];
        if (files.length && window.api.selectSubtitleFiles && await askYesNo('Import subtitles?', 'Yes', 'No')) {
          subtitleFiles = await window.api.selectSubtitleFiles();
        }

        await importFiles(files, 'device', subtitleFiles);
      } catch (err) {
        console.error('Device import failed:', err);
        showUiError('Import from device failed. Check the console for details.');
      }
    });
  }

  if (importFromCdBtn) {
    importFromCdBtn.addEventListener('click', async () => {
      if (!ensureAdminAccess()) return;
      try {
        toggleImportDropdown(false);
        if (!window.api.selectMediaFromCd) {
          showUiError('Import from CD is unavailable on this setup.');
          return;
        }

        const files = await window.api.selectMediaFromCd();
        await importFiles(files, 'CD');
      } catch (err) {
        console.error('CD import failed:', err);
        showUiError('Import from CD failed. Check the console for details.');
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (!importDropdown || !button) return;
    const clickedImport = button.contains(event.target);
    const clickedMenu = importDropdown.contains(event.target);
    if (!clickedImport && !clickedMenu) {
      toggleImportDropdown(false);
    }
  });
});
