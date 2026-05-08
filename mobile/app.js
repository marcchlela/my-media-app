const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const THEME_KEY = 'myMediaTheme';
const SUBTITLE_SIZE_KEY = 'myMediaSubtitleFontSize';
const WATCH_COMPLETE_THRESHOLD_PERCENT = 92;
const SEARCH_RENDER_DEBOUNCE_MS = 120;

const content = document.getElementById('content');
const statusText = document.getElementById('statusText');
const searchInput = document.getElementById('searchInput');
const mobileFiltersWrap = document.querySelector('.mobile-filters');
const mobileGenreFilter = document.getElementById('mobileGenreFilter');
const mobileSortFilter = document.getElementById('mobileSortFilter');
const refreshBtn = document.getElementById('refreshBtn');
const homeBtn = document.getElementById('homeBtn');
const mobileNav = document.getElementById('mobileNav');

const playerView = document.getElementById('playerView');
const playerStage = document.getElementById('playerStage');
const player = document.getElementById('player');
const playerTitle = document.getElementById('playerTitle');
const backBtn = document.getElementById('backBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const skipBackBtn = document.getElementById('skipBackBtn');
const skipForwardBtn = document.getElementById('skipForwardBtn');
const currentTimeLabel = document.getElementById('currentTimeLabel');
const durationLabel = document.getElementById('durationLabel');
const timelineRange = document.getElementById('timelineRange');
const muteBtn = document.getElementById('muteBtn');
const volumeRange = document.getElementById('volumeRange');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const subtitleControls = document.getElementById('subtitleControls');
const playerStatus = document.getElementById('playerStatus');
const PLAYER_CONTROLS_HIDE_MS = 2200;

let libraryItems = [];
let currentView = 'home';
let searchQuery = '';
let detailState = null;
let selectedGenreFilter = 'all';
let selectedSort = 'default';
let searchRenderTimer = null;
let currentUser = null;
let currentPlayerItem = null;
let playerControlsHideTimer = null;
let playerClickToggleTimer = null;

const movieDetailCache = new Map();
const showDetailCache = new Map();
const episodeDetailCache = new Map();
const allowedSubtitleSizes = new Set(['16px', '20px', '24px']);
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
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
  [10759, 'Action & Adventure'],
  [10765, 'Sci-Fi & Fantasy'],
]);

async function apiRequest(path, { method = 'GET', body = null } = {}) {
  const options = {
    method,
    headers: {},
  };

  if (body !== null) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function apiGet(path, query = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return apiRequest(url.toString());
}

function setTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = value;
  localStorage.setItem(THEME_KEY, value);
}

function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || 'dark');
}

function getSubtitleFontSize() {
  const saved = localStorage.getItem(SUBTITLE_SIZE_KEY) || '20px';
  return allowedSubtitleSizes.has(saved) ? saved : '20px';
}

function setSubtitleFontSize(size) {
  const next = allowedSubtitleSizes.has(size) ? size : '20px';
  document.documentElement.style.setProperty('--subtitle-font-size', next);
  localStorage.setItem(SUBTITLE_SIZE_KEY, next);
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

function clearPlayerControlsHideTimer() {
  if (playerControlsHideTimer) {
    clearTimeout(playerControlsHideTimer);
    playerControlsHideTimer = null;
  }
}

function showPlayerControls(scheduleHide = true) {
  playerStage.classList.add('controls-visible');
  clearPlayerControlsHideTimer();
  if (!scheduleHide || player.paused || player.ended || !player.currentSrc) return;
  playerControlsHideTimer = setTimeout(() => {
    playerStage.classList.remove('controls-visible');
  }, PLAYER_CONTROLS_HIDE_MS);
}

function handleGlobalPlayerPointerMove(event) {
  if (playerView.classList.contains('hidden') || !player.currentSrc) return;
  showPlayerControls(true);
}

function syncPlayerControls() {
  const hasDuration = Number.isFinite(player.duration) && player.duration > 0;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  currentTimeLabel.textContent = formatPlayerTime(currentTime);
  durationLabel.textContent = formatPlayerTime(hasDuration ? player.duration : 0);
  timelineRange.disabled = !hasDuration;
  timelineRange.value = hasDuration ? String(Math.round((currentTime / player.duration) * 1000)) : '0';

  const isPaused = player.paused || player.ended || !player.currentSrc;
  setPlayerButtonIcon(playPauseBtn, isPaused ? 'play' : 'pause', isPaused ? 'Play' : 'Pause');

  const effectiveVolume = player.muted ? 0 : player.volume;
  volumeRange.value = String(Math.round((Number.isFinite(effectiveVolume) ? effectiveVolume : 1) * 100));
  setPlayerButtonIcon(muteBtn, effectiveVolume <= 0 ? 'mute' : 'volume', effectiveVolume <= 0 ? 'Unmute' : 'Mute');

  const fullscreenActive = !!(document.fullscreenElement || document.webkitFullscreenElement);
  setPlayerButtonIcon(fullscreenBtn, fullscreenActive ? 'fullscreenExit' : 'fullscreen', fullscreenActive ? 'Exit Fullscreen' : 'Fullscreen');
}

function togglePlayerPlayback() {
  if (!player.currentSrc) return;
  if (player.paused || player.ended) {
    player.play().catch(() => {
      setPlayerStatus('Press Play to start.', false);
    });
    return;
  }
  player.pause();
}

function handleStagePointerActivity() {
  if (!player.currentSrc) return;
  showPlayerControls(true);
}

function handleStageSingleClick(event) {
  if (event.target?.closest?.('.player-controls')) return;
  if (playerClickToggleTimer) {
    clearTimeout(playerClickToggleTimer);
    playerClickToggleTimer = null;
  }
  playerClickToggleTimer = setTimeout(() => {
    playerClickToggleTimer = null;
    togglePlayerPlayback();
    showPlayerControls(true);
  }, 220);
}

function setPlayerStatus(message, isError = false) {
  if (!playerStatus) return;
  playerStatus.textContent = message || '';
  playerStatus.classList.toggle('error', !!isError);
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function formatEpisode(item) {
  if (!item?.episode?.season || !item?.episode?.episode) return '';
  const s = String(item.episode.season).padStart(2, '0');
  const e = String(item.episode.episode).padStart(2, '0');
  return `S${s}E${e}`;
}

function extractEpisodeTitle(name) {
  const base = String(name || '').replace(/\.[^/.]+$/, '');
  const match = base.match(/S\d{1,2}E\d{1,2}/i);
  if (!match || match.index === undefined) return '';
  const after = base.slice(match.index + match[0].length);
  return after.replace(/^[\s._-]+/, '').replace(/[\s._-]+/g, ' ').trim();
}

function formatEpisodeLabel(item) {
  const code = formatEpisode(item);
  const title = extractEpisodeTitle(item?.name);
  if (!code) return item?.title || item?.name || 'Episode';
  return title ? `${code}: ${title}` : code;
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
    mediaName: item?.title || item?.name || 'Movie',
    tmdbId: item?.tmdbId ?? null,
  };
}

function buildFavoritePayloadForShow(group) {
  return {
    isShow: true,
    showKey: group?.key || '',
    mediaName: group?.name || 'TV Show',
    tmdbId: group?.tmdbId ?? null,
  };
}

async function setFavoriteState(payload, isFavorite) {
  await apiRequest('/api/account/favorite', {
    method: isFavorite ? 'POST' : 'DELETE',
    body: payload,
  });
}

async function setMovieFavorite(item, isFavorite) {
  if (!currentUser) return false;
  await setFavoriteState(buildFavoritePayloadForMovie(item), isFavorite);
  libraryItems = libraryItems.map((entry) => (
    entry.path === item.path
      ? { ...entry, isFavorite }
      : entry
  ));
  return true;
}

async function setShowFavorite(group, isFavorite) {
  if (!currentUser) return false;
  await setFavoriteState(buildFavoritePayloadForShow(group), isFavorite);
  libraryItems = libraryItems.map((entry) => {
    if (!entry.isShow) return entry;
    const entryKey = entry.showKey || (Number.isFinite(entry.tmdbId) ? `tmdb:${entry.tmdbId}` : normalize(entry.showName || entry.title || entry.name));
    return entryKey === group.key ? { ...entry, isFavorite } : entry;
  });
  return true;
}

function createFavoriteButton(isFavorite, onToggle) {
  const button = document.createElement('button');
  button.className = `ghost-btn favorite-toggle${isFavorite ? ' active' : ''}`;
  button.type = 'button';
  button.innerHTML = `<span class="favorite-toggle-icon">${isFavorite ? '&#9829;' : '&#9825;'}</span>`;
  button.setAttribute('aria-label', isFavorite ? 'Favorited' : 'Favorite');
  button.title = isFavorite ? 'Favorited' : 'Favorite';
  button.addEventListener('click', onToggle);
  return button;
}

function createRatingStars(ratingOutOf10, withNumber = true) {
  if (!Number.isFinite(ratingOutOf10)) return null;

  const starsOutOfFive = Math.max(0, Math.min(5, ratingOutOf10 / 2));
  const rounded = Math.round(starsOutOfFive * 2) / 2;
  const fullCount = Math.floor(rounded);
  const halfCount = rounded % 1 !== 0 ? 1 : 0;
  const emptyCount = 5 - fullCount - halfCount;

  const container = document.createElement('span');
  container.className = 'rating-stars';

  for (let i = 0; i < fullCount; i += 1) {
    const star = document.createElement('span');
    star.className = 'star full';
    star.textContent = '\u2605';
    container.appendChild(star);
  }

  if (halfCount) {
    const star = document.createElement('span');
    star.className = 'star half';
    star.textContent = '\u2605';
    container.appendChild(star);
  }

  for (let i = 0; i < emptyCount; i += 1) {
    const star = document.createElement('span');
    star.className = 'star empty';
    star.textContent = '\u2605';
    container.appendChild(star);
  }

  if (withNumber) {
    const number = document.createElement('span');
    number.className = 'rating-number';
    number.textContent = `(${starsOutOfFive.toFixed(1)})`;
    container.appendChild(number);
  }

  return container;
}

function createPeopleGroup(label, names = [], fallback = 'Unknown') {
  const wrap = document.createElement('div');
  wrap.className = 'details-people-group';

  const labelNode = document.createElement('p');
  labelNode.className = 'detail-line details-people-label';
  labelNode.textContent = `${label}:`;

  const chips = document.createElement('div');
  chips.className = 'details-people-chips';

  const values = Array.isArray(names)
    ? names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const finalValues = values.length ? values : [fallback];

  finalValues.forEach((value) => {
    const chip = document.createElement('span');
    chip.className = 'details-person-chip';
    if (value === fallback) {
      chip.classList.add('is-fallback');
    }
    chip.textContent = value;
    chips.appendChild(chip);
  });

  wrap.appendChild(labelNode);
  wrap.appendChild(chips);
  return wrap;
}

function getMovieItems() {
  return libraryItems.filter((item) => !item.isShow);
}

function getShowGroups() {
  const map = new Map();
  for (const item of libraryItems) {
    if (!item.isShow) continue;
    const keyBase = item.showName || item.title || item.name;
    const key = item.showKey || (Number.isFinite(item.tmdbId) ? `tmdb:${item.tmdbId}` : normalize(keyBase));
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        tmdbId: Number.isFinite(item.tmdbId) ? item.tmdbId : null,
        name: item.showName || item.title || 'TV Show',
        posterPath: item.posterPath || null,
        backdropPath: item.backdropPath || null,
        releaseDate: item.releaseDate || null,
        rating: Number.isFinite(item.rating) ? item.rating : null,
        runtime: Number.isFinite(item.runtime) ? item.runtime : null,
        genreNames: [],
        episodes: [],
      });
    }

    const group = map.get(key);
    if (!Number.isFinite(group.tmdbId) && Number.isFinite(item.tmdbId)) group.tmdbId = item.tmdbId;
    if (!group.posterPath && item.posterPath) group.posterPath = item.posterPath;
    if (!group.backdropPath && item.backdropPath) group.backdropPath = item.backdropPath;
    if (!group.releaseDate && item.releaseDate) group.releaseDate = item.releaseDate;
    if (!Number.isFinite(group.rating) && Number.isFinite(item.rating)) group.rating = item.rating;
    if (!Number.isFinite(group.runtime) && Number.isFinite(item.runtime)) group.runtime = item.runtime;
    getGenresFromItem(item).forEach((genre) => {
      if (!group.genreNames.includes(genre)) group.genreNames.push(genre);
    });
    group.episodes.push(item);
  }

  const groups = Array.from(map.values());
  for (const group of groups) {
    group.episodes.sort((a, b) => {
      const sa = a.episode?.season || 0;
      const sb = b.episode?.season || 0;
      if (sa !== sb) return sa - sb;
      const ea = a.episode?.episode || 0;
      const eb = b.episode?.episode || 0;
      return ea - eb;
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

function getGenresFromItem(item) {
  if (!item) return [];
  if (Array.isArray(item.genreNames) && item.genreNames.length) {
    return item.genreNames.filter(Boolean);
  }
  if (Array.isArray(item.genreIds)) {
    return item.genreIds.map((id) => GENRE_ID_TO_NAME.get(id)).filter(Boolean);
  }
  return [];
}

function getGenresFromGroup(group) {
  if (!group) return [];
  if (Array.isArray(group.genreNames) && group.genreNames.length) {
    return group.genreNames.filter(Boolean);
  }
  return [];
}

function compareNullable(a, b, direction = 'asc') {
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
      sorted.sort((a, b) => compareNullable(Date.parse(a.releaseDate || ''), Date.parse(b.releaseDate || ''), 'desc'));
      break;
    case 'release_asc':
      sorted.sort((a, b) => compareNullable(Date.parse(a.releaseDate || ''), Date.parse(b.releaseDate || ''), 'asc'));
      break;
    case 'rating_desc':
      sorted.sort((a, b) => compareNullable(a.rating, b.rating, 'desc'));
      break;
    case 'rating_asc':
      sorted.sort((a, b) => compareNullable(a.rating, b.rating, 'asc'));
      break;
    case 'runtime_asc':
      sorted.sort((a, b) => compareNullable(a.runtime, b.runtime, 'asc'));
      break;
    case 'runtime_desc':
      sorted.sort((a, b) => compareNullable(a.runtime, b.runtime, 'desc'));
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
      sorted.sort((a, b) => compareNullable(Date.parse(a.releaseDate || ''), Date.parse(b.releaseDate || ''), 'desc'));
      break;
    case 'release_asc':
      sorted.sort((a, b) => compareNullable(Date.parse(a.releaseDate || ''), Date.parse(b.releaseDate || ''), 'asc'));
      break;
    case 'rating_desc':
      sorted.sort((a, b) => compareNullable(a.rating, b.rating, 'desc'));
      break;
    case 'rating_asc':
      sorted.sort((a, b) => compareNullable(a.rating, b.rating, 'asc'));
      break;
    case 'runtime_asc':
      sorted.sort((a, b) => compareNullable(a.runtime, b.runtime, 'asc'));
      break;
    case 'runtime_desc':
      sorted.sort((a, b) => compareNullable(a.runtime, b.runtime, 'desc'));
      break;
    default:
      break;
  }
  return sorted;
}

function refreshMobileGenreOptions() {
  if (!mobileGenreFilter) return;
  const current = selectedGenreFilter;
  const genres = new Set();
  libraryItems.forEach((item) => getGenresFromItem(item).forEach((genre) => genres.add(genre)));

  const values = ['all', ...Array.from(genres).sort((a, b) => a.localeCompare(b))];
  mobileGenreFilter.innerHTML = '';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'all' ? 'All Genres' : value;
    mobileGenreFilter.appendChild(option);
  });

  selectedGenreFilter = values.includes(current) ? current : 'all';
  mobileGenreFilter.value = selectedGenreFilter;
}

function matchesSearch(strings) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return strings.some((value) => String(value || '').toLowerCase().includes(q));
}

function createCard({ title, subtitle, poster, onClick, hasCc = false }) {
  const card = document.createElement('article');
  card.className = 'card';
  card.addEventListener('click', onClick);

  const posterWrap = document.createElement('div');
  posterWrap.className = 'card-poster-wrap';

  const img = document.createElement('img');
  img.className = 'poster';
  img.loading = 'lazy';
  img.alt = title || 'Poster';
  img.src = poster || '';

  if (hasCc) {
    const badge = document.createElement('span');
    badge.className = 'cc-badge';
    badge.textContent = 'CC';
    posterWrap.appendChild(badge);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';

  const titleNode = document.createElement('p');
  titleNode.className = 'title';
  titleNode.textContent = title || 'Untitled';

  const subNode = document.createElement('p');
  subNode.className = 'sub';
  subNode.textContent = subtitle || '';

  meta.appendChild(titleNode);
  meta.appendChild(subNode);
  posterWrap.appendChild(img);
  card.appendChild(posterWrap);
  card.appendChild(meta);
  return card;
}

function buildBackdropUrl(backdropPath, size = 780) {
  return backdropPath ? `https://image.tmdb.org/t/p/w${size}${backdropPath}` : '';
}

function getContinueImageSrc(entry) {
  return entry.backdropPath || entry.posterPath || '';
}

function createContinueCard(entry) {
  const card = document.createElement('article');
  card.className = 'card continue-card continue-card-landscape';
  card.addEventListener('click', () => {
    if (entry.type === 'movie') {
      openMovieDetails(entry.item);
      return;
    }
    openShowDetails(entry.group);
  });

  const media = document.createElement('div');
  media.className = 'continue-media';

  const img = document.createElement('img');
  img.className = 'continue-image';
  img.loading = 'lazy';
  img.alt = entry.title || 'Continue watching';
  img.src = getContinueImageSrc(entry);
  media.appendChild(img);

  if (entry.hasCc) {
    const badge = document.createElement('span');
    badge.className = 'cc-badge';
    badge.textContent = 'CC';
    media.appendChild(badge);
  }

  const overlay = document.createElement('div');
  overlay.className = 'continue-overlay';

  const titleNode = document.createElement('p');
  titleNode.className = 'continue-title';
  titleNode.textContent = entry.title || 'Untitled';
  overlay.appendChild(titleNode);

  if (entry.subtitle) {
    const subtitleNode = document.createElement('p');
    subtitleNode.className = 'continue-subtitle';
    subtitleNode.textContent = entry.subtitle;
    overlay.appendChild(subtitleNode);
  }

  overlay.appendChild(createContinueProgress(entry.percent));
  media.appendChild(overlay);
  card.appendChild(media);
  return card;
}

function createGrid() {
  const grid = document.createElement('section');
  grid.className = 'grid';
  return grid;
}

function getWatchPercent(item) {
  const percent = Number(item?.watchProgress?.percent);
  if (!Number.isFinite(percent)) return 0;
  const safe = Math.max(0, Math.min(100, percent));
  if (safe >= WATCH_COMPLETE_THRESHOLD_PERCENT) return 100;
  return safe;
}

function getShowWatchPercent(group) {
  if (!group?.episodes?.length) return 0;
  const total = group.episodes.reduce((sum, episode) => sum + getWatchPercent(episode), 0);
  return total / group.episodes.length;
}

function getShowContinueState(group) {
  if (!group?.episodes?.length) return null;

  const episodeStates = group.episodes.map((episode) => ({
    episode,
    percent: getWatchPercent(episode),
    updatedAt: Number(episode?.watchProgress?.updatedAt) || 0,
  }));

  const inProgress = episodeStates
    .filter((entry) => entry.percent > 0 && entry.percent < 100 && entry.updatedAt > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (inProgress.length) {
    const latest = inProgress[0];
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

function buildWatchProgress(currentTime, duration, forceComplete = false) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const safeTime = Math.max(0, Math.min(Number(currentTime) || 0, duration));
  let percent = Math.max(0, Math.min(100, (safeTime / duration) * 100));
  if (forceComplete || safeTime >= Math.max(duration - 2, 0) || percent >= WATCH_COMPLETE_THRESHOLD_PERCENT) {
    percent = 100;
  }
  return {
    position: safeTime,
    duration,
    percent,
    updatedAt: Date.now(),
  };
}

function stripLibraryWatchProgress(items) {
  return Array.isArray(items)
    ? items.map((item) => ({ ...item, watchProgress: null }))
    : [];
}

function applyLocalWatchProgress(mediaPath, watchProgress) {
  if (!mediaPath || !watchProgress) return;
  libraryItems = libraryItems.map((item) => (
    item.path === mediaPath
      ? { ...item, watchProgress }
      : item
  ));
  if (!detailState) {
    scheduleRenderCurrentView();
  }
}

async function saveWatchProgress(item, currentTime, duration, forceComplete = false) {
  if (!item?.path) return;
  if (!currentUser) return;
  const watchProgress = buildWatchProgress(currentTime, duration, forceComplete);
  if (!watchProgress) return;

  applyLocalWatchProgress(item.path, watchProgress);
  try {
    await apiRequest('/api/account/progress', {
      method: 'POST',
      body: {
        mediaPath: item.path,
        mediaName: item.name || item.title || '',
        isShow: !!item.isShow,
        ...watchProgress,
      },
    });
  } catch (err) {
    // Keep playback local even if sync fails.
  }
}

function createContinueProgress(percent) {
  const wrap = document.createElement('div');
  wrap.className = 'card-progress';

  const fill = document.createElement('div');
  fill.className = 'card-progress-fill';
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  wrap.appendChild(fill);

  return wrap;
}

function getContinueWatchingEntries() {
  if (!currentUser) return [];

  const entries = [];
  for (const item of libraryItems) {
    if (item.isShow) continue;
    const percent = getWatchPercent(item);
    const updatedAt = Number(item?.watchProgress?.updatedAt) || 0;
    if (percent <= 0 || percent >= 100 || !updatedAt) continue;
    entries.push({
      type: 'movie',
      item,
      title: item.title || item.name || 'Movie',
      subtitle: 'Movie',
      percent,
      updatedAt,
      posterPath: item.posterPath ? `${TMDB_IMG}${item.posterPath}` : '',
      backdropPath: item.backdropPath ? buildBackdropUrl(item.backdropPath, 780) : '',
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
    });
  }

  for (const group of getShowGroups()) {
    const continueState = getShowContinueState(group);
    if (!continueState) continue;

    entries.push({
      type: 'show',
      group,
      item: continueState.episode,
      title: group.name,
      subtitle: continueState.subtitle,
      percent: continueState.percent,
      updatedAt: continueState.updatedAt,
      posterPath: group.posterPath ? `${TMDB_IMG}${group.posterPath}` : '',
      backdropPath: group.backdropPath ? buildBackdropUrl(group.backdropPath, 780) : '',
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
    });
  }

  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderContinueWatching() {
  if (!currentUser) return;
  const entries = getContinueWatchingEntries();
  if (!entries.length) return;

  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'Continue Watching';
  content.appendChild(title);

  const row = document.createElement('section');
  row.className = 'continue-row';

  entries.forEach((entry) => {
    row.appendChild(createContinueCard(entry));
  });

  content.appendChild(row);
}

function renderHome() {
  content.innerHTML = '';

  let movies = getMovieItems();
  let shows = getShowGroups();

  movies = movies.filter((item) => matchesSearch([item.title, item.name]));
  shows = shows.filter((group) => matchesSearch([group.name]));

  if (selectedGenreFilter !== 'all') {
    movies = movies.filter((item) => getGenresFromItem(item).includes(selectedGenreFilter));
    shows = shows.filter((group) => getGenresFromGroup(group).includes(selectedGenreFilter));
  }

  movies = applySortToMovies(movies);
  shows = applySortToShows(shows);

  renderContinueWatching();

  const movieTitle = document.createElement('h2');
  movieTitle.className = 'section-title';
  movieTitle.textContent = 'Movies';
  content.appendChild(movieTitle);

  const movieGrid = createGrid();
  movies.forEach((item) => {
    const card = createCard({
      title: item.title || item.name,
      subtitle: 'Movie',
      poster: item.posterPath ? `${TMDB_IMG}${item.posterPath}` : '',
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      onClick: () => openMovieDetails(item),
    });
    const percent = getWatchPercent(item);
    if (percent > 0 && percent < 100) {
      card.appendChild(createContinueProgress(percent));
    }
    movieGrid.appendChild(card);
  });
  content.appendChild(movieGrid);

  const showTitle = document.createElement('h2');
  showTitle.className = 'section-title';
  showTitle.textContent = 'TV Shows';
  content.appendChild(showTitle);

  const showGrid = createGrid();
  shows.forEach((group) => {
    showGrid.appendChild(createCard({
      title: group.name,
      subtitle: `${group.episodes.length} episode(s)`,
      poster: group.posterPath ? `${TMDB_IMG}${group.posterPath}` : '',
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      onClick: () => openShowDetails(group),
    }));
  });
  content.appendChild(showGrid);

  statusText.textContent = `${movies.length} movie(s), ${shows.length} show(s)`;
}

function renderMovies() {
  content.innerHTML = '';
  let movies = getMovieItems();
  movies = movies.filter((item) => matchesSearch([item.title, item.name]));
  if (selectedGenreFilter !== 'all') {
    movies = movies.filter((item) => getGenresFromItem(item).includes(selectedGenreFilter));
  }
  movies = applySortToMovies(movies);
  const grid = createGrid();

  movies.forEach((item) => {
    const card = createCard({
      title: item.title || item.name,
      subtitle: 'Movie',
      poster: item.posterPath ? `${TMDB_IMG}${item.posterPath}` : '',
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      onClick: () => openMovieDetails(item),
    });
    const percent = getWatchPercent(item);
    if (percent > 0 && percent < 100) {
      card.appendChild(createContinueProgress(percent));
    }
    grid.appendChild(card);
  });

  content.appendChild(grid);
  statusText.textContent = `${movies.length} movie(s)`;
}

function renderShows() {
  content.innerHTML = '';
  let shows = getShowGroups();
  shows = shows.filter((group) => matchesSearch([group.name]));
  if (selectedGenreFilter !== 'all') {
    shows = shows.filter((group) => getGenresFromGroup(group).includes(selectedGenreFilter));
  }
  shows = applySortToShows(shows);
  const grid = createGrid();

  shows.forEach((group) => {
    grid.appendChild(createCard({
      title: group.name,
      subtitle: `${group.episodes.length} episode(s)`,
      poster: group.posterPath ? `${TMDB_IMG}${group.posterPath}` : '',
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      onClick: () => openShowDetails(group),
    }));
  });

  content.appendChild(grid);
  statusText.textContent = `${shows.length} show(s)`;
}

function buildThemeToggle() {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const label = document.createElement('span');
  label.textContent = 'Theme';

  const group = document.createElement('div');
  group.className = 'toggle-group';

  const lightLabel = document.createElement('span');
  lightLabel.className = 'toggle-label';
  lightLabel.textContent = 'Light';

  const toggle = document.createElement('label');
  toggle.className = 'toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = document.body.dataset.theme === 'dark';

  const slider = document.createElement('span');
  slider.className = 'slider';

  toggle.appendChild(input);
  toggle.appendChild(slider);

  const darkLabel = document.createElement('span');
  darkLabel.className = 'toggle-label';
  darkLabel.textContent = 'Dark';

  input.addEventListener('change', () => {
    setTheme(input.checked ? 'dark' : 'light');
  });

  group.appendChild(lightLabel);
  group.appendChild(toggle);
  group.appendChild(darkLabel);
  row.appendChild(label);
  row.appendChild(group);
  return row;
}

function getUserDisplayName() {
  if (!currentUser) return '';
  return currentUser.fullName || `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email || '';
}

async function handleAccountLogout() {
  try {
    await apiRequest('/api/account/logout', { method: 'POST' });
  } catch (err) {
    // Even if logout request fails, refresh local state afterward.
  }
  await refreshSessionAndLibrary({ goHome: false });
  currentView = 'account';
  renderCurrentView();
}

function renderAccount() {
  content.innerHTML = '';
  statusText.textContent = currentUser ? 'Your account' : 'Sign in to sync progress';

  const card = document.createElement('div');
  card.className = 'settings-card account-card';
  card.appendChild(buildThemeToggle());

  const divider = document.createElement('div');
  divider.className = 'account-divider';
  card.appendChild(divider);

  if (!currentUser) {
    const heading = document.createElement('h2');
    heading.className = 'account-title';
    heading.textContent = 'Account';

    const copy = document.createElement('p');
    copy.className = 'account-copy';
    copy.textContent = 'Create an optional account to keep your continue-watching progress synced across devices.';

    const actions = document.createElement('div');
    actions.className = 'account-actions';

    const loginBtn = document.createElement('button');
    loginBtn.className = 'ghost-btn';
    loginBtn.textContent = 'Log In';
    loginBtn.addEventListener('click', () => openAuthModal('login'));

    const signupBtn = document.createElement('button');
    signupBtn.className = 'solid-btn';
    signupBtn.textContent = 'Sign Up';
    signupBtn.addEventListener('click', () => openAuthModal('signup'));

    actions.appendChild(loginBtn);
    actions.appendChild(signupBtn);
    card.appendChild(heading);
    card.appendChild(copy);
    card.appendChild(actions);
  } else {
    const heading = document.createElement('h2');
    heading.className = 'account-title';
    heading.textContent = getUserDisplayName();

    const email = document.createElement('p');
    email.className = 'account-copy';
    email.textContent = currentUser.email || '';

    const copy = document.createElement('p');
    copy.className = 'account-copy';
    copy.textContent = 'Progress sync is active for this account.';

    const actions = document.createElement('div');
    actions.className = 'account-actions';

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'ghost-btn';
    logoutBtn.textContent = 'Log Out';
    logoutBtn.addEventListener('click', handleAccountLogout);

    actions.appendChild(logoutBtn);
    card.appendChild(heading);
    card.appendChild(email);
    card.appendChild(copy);
    card.appendChild(actions);
  }

  content.appendChild(card);

  if (!currentUser) {
    return;
  }

  const favoriteMovies = getMovieItems().filter((item) => isMovieFavorite(item));
  const favoriteShows = getShowGroups().filter((group) => isShowFavorite(group));

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Favorites';
  content.appendChild(heading);

  if (!favoriteMovies.length && !favoriteShows.length) {
    const empty = document.createElement('p');
    empty.className = 'account-copy';
    empty.textContent = 'No favorites yet. Tap the heart on a movie or show to save it here.';
    content.appendChild(empty);
    return;
  }

  const grid = createGrid();
  favoriteMovies.forEach((item) => {
    grid.appendChild(createCard({
      title: item.title || item.name,
      subtitle: 'Movie',
      poster: item.posterPath ? `${TMDB_IMG}${item.posterPath}` : '',
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      onClick: () => openMovieDetails(item),
    }));
  });

  favoriteShows.forEach((group) => {
    grid.appendChild(createCard({
      title: group.name,
      subtitle: `${group.episodes.length} episode(s)`,
      poster: group.posterPath ? `${TMDB_IMG}${group.posterPath}` : '',
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      onClick: () => openShowDetails(group),
    }));
  });

  content.appendChild(grid);
}

function createField(name, labelText, type = 'text') {
  const wrap = document.createElement('label');
  wrap.className = 'auth-field';

  const label = document.createElement('span');
  label.className = 'auth-label';
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'auth-input';
  input.name = name;
  input.type = type;
  input.autocomplete = type === 'password' ? 'current-password' : 'off';

  const error = document.createElement('span');
  error.className = 'auth-error';

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(error);
  return { wrap, input, error };
}

function setFieldState(fieldRefs, fieldName, message = '') {
  const field = fieldRefs[fieldName];
  if (!field) return;
  field.input.classList.toggle('has-error', !!message);
  field.error.textContent = message || '';
}

function clearFieldStates(fieldRefs) {
  Object.keys(fieldRefs).forEach((key) => setFieldState(fieldRefs, key, ''));
}

function openAuthModal(mode) {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';

  const modal = document.createElement('div');
  modal.className = 'auth-modal';

  const title = document.createElement('h3');
  title.className = 'auth-title';
  title.textContent = mode === 'signup' ? 'Create account' : 'Log in';

  const message = document.createElement('p');
  message.className = 'auth-message';
  message.textContent = mode === 'signup'
    ? 'Create an account to sync your progress.'
    : 'Log in to continue where you left off.';

  const form = document.createElement('form');
  form.className = 'auth-form';

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
    const field = createField(name, labelText, type || 'text');
    fieldRefs[name] = field;
    form.appendChild(field.wrap);
  });

  const submitError = document.createElement('p');
  submitError.className = 'auth-submit-error';

  const actions = document.createElement('div');
  actions.className = 'auth-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ghost-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'solid-btn';
  submitBtn.textContent = mode === 'signup' ? 'Sign Up' : 'Log In';

  const close = () => {
    overlay.remove();
  };

  cancelBtn.addEventListener('click', close);
  submitBtn.addEventListener('click', () => {
    form.requestSubmit();
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldStates(fieldRefs);
    submitError.textContent = '';

    const payload = {};
    Object.entries(fieldRefs).forEach(([name, field]) => {
      payload[name] = field.input.value.trim();
    });

    let hasClientErrors = false;
    fieldDefs.forEach(([name, labelText]) => {
      if (!payload[name]) {
        setFieldState(fieldRefs, name, `${labelText} is required.`);
        hasClientErrors = true;
      }
    });

    if (mode === 'signup' && payload.password && payload.confirmPassword && payload.password !== payload.confirmPassword) {
      setFieldState(fieldRefs, 'confirmPassword', 'Passwords do not match.');
      hasClientErrors = true;
    }

    if (hasClientErrors) return;

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitError.textContent = 'Verifying...';

    try {
      const endpoint = mode === 'signup' ? '/api/account/signup' : '/api/account/login';
      await apiRequest(endpoint, {
        method: 'POST',
        body: payload,
      });
      close();
      await refreshSessionAndLibrary({ goHome: true });
    } catch (err) {
      const payloadData = err.payload || {};
      if (payloadData.fieldErrors) {
        Object.entries(payloadData.fieldErrors).forEach(([name, text]) => {
          setFieldState(fieldRefs, name, text);
        });
      }
      submitError.textContent = payloadData.authError || payloadData.error || 'Unable to verify your account.';
    } finally {
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      if (submitError.textContent === 'Verifying...') {
        submitError.textContent = '';
      }
    }
  });

  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(form);
  modal.appendChild(submitError);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const firstField = fieldDefs[0]?.[0];
  if (firstField && fieldRefs[firstField]) {
    fieldRefs[firstField].input.focus();
  }
}

async function loadSessionUser() {
  try {
    const result = await apiRequest('/api/account/me');
    currentUser = result?.authenticated ? result.user : null;
  } catch (err) {
    currentUser = null;
  }
}

async function loadLibrary({ render = true } = {}) {
  statusText.textContent = 'Loading library...';
  try {
    const res = await fetch('/library');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    libraryItems = await res.json();
    if (!currentUser) {
      libraryItems = stripLibraryWatchProgress(libraryItems);
    }
    refreshMobileGenreOptions();
    if (render) {
      renderCurrentView();
    }
  } catch (err) {
    statusText.textContent = 'Could not load library from server.';
    content.innerHTML = '';
  }
}

async function refreshSessionAndLibrary({ goHome = false } = {}) {
  await loadSessionUser();
  await loadLibrary({ render: false });
  if (goHome) {
    currentView = 'home';
    detailState = null;
  }
  renderCurrentView();
}

async function fetchMovieDetails(item) {
  const key = normalize(item.title || item.name);
  if (movieDetailCache.has(key)) return movieDetailCache.get(key);

  const searchData = await apiGet('/api/tmdb/movie/search', { q: item.title || item.name || '' });
  const movie = searchData?.results?.[0];
  if (!movie?.id) return null;

  const [detailsRes, creditsRes] = await Promise.all([
    apiGet(`/api/tmdb/movie/${movie.id}`),
    apiGet(`/api/tmdb/movie/${movie.id}/credits`),
  ]);

  const result = { details: detailsRes, credits: creditsRes };
  movieDetailCache.set(key, result);
  return result;
}

async function fetchMovieVideos(item) {
  const searchData = await apiGet('/api/tmdb/movie/search', { q: item.title || item.name || '' });
  const movie = searchData?.results?.[0];
  if (!movie?.id) return null;
  return apiGet(`/api/tmdb/movie/${movie.id}/videos`);
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

function buildYoutubeEmbedUrl(videoKey) {
  const origin = encodeURIComponent(window.location.origin || 'http://localhost');
  return `https://www.youtube.com/embed/${encodeURIComponent(videoKey)}?autoplay=1&playsinline=1&rel=0&modestbranding=1&origin=${origin}`;
}

function showTrailerModal(embedUrl, titleText = 'Trailer') {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay trailer-overlay';

  const modal = document.createElement('div');
  modal.className = 'trailer-dialog';

  const header = document.createElement('div');
  header.className = 'trailer-header';

  const title = document.createElement('h3');
  title.className = 'trailer-title';
  title.textContent = titleText;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ghost-btn';
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
  modal.appendChild(header);
  modal.appendChild(frameWrap);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

async function fetchShowDetails(group) {
  const cacheKey = Number.isFinite(group?.tmdbId)
    ? `tmdb:${group.tmdbId}`
    : (group?.key || normalize(group.name));
  if (showDetailCache.has(cacheKey)) return showDetailCache.get(cacheKey);

  if (Number.isFinite(group?.tmdbId)) {
    const [detailsRes, creditsRes] = await Promise.all([
      apiGet(`/api/tmdb/tv/${group.tmdbId}`),
      apiGet(`/api/tmdb/tv/${group.tmdbId}/credits`),
    ]);

    const result = { details: detailsRes, credits: creditsRes };
    showDetailCache.set(cacheKey, result);
    return result;
  }

  const searchData = await apiGet('/api/tmdb/tv/search', { q: group.name || '' });
  const show = searchData?.results?.[0];
  if (!show?.id) return null;

  const [detailsRes, creditsRes] = await Promise.all([
    apiGet(`/api/tmdb/tv/${show.id}`),
    apiGet(`/api/tmdb/tv/${show.id}/credits`),
  ]);

  const result = { details: detailsRes, credits: creditsRes };
  showDetailCache.set(cacheKey, result);
  return result;
}

async function fetchEpisodeDetails(showId, seasonNumber, episodeNumber) {
  if (!showId || !seasonNumber || !episodeNumber) return null;

  const key = `${showId}-${seasonNumber}-${episodeNumber}`;
  if (episodeDetailCache.has(key)) return episodeDetailCache.get(key);

  const details = await apiGet(`/api/tmdb/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}`);
  episodeDetailCache.set(key, details);
  return details;
}

function renderDetailHeader(title, onBack) {
  const actions = document.createElement('div');
  actions.className = 'actions';

  const back = document.createElement('button');
  back.className = 'ghost-btn';
  back.textContent = 'Back';
  back.addEventListener('click', onBack);
  actions.appendChild(back);

  const heading = document.createElement('p');
  heading.className = 'status';
  heading.textContent = title;

  return { actions, heading };
}

function renderMovieDetailCard(item, meta) {
  content.innerHTML = '';
  statusText.textContent = '';

  const { actions } = renderDetailHeader('Movie details', () => {
    detailState = null;
    renderCurrentView();
  });
  content.appendChild(actions);

  const card = document.createElement('article');
  card.className = 'detail-card';

  const img = document.createElement('img');
  img.className = 'detail-poster';
  img.src = (item.posterPath || meta?.details?.poster_path) ? `${TMDB_IMG}${item.posterPath || meta?.details?.poster_path}` : '';
  img.alt = item.title || item.name || 'Poster';

  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';

  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = meta?.details?.title || item.title || item.name || 'Movie';
  titleRow.appendChild(title);

  const rating = createRatingStars(meta?.details?.vote_average);
  if (rating) titleRow.appendChild(rating);

  const year = (meta?.details?.release_date || '').slice(0, 4);

  const overview = document.createElement('p');
  overview.className = 'detail-text';
  overview.textContent = meta?.details?.overview || 'No description available.';

  const directorName = meta?.credits?.crew?.find((person) => person.job === 'Director')?.name;
  const runtime = meta?.details?.runtime;
  const genres = meta?.details?.genres?.map((g) => g.name).join(', ');
  const cast = meta?.credits?.cast?.slice(0, 8).map((p) => p.name).filter(Boolean) || [];
  const directorGroup = createPeopleGroup('Director', directorName ? [directorName] : []);

  const runtimeLine = document.createElement('p');
  runtimeLine.className = 'detail-line';
  runtimeLine.textContent = `Runtime: ${runtime ? `${runtime} min` : 'Unknown'}`;

  const genresLine = document.createElement('p');
  genresLine.className = 'detail-line';
  genresLine.textContent = `Genres: ${genres || 'Unknown'}`;

  const castGroup = createPeopleGroup('Cast', cast);

  const separator = document.createElement('div');
  separator.className = 'detail-separator';

  const metaGrid = document.createElement('div');
  metaGrid.className = 'details-meta-grid';

  const leftCard = document.createElement('div');
  leftCard.className = 'details-info-card';

  const yearLine = document.createElement('p');
  yearLine.className = 'detail-line';
  yearLine.textContent = `Year: ${year || 'Unknown'}`;

  leftCard.appendChild(yearLine);
  leftCard.appendChild(directorGroup);
  leftCard.appendChild(runtimeLine);
  leftCard.appendChild(genresLine);

  const rightCard = document.createElement('div');
  rightCard.className = 'details-info-card';
  rightCard.appendChild(castGroup);

  metaGrid.appendChild(leftCard);
  metaGrid.appendChild(rightCard);

  const play = document.createElement('button');
  play.className = 'solid-btn';
  play.textContent = 'Play';
  play.addEventListener('click', () => openPlayer(item));

  const trailer = document.createElement('button');
  trailer.className = 'ghost-btn';
  trailer.textContent = 'Trailer';
  trailer.addEventListener('click', async () => {
    try {
      const videos = await fetchMovieVideos(item);
      const best = pickBestMovieTrailer(videos);
      if (!best?.key) {
        setPlayerStatus('No trailer was found for this movie.', true);
        return;
      }
      showTrailerModal(buildYoutubeEmbedUrl(best.key), `${meta?.details?.title || item.title || item.name || 'Movie'} Trailer`);
    } catch (err) {
      setPlayerStatus('Could not load trailer right now.', true);
    }
  });

  const actionRow = document.createElement('div');
  actionRow.className = 'actions';
  actionRow.appendChild(play);
  actionRow.appendChild(trailer);
  if (currentUser) {
    actionRow.appendChild(createFavoriteButton(isMovieFavorite(item), async () => {
      try {
        const nextFavorite = !isMovieFavorite(item);
        await setMovieFavorite(item, nextFavorite);
        const refreshed = libraryItems.find((entry) => entry.path === item.path) || item;
        detailState = { ...detailState, item: refreshed };
        renderMovieDetailCard(refreshed, meta);
      } catch (err) {
        setPlayerStatus('Could not update favorites right now.', true);
      }
    }));
  }

  body.appendChild(titleRow);
  body.appendChild(overview);
  body.appendChild(separator);
  body.appendChild(metaGrid);
  body.appendChild(actionRow);

  card.appendChild(img);
  card.appendChild(body);
  content.appendChild(card);
}

function renderShowDetailCard(group, meta) {
  content.innerHTML = '';
  statusText.textContent = '';

  const { actions } = renderDetailHeader('TV show details', () => {
    detailState = null;
    renderCurrentView();
  });
  content.appendChild(actions);

  const card = document.createElement('article');
  card.className = 'detail-card';

  const img = document.createElement('img');
  img.className = 'detail-poster';
  img.src = (group.posterPath || meta?.details?.poster_path) ? `${TMDB_IMG}${group.posterPath || meta?.details?.poster_path}` : '';
  img.alt = group.name || 'Show poster';

  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';

  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = meta?.details?.name || group.name || 'TV Show';
  titleRow.appendChild(title);

  const rating = createRatingStars(meta?.details?.vote_average);
  if (rating) titleRow.appendChild(rating);

  const year = (meta?.details?.first_air_date || '').slice(0, 4);

  const overview = document.createElement('p');
  overview.className = 'detail-text';
  overview.textContent = meta?.details?.overview || 'No description available.';

  const directorName =
    meta?.credits?.crew?.find((person) => person.job === 'Director')?.name
    || meta?.credits?.crew?.find((person) => person.department === 'Directing')?.name;
  const cast = meta?.credits?.cast?.slice(0, 8).map((p) => p.name).filter(Boolean) || [];
  const directorGroup = createPeopleGroup('Director', directorName ? [directorName] : []);
  const castGroup = createPeopleGroup('Cast', cast);
  const genres = meta?.details?.genres?.map((g) => g.name).join(', ');
  const seasonCount = meta?.details?.number_of_seasons;

  const genresLine = document.createElement('p');
  genresLine.className = 'detail-line';
  genresLine.textContent = `Genres: ${genres || 'Unknown'}`;

  const seasonsLine = document.createElement('p');
  seasonsLine.className = 'detail-line';
  seasonsLine.textContent = `Seasons: ${seasonCount || 'Unknown'}`;

  const separator = document.createElement('div');
  separator.className = 'detail-separator';

  const metaGrid = document.createElement('div');
  metaGrid.className = 'details-meta-grid';

  const leftCard = document.createElement('div');
  leftCard.className = 'details-info-card';

  const yearLine = document.createElement('p');
  yearLine.className = 'detail-line';
  yearLine.textContent = `Year: ${year || 'Unknown'}`;

  leftCard.appendChild(yearLine);
  leftCard.appendChild(directorGroup);
  leftCard.appendChild(genresLine);
  leftCard.appendChild(seasonsLine);

  const rightCard = document.createElement('div');
  rightCard.className = 'details-info-card';
  rightCard.appendChild(castGroup);

  metaGrid.appendChild(leftCard);
  metaGrid.appendChild(rightCard);

  const actionRow = document.createElement('div');
  actionRow.className = 'actions';
  if (currentUser) {
    actionRow.appendChild(createFavoriteButton(isShowFavorite(group), async () => {
      try {
        const nextFavorite = !isShowFavorite(group);
        await setShowFavorite(group, nextFavorite);
        const refreshedGroup = getShowGroups().find((entry) => entry.key === group.key) || group;
        detailState = { ...detailState, group: refreshedGroup };
        renderShowDetailCard(refreshedGroup, meta);
      } catch (err) {
        setPlayerStatus('Could not update favorites right now.', true);
      }
    }));
  }

  body.appendChild(titleRow);
  body.appendChild(overview);
  body.appendChild(separator);
  body.appendChild(metaGrid);
  if (actionRow.childElementCount) {
    body.appendChild(actionRow);
  }

  card.appendChild(img);
  card.appendChild(body);
  content.appendChild(card);

  const episodeHeader = document.createElement('h2');
  episodeHeader.className = 'section-title';
  episodeHeader.textContent = 'Episodes';
  content.appendChild(episodeHeader);

  const seasonTabs = document.createElement('div');
  seasonTabs.className = 'season-tabs';
  content.appendChild(seasonTabs);

  const episodeList = document.createElement('div');
  episodeList.className = 'episode-list';

  const showId = meta?.details?.id;
  const seasons = Array.from(new Set(
    group.episodes
      .map((episode) => episode?.episode?.season)
      .filter((season) => Number.isFinite(season))
  )).sort((a, b) => a - b);

  const renderSeasonEpisodes = (season) => {
    episodeList.innerHTML = '';
    const seasonEpisodes = group.episodes.filter((episode) => episode?.episode?.season === season);

    seasonEpisodes.forEach((episode) => {
      const row = document.createElement('div');
      row.className = 'episode-row';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'episode-thumb-wrap';

      const thumb = document.createElement('img');
      thumb.className = 'episode-thumb';
      thumb.alt = `${formatEpisodeLabel(episode)} thumbnail`;
      thumb.loading = 'lazy';

      const thumbFallback = document.createElement('div');
      thumbFallback.className = 'episode-thumb-fallback';
      thumbFallback.textContent = 'No image';

      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(thumbFallback);

      const left = document.createElement('div');
      left.className = 'episode-left';

      const label = document.createElement('span');
      label.className = 'episode-label';
      label.textContent = formatEpisodeLabel(episode);

      const overview = document.createElement('p');
      overview.className = 'episode-overview';
      overview.textContent = 'Episode details loading...';

      const episodeWatchPercent = getWatchPercent(episode);
      if (episodeWatchPercent > 0) {
        const progressWrap = document.createElement('div');
        progressWrap.className = 'episode-progress-compact';

        const progressTrack = document.createElement('div');
        progressTrack.className = 'episode-progress-track';

        const progressFill = document.createElement('div');
        progressFill.className = 'episode-progress-fill';
        progressFill.style.width = `${episodeWatchPercent}%`;
        progressTrack.appendChild(progressFill);

        const progressLabel = document.createElement('span');
        progressLabel.className = 'episode-progress-label';
        progressLabel.textContent = `${Math.round(episodeWatchPercent)}% watched`;

        progressWrap.appendChild(progressTrack);
        progressWrap.appendChild(progressLabel);
        left.appendChild(progressWrap);
      }

      const metaBox = document.createElement('span');
      metaBox.className = 'episode-meta';

      const ratingPlaceholder = document.createElement('span');
      ratingPlaceholder.className = 'episode-meta-note';
      ratingPlaceholder.textContent = 'No rating';

      const runtime = document.createElement('span');
      runtime.className = 'episode-runtime';
      runtime.textContent = '-- min';

      metaBox.appendChild(ratingPlaceholder);
      metaBox.appendChild(runtime);

      const play = document.createElement('button');
      play.className = 'episode-play';
      play.textContent = 'Play';
      play.addEventListener('click', () => openPlayer(episode));

      left.appendChild(label);
      left.appendChild(overview);

      row.appendChild(thumbWrap);
      row.appendChild(left);
      row.appendChild(metaBox);
      row.appendChild(play);
      episodeList.appendChild(row);

      if (!showId || !episode?.episode?.season || !episode?.episode?.episode) return;

      fetchEpisodeDetails(showId, episode.episode.season, episode.episode.episode)
        .then((episodeMeta) => {
          if (!episodeMeta || !document.body.contains(row)) return;

          metaBox.innerHTML = '';
          const episodeRating = createRatingStars(episodeMeta.vote_average);
          if (episodeRating) {
            metaBox.appendChild(episodeRating);
          } else {
            const noRating = document.createElement('span');
            noRating.className = 'episode-meta-note';
            noRating.textContent = 'No rating';
            metaBox.appendChild(noRating);
          }

          runtime.textContent = episodeMeta.runtime ? `${episodeMeta.runtime} min` : '-- min';
          metaBox.appendChild(runtime);
          overview.textContent = episodeMeta.overview || 'No episode description available.';
          if (episodeMeta.still_path) {
            thumb.src = `${TMDB_IMG}${episodeMeta.still_path}`;
            thumb.style.display = '';
            thumbFallback.style.display = 'none';
          } else {
            thumb.style.display = 'none';
            thumbFallback.style.display = '';
          }
        })
        .catch(() => {
          overview.textContent = 'Could not load episode details.';
          thumb.style.display = 'none';
          thumbFallback.style.display = '';
        });
    });
  };

  seasons.forEach((season, index) => {
    const tab = document.createElement('button');
    tab.className = 'season-tab';
    if (index === 0) tab.classList.add('active');
    tab.textContent = `Season ${season}`;
    tab.addEventListener('click', () => {
      seasonTabs.querySelectorAll('.season-tab').forEach((node) => node.classList.remove('active'));
      tab.classList.add('active');
      renderSeasonEpisodes(season);
    });
    seasonTabs.appendChild(tab);
  });

  if (seasons.length) {
    renderSeasonEpisodes(seasons[0]);
  } else {
    const fallback = document.createElement('p');
    fallback.className = 'status';
    fallback.textContent = 'No season metadata available.';
    episodeList.appendChild(fallback);
  }

  content.appendChild(episodeList);
}

async function openMovieDetails(item) {
  detailState = { type: 'movie', item, loading: true };
  renderCurrentView();
  try {
    const meta = await fetchMovieDetails(item);
    detailState = { type: 'movie', item, meta };
    renderCurrentView();
  } catch (err) {
    detailState = { type: 'movie', item, meta: null };
    renderCurrentView();
  }
}

async function openShowDetails(group) {
  detailState = { type: 'show', group, loading: true };
  renderCurrentView();
  try {
    const meta = await fetchShowDetails(group);
    detailState = { type: 'show', group, meta };
    renderCurrentView();
  } catch (err) {
    detailState = { type: 'show', group, meta: null };
    renderCurrentView();
  }
}

function updateNavActive() {
  mobileNav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });
}

function updateSearchVisibility() {
  const hide = currentView === 'account' || !!detailState;
  searchInput.style.display = hide ? 'none' : '';
  if (mobileFiltersWrap) {
    mobileFiltersWrap.style.display = hide ? 'none' : '';
  }
}

function renderCurrentView() {
  updateNavActive();
  updateSearchVisibility();

  if (detailState?.type === 'movie') {
    renderMovieDetailCard(detailState.item, detailState.meta);
    if (detailState.loading) statusText.textContent = 'Loading movie details...';
    return;
  }

  if (detailState?.type === 'show') {
    renderShowDetailCard(detailState.group, detailState.meta);
    if (detailState.loading) statusText.textContent = 'Loading show details...';
    return;
  }

  if (currentView === 'home') {
    renderHome();
    return;
  }
  if (currentView === 'movies') {
    renderMovies();
    return;
  }
  if (currentView === 'shows') {
    renderShows();
    return;
  }
  renderAccount();
}

function scheduleRenderCurrentView() {
  window.requestAnimationFrame(() => {
    renderCurrentView();
  });
}

function openPlayer(item) {
  if (!item.streamUrl) return;
  currentPlayerItem = item;
  setPlayerStatus('');
  subtitleControls.innerHTML = '';
  subtitleControls.classList.add('hidden');
  player.controls = false;
  player.pause();
  player.removeAttribute('src');
  player.load();
  Array.from(player.querySelectorAll('source,track')).forEach((node) => node.remove());

  playerTitle.textContent = item.title || item.name || 'Now Playing';
  const source = document.createElement('source');
  source.src = item.streamUrl;
  if (item.mimeType) source.type = item.mimeType;
  player.appendChild(source);

  const subtitles = Array.isArray(item.subtitles) ? item.subtitles.filter((sub) => sub?.src) : [];
  subtitles.forEach((subtitle, index) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = subtitle.name || `Subtitle ${index + 1}`;
    track.srclang = subtitle.language || 'en';
    track.src = subtitle.src;
    player.appendChild(track);
  });

  player.onwaiting = () => setPlayerStatus('Loading video...');
  player.onstalled = () => setPlayerStatus('Network is slow. Still trying...', false);
  player.onplaying = () => setPlayerStatus('');
  player.oncanplay = () => setPlayerStatus('');
  player.onerror = () => {
    const maybeUnsupported = item.mimeType && !player.canPlayType(item.mimeType);
    if (maybeUnsupported) {
      setPlayerStatus('This format is likely not supported on this device. MP4 is recommended.', true);
      return;
    }
    setPlayerStatus('Could not play this video. Please try another file.', true);
  };

  let lastProgressSave = 0;
  const persist = (forceComplete = false) => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    const now = Date.now();
    if (!forceComplete && now - lastProgressSave < 2500) return;
    lastProgressSave = now;
    saveWatchProgress(item, player.currentTime, player.duration, forceComplete);
  };

  player.ontimeupdate = () => {
    persist(false);
    syncPlayerControls();
  };
  player.onpause = () => persist(false);
  player.onended = () => persist(true);

  if (subtitles.length) {
    subtitleControls.classList.remove('hidden');

    const subtitleLabel = document.createElement('span');
    subtitleLabel.className = 'subtitle-label';
    subtitleLabel.textContent = 'Subtitles';

    const subtitleSelect = document.createElement('select');
    subtitleSelect.className = 'subtitle-select';

    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = 'Off';
    subtitleSelect.appendChild(offOption);

    subtitles.forEach((subtitle, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = subtitle.name || `Subtitle ${index + 1}`;
      subtitleSelect.appendChild(option);
    });

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'subtitle-label';
    sizeLabel.textContent = 'Size';

    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'subtitle-select';
    [
      { value: '16px', label: 'Small' },
      { value: '20px', label: 'Medium' },
      { value: '24px', label: 'Large' },
    ].forEach((itemSize) => {
      const option = document.createElement('option');
      option.value = itemSize.value;
      option.textContent = itemSize.label;
      sizeSelect.appendChild(option);
    });
    sizeSelect.value = getSubtitleFontSize();

    const applyTrackMode = (selectedIndex) => {
      const tracks = Array.from(player.textTracks || []);
      tracks.forEach((track, index) => {
        track.mode = index === selectedIndex ? 'showing' : 'disabled';
      });
    };

    subtitleSelect.addEventListener('change', () => {
      if (subtitleSelect.value === 'off') {
        applyTrackMode(-1);
        return;
      }
      applyTrackMode(Number.parseInt(subtitleSelect.value, 10));
    });

    sizeSelect.addEventListener('change', () => {
      setSubtitleFontSize(sizeSelect.value);
    });

    player.addEventListener('loadedmetadata', () => {
      subtitleSelect.value = 'off';
      applyTrackMode(-1);
    }, { once: true });

    subtitleControls.appendChild(subtitleLabel);
    subtitleControls.appendChild(subtitleSelect);
    subtitleControls.appendChild(sizeLabel);
    subtitleControls.appendChild(sizeSelect);
  }

  if (item.mimeType && !player.canPlayType(item.mimeType)) {
    setPlayerStatus('This format may not play on this device. MP4 works best.', true);
  }

  player.load();
  playerView.classList.remove('hidden');
  syncPlayerControls();
  showPlayerControls(false);
  player.play().catch(() => {
    setPlayerStatus('Press Play to start.', false);
    syncPlayerControls();
  });
}

function closePlayer() {
  if (Number.isFinite(player.duration) && player.duration > 0) {
    if (currentPlayerItem) {
      saveWatchProgress(currentPlayerItem, player.currentTime, player.duration, false);
    }
  }

  player.pause();
  player.removeAttribute('src');
  player.load();
  Array.from(player.querySelectorAll('source,track')).forEach((node) => node.remove());
  player.onwaiting = null;
  player.onstalled = null;
  player.onplaying = null;
  player.oncanplay = null;
  player.onerror = null;
  player.ontimeupdate = null;
  player.onpause = null;
  player.onended = null;
  subtitleControls.innerHTML = '';
  subtitleControls.classList.add('hidden');
  setPlayerStatus('');
  playerView.classList.add('hidden');
  currentPlayerItem = null;
  clearPlayerControlsHideTimer();
  if (playerClickToggleTimer) {
    clearTimeout(playerClickToggleTimer);
    playerClickToggleTimer = null;
  }
  playerStage.classList.add('controls-visible');
  syncPlayerControls();
}

searchInput.addEventListener('input', () => {
  searchQuery = (searchInput.value || '').trim();
  if (searchRenderTimer) {
    clearTimeout(searchRenderTimer);
  }
  searchRenderTimer = setTimeout(() => {
    searchRenderTimer = null;
    scheduleRenderCurrentView();
  }, SEARCH_RENDER_DEBOUNCE_MS);
});

if (mobileGenreFilter) {
  mobileGenreFilter.value = selectedGenreFilter;
  mobileGenreFilter.addEventListener('change', () => {
    selectedGenreFilter = mobileGenreFilter.value || 'all';
    scheduleRenderCurrentView();
  });
}

if (mobileSortFilter) {
  mobileSortFilter.value = selectedSort;
  mobileSortFilter.addEventListener('change', () => {
    selectedSort = mobileSortFilter.value || 'default';
    scheduleRenderCurrentView();
  });
}

refreshBtn.addEventListener('click', () => refreshSessionAndLibrary({ goHome: false }));

homeBtn.addEventListener('click', () => {
  detailState = null;
  currentView = 'home';
  renderCurrentView();
});

mobileNav.addEventListener('click', (event) => {
  const button = event.target.closest('.nav-btn');
  if (!button) return;
  detailState = null;
  currentView = button.dataset.view;
  renderCurrentView();
});

backBtn.addEventListener('click', closePlayer);
setPlayerButtonIcon(skipBackBtn, 'replay', 'Go back 5 seconds');
setPlayerButtonIcon(skipForwardBtn, 'forward', 'Go forward 5 seconds');

playPauseBtn.addEventListener('click', togglePlayerPlayback);
player.addEventListener('click', handleStageSingleClick);
player.addEventListener('dblclick', async (event) => {
  event.preventDefault();
  if (playerClickToggleTimer) {
    clearTimeout(playerClickToggleTimer);
    playerClickToggleTimer = null;
  }
  showPlayerControls(true);
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
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

    if (player.webkitEnterFullscreen) {
      player.webkitEnterFullscreen();
    }
  } catch (err) {
    // Ignore fullscreen errors.
  }
  syncPlayerControls();
});
playerStage.addEventListener('touchstart', () => showPlayerControls(true), { passive: true });
playerStage.addEventListener('pointermove', handleStagePointerActivity);
playerStage.addEventListener('mousemove', handleStagePointerActivity);
player.addEventListener('pointermove', handleStagePointerActivity);
player.addEventListener('mousemove', handleStagePointerActivity);
playerStage.addEventListener('mouseenter', () => showPlayerControls(true));
playerStage.addEventListener('mousedown', () => showPlayerControls(true));
playerStage.addEventListener('click', handleStageSingleClick);
playerStage.addEventListener('dblclick', async (event) => {
  event.preventDefault();
  if (playerClickToggleTimer) {
    clearTimeout(playerClickToggleTimer);
    playerClickToggleTimer = null;
  }
  showPlayerControls(true);
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
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

    if (player.webkitEnterFullscreen) {
      player.webkitEnterFullscreen();
    }
  } catch (err) {
    // Ignore fullscreen errors.
  }
  syncPlayerControls();
});
playerStage.addEventListener('focusin', () => showPlayerControls(true));
document.addEventListener('pointermove', handleGlobalPlayerPointerMove);
document.addEventListener('mousemove', handleGlobalPlayerPointerMove);

skipBackBtn.addEventListener('click', () => {
  player.currentTime = Math.max(0, player.currentTime - 5);
  showPlayerControls(true);
  syncPlayerControls();
});

skipForwardBtn.addEventListener('click', () => {
  const maxTime = Number.isFinite(player.duration) ? player.duration : player.currentTime + 5;
  player.currentTime = Math.min(maxTime, player.currentTime + 5);
  showPlayerControls(true);
  syncPlayerControls();
});

timelineRange.addEventListener('input', () => {
  if (!Number.isFinite(player.duration) || player.duration <= 0) return;
  player.currentTime = (Number(timelineRange.value) / 1000) * player.duration;
  showPlayerControls(true);
  syncPlayerControls();
});

muteBtn.addEventListener('click', () => {
  if (!player.currentSrc) return;
  if (player.muted || player.volume === 0) {
    player.muted = false;
    if (player.volume === 0) {
      player.volume = 1;
    }
  } else {
    player.muted = true;
  }
  showPlayerControls(true);
  syncPlayerControls();
});

volumeRange.addEventListener('input', () => {
  const nextVolume = Math.max(0, Math.min(1, Number(volumeRange.value) / 100));
  player.volume = nextVolume;
  player.muted = nextVolume === 0;
  showPlayerControls(true);
  syncPlayerControls();
});

fullscreenBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
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

    if (player.webkitEnterFullscreen) {
      player.webkitEnterFullscreen();
    }
  } catch (err) {
    // Ignore fullscreen errors.
  }
  syncPlayerControls();
});

player.addEventListener('loadedmetadata', syncPlayerControls);
player.addEventListener('play', () => {
  syncPlayerControls();
  showPlayerControls(true);
});
player.addEventListener('pause', () => {
  syncPlayerControls();
  showPlayerControls(false);
});
player.addEventListener('volumechange', syncPlayerControls);
player.addEventListener('durationchange', syncPlayerControls);
document.addEventListener('fullscreenchange', () => {
  syncPlayerControls();
  showPlayerControls(true);
});
document.addEventListener('webkitfullscreenchange', () => {
  syncPlayerControls();
  showPlayerControls(true);
});

initTheme();
setSubtitleFontSize(getSubtitleFontSize());
playerStage.classList.add('controls-visible');
syncPlayerControls();
refreshSessionAndLibrary({ goHome: false });
