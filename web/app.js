const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const SUBTITLE_SIZE_KEY = 'myMediaSubtitleFontSize';
const WATCH_COMPLETE_THRESHOLD_PERCENT = 92;
const SEARCH_RENDER_DEBOUNCE_MS = 120;
const MIN_RELIABLE_EPISODE_VOTES = 5;
const CINEMA_SOUND_KEY = 'cinemaSoundsEnabled';

const content = document.getElementById('content');
const statusText = document.getElementById('statusText');
const searchInput = document.getElementById('searchInput');
const movieNightBtn = document.getElementById('movieNightBtn');
const suggestionBtn = document.getElementById('suggestionBtn');
const mobileFiltersWrap = document.querySelector('.mobile-filters');
const mobileGenreFilter = document.getElementById('mobileGenreFilter');
const mobileSortFilter = document.getElementById('mobileSortFilter');
const homeBtn = document.getElementById('homeBtn');
const mobileNav = document.getElementById('mobileNav');

const playerView = document.getElementById('playerView');
const playerStage = document.getElementById('playerStage');
const fullscreenBackBtn = document.getElementById('fullscreenBackBtn');
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
const qualityGroup = document.getElementById('qualityGroup');
const qualityBtn = document.getElementById('qualityBtn');
const qualityButtonLabel = document.getElementById('qualityButtonLabel');
const qualityMenu = document.getElementById('qualityMenu');
const skipIntroBtn = document.getElementById('skipIntroBtn');
const nextEpisodeBtn = document.getElementById('nextEpisodeBtn');
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
let allowSignup = true;
let currentPlayerItem = null;
let currentPlayerNextEpisode = null;
let playerControlsHideTimer = null;
let playerClickToggleTimer = null;
let cinemaTransitionActive = false;
let cinemaAudioContext = null;
let activeHls = null;
let playbackOptions = null;
let selectedPlaybackQuality = 'Original';
let qualityRequestToken = 0;
let streamSessionId = '';
let streamHeartbeatTimer = null;
let playbackMode = 'direct';
let playbackState = 'idle';
let automaticFallbackAttempted = false;

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

function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function isMobileLayout() {
  return !!window.matchMedia?.('(max-width: 700px)').matches;
}

function getCinemaSoundsEnabled() {
  return localStorage.getItem(CINEMA_SOUND_KEY) === '1';
}

function setCinemaSoundsEnabled(enabled) {
  localStorage.setItem(CINEMA_SOUND_KEY, enabled ? '1' : '0');
}

function playCinemaSound(type = 'click') {
  if (!getCinemaSoundsEnabled()) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  cinemaAudioContext = cinemaAudioContext || new AudioContextClass();
  const context = cinemaAudioContext;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type === 'projector' ? 'sawtooth' : 'sine';
  oscillator.frequency.setValueAtTime(type === 'projector' ? 95 : 210, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(80, context.currentTime + 0.12);
  gain.gain.setValueAtTime(type === 'projector' ? 0.025 : 0.04, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.15);
}

function ensureCinemaTransition(parent = document.body) {
  let overlay = document.getElementById('cinemaTransition');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cinemaTransition';
    overlay.className = 'cinema-transition';
    overlay.innerHTML = `
      <div class="cinema-curtain cinema-curtain-left"></div>
      <div class="cinema-curtain cinema-curtain-right"></div>
      <div class="cinema-transition-center"><span class="cinema-projector-beam"></span><span>MyFlix</span></div>
    `;
  }
  if (overlay.parentElement !== parent) parent.appendChild(overlay);
  return overlay;
}

async function runCinemaTransition(action, mode = 'page') {
  if (prefersReducedMotion() || cinemaTransitionActive) return action();
  cinemaTransitionActive = true;
  const overlay = ensureCinemaTransition(document.body);
  overlay.className = `cinema-transition mode-${mode} is-active is-closed`;
  void overlay.offsetWidth;
  playCinemaSound(mode === 'playback' ? 'projector' : 'click');
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await action();
    overlay.classList.remove('is-closed');
    overlay.classList.add('is-opening');
    await new Promise((resolve) => setTimeout(resolve, mode === 'playback' ? 620 : 340));
  } finally {
    overlay.className = 'cinema-transition';
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    cinemaTransitionActive = false;
  }
}

function requestPlayerFullscreen() {
  try {
    const request = playerStage.requestFullscreen?.bind(playerStage)
      || playerStage.webkitRequestFullscreen?.bind(playerStage)
      || player.webkitEnterFullscreen?.bind(player);
    const result = request?.();
    result?.catch?.(() => {});
  } catch (err) {
    // Fullscreen can be denied by browser policy; playback still starts normally.
  }
}

async function beginPlayback(action) {
  if (isMobileLayout()) {
    action();
    return;
  }
  if (prefersReducedMotion() || cinemaTransitionActive) {
    action();
    requestPlayerFullscreen();
    return;
  }
  cinemaTransitionActive = true;
  const overlay = ensureCinemaTransition(playerStage);
  overlay.className = 'cinema-transition mode-playback is-active is-closed';
  void overlay.offsetWidth;
  playCinemaSound('projector');
  try {
    action();
    requestPlayerFullscreen();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    overlay.classList.remove('is-closed');
    overlay.classList.add('is-opening');
    await new Promise((resolve) => setTimeout(resolve, 620));
  } finally {
    overlay.className = 'cinema-transition';
    document.body.appendChild(overlay);
    cinemaTransitionActive = false;
  }
}

function createImageFallback(container, title, className = 'poster-fallback') {
  const fallback = document.createElement('div');
  fallback.className = className;
  const monogram = String(title || 'MyFlix').split(/\s+/).map((part) => part[0]).join('').slice(0, 3);
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = monogram || 'M';
  const label = document.createElement('strong');
  label.textContent = title || 'Untitled';
  fallback.append(mark, label);
  container.appendChild(fallback);
  return fallback;
}

function bindImageFallback(image, fallback, source) {
  const showFallback = () => {
    image.classList.add('image-unavailable');
    fallback.classList.add('is-visible');
  };
  image.addEventListener('error', showFallback, { once: true });
  if (source) image.src = source;
  else showFallback();
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

function isShortcutEditableTarget(target) {
  const node = target && target.nodeType === 1 ? target : null;
  if (!node) return false;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (node.isContentEditable) return true;
  return false;
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

function getEpisodeTitleText(value) {
  if (!value) return '';
  return extractEpisodeTitle(value) || String(value || '');
}

function getEpisodePartNumber(title) {
  const text = String(title || '').trim();
  let match = text.match(/\((\d+)\)\s*$/);
  if (match) return parseInt(match[1], 10);
  match = text.match(/\b(?:part|pt)\.?\s*(\d+)\s*$/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function stripEpisodePartSuffix(title) {
  return String(title || '')
    .replace(/\s*\((\d+)\)\s*$/i, '')
    .replace(/\s*\b(?:part|pt)\.?\s*\d+\s*$/i, '')
    .trim();
}

function getSiblingEpisodeNumbers(siblingEpisodes = []) {
  return Array.from(new Set(
    (Array.isArray(siblingEpisodes) ? siblingEpisodes : [])
      .map((entry) => Number(entry?.episode?.episode ?? entry?.episode ?? entry))
      .filter(Number.isFinite)
  )).sort((a, b) => a - b);
}

function inferEpisodeRange(episodeInfo, title = '', siblingEpisodes = []) {
  if (!episodeInfo?.season || !episodeInfo?.episode) return episodeInfo;
  if (Number.isFinite(episodeInfo?.episodeEnd) && episodeInfo.episodeEnd > episodeInfo.episode) {
    return episodeInfo;
  }

  if (getEpisodePartNumber(title) !== 1) {
    return episodeInfo;
  }

  const episodeNumbers = getSiblingEpisodeNumbers(siblingEpisodes);
  const nextExistingEpisode = episodeNumbers.find((value) => value > episodeInfo.episode);
  const hasStandaloneNextEpisode = episodeNumbers.includes(episodeInfo.episode + 1);

  if (hasStandaloneNextEpisode) {
    return episodeInfo;
  }

  if (nextExistingEpisode === episodeInfo.episode + 2 || !Number.isFinite(nextExistingEpisode)) {
    return {
      ...episodeInfo,
      episodeEnd: episodeInfo.episode + 1,
    };
  }

  return episodeInfo;
}

function hasReliableEpisodeRating(details) {
  const votes = Number(details?.vote_count);
  const rating = Number(details?.vote_average);
  return Number.isFinite(rating) && rating > 0 && Number.isFinite(votes) && votes >= MIN_RELIABLE_EPISODE_VOTES;
}

function normalizeEpisodeRangesInLibrary(items) {
  const input = Array.isArray(items) ? items : [];
  const normalized = input.map((item) => ({ ...item }));
  const groups = new Map();

  normalized.forEach((item, index) => {
    if (!item?.isShow || !item?.episode?.season || !item?.episode?.episode) return;
    const key = `${item.showId || item.showKey || item.showName || item.name || ''}::${item.episode.season}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, item });
  });

  for (const entries of groups.values()) {
    const siblings = entries.map((entry) => entry.item);
    entries.forEach(({ index, item }) => {
      const nextEpisode = inferEpisodeRange(item.episode, getEpisodeTitleText(item.name), siblings);
      if (nextEpisode?.episodeEnd && nextEpisode.episodeEnd !== item?.episode?.episodeEnd) {
        normalized[index] = {
          ...item,
          episode: nextEpisode,
        };
      }
    });
  }

  return normalized;
}

function formatEpisode(item) {
  if (!item?.episode?.season || !item?.episode?.episode) return '';
  const s = String(item.episode.season).padStart(2, '0');
  const e = String(item.episode.episode).padStart(2, '0');
  return Number.isFinite(item.episode?.episodeEnd) && item.episode.episodeEnd > item.episode.episode
    ? `S${s}E${e}-E${String(item.episode.episodeEnd).padStart(2, '0')}`
    : `S${s}E${e}`;
}

function extractEpisodeTitle(name) {
  const base = String(name || '').replace(/\.(mp4|mkv|avi|mov|mpg|mpeg|vob|webm|m4v)$/i, '');
  const match = base.match(/S\d{1,2}E\d{1,2}(?:\s*-\s*E?\d{1,2})?/i);
  if (!match || match.index === undefined) return '';
  const after = base.slice(match.index + match[0].length);
  return after.replace(/^[\s._-]+/, '').replace(/[\s._-]+/g, ' ').trim();
}

function formatEpisodeLabel(item) {
  const code = formatEpisode(item);
  const title = getEpisodeTitleText(item?.name || item?.title);
  if (!code) return item?.title || item?.name || 'Episode';
  return title && title.toLowerCase() !== code.toLowerCase() ? `${code}: ${title}` : code;
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
    mediaId: item?.id || '',
  };
}

function buildFavoritePayloadForShow(group) {
  return {
    isShow: true,
    showId: group?.id || group?.key || '',
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
    entry.id === item.id
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
    const entryKey = entry.showId || entry.showKey || normalize(entry.showName || entry.title || entry.name);
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
    number.textContent = `(${ratingOutOf10.toFixed(1)}/10)`;
    container.appendChild(number);
  }

  return container;
}

function createPeopleGroup(label, people = [], fallback = 'Unknown') {
  const wrap = document.createElement('div');
  wrap.className = 'details-people-group';

  const labelNode = document.createElement('p');
  labelNode.className = 'detail-line details-people-label';
  labelNode.textContent = `${label}:`;

  const chips = document.createElement('div');
  chips.className = 'details-people-chips';

  const values = Array.isArray(people)
    ? people.map((person) => typeof person === 'string' ? { name: person } : person).filter((person) => person?.name)
    : [];
  const finalValues = values.length ? values : [{ name: fallback }];

  finalValues.forEach((person) => {
    const chip = document.createElement('span');
    chip.className = 'details-person-chip';
    if (person.name === fallback) {
      chip.classList.add('is-fallback');
    }
    if (person.profile_path) {
      const portrait = document.createElement('img');
      portrait.className = 'details-person-portrait';
      portrait.src = `https://image.tmdb.org/t/p/w185${person.profile_path}`;
      portrait.alt = '';
      portrait.loading = 'lazy';
      chip.classList.add('has-portrait');
      chip.appendChild(portrait);
    }
    const identity = document.createElement('span');
    identity.className = 'details-person-identity';
    const name = document.createElement('strong');
    name.textContent = person.name;
    identity.appendChild(name);
    if (person.character) {
      const role = document.createElement('small');
      role.textContent = person.character;
      identity.appendChild(role);
    }
    chip.appendChild(identity);
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
    const key = item.showId || item.showKey || normalize(keyBase);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        id: item.showId || key,
        key,
        tmdbId: Number.isFinite(item.tmdbId) ? item.tmdbId : null,
        name: item.showName || item.title || 'TV Show',
        posterPath: item.posterPath || null,
        customPosterPath: item.customPosterTmdbPath || null,
        backdropPath: item.backdropPath || null,
        overview: item.overview || null,
        releaseDate: item.releaseDate || null,
        rating: Number.isFinite(item.rating) ? item.rating : null,
        runtime: Number.isFinite(item.runtime) ? item.runtime : null,
        metadataLocked: !!item.metadataLocked,
        genreNames: [],
        episodes: [],
      });
    }

    const group = map.get(key);
    if (!Number.isFinite(group.tmdbId) && Number.isFinite(item.tmdbId)) group.tmdbId = item.tmdbId;
    if (!group.posterPath && item.posterPath) group.posterPath = item.posterPath;
    if (!group.customPosterPath && item.customPosterTmdbPath) group.customPosterPath = item.customPosterTmdbPath;
    if (!group.backdropPath && item.backdropPath) group.backdropPath = item.backdropPath;
    if (!group.overview && item.overview) group.overview = item.overview;
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

function createCard({ title, subtitle, poster, onClick, hasCc = false, badges = [] }) {
  const card = document.createElement('article');
  card.className = 'card electric-media-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const open = () => runCinemaTransition(onClick, 'page');
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  });

  const light = document.createElement('span');
  light.className = 'card-picture-light';

  const posterWrap = document.createElement('div');
  posterWrap.className = 'card-poster-wrap';

  const img = document.createElement('img');
  img.className = 'poster';
  img.loading = 'lazy';
  img.alt = title || 'Poster';
  const fallback = createImageFallback(posterWrap, title);
  bindImageFallback(img, fallback, poster);

  if (hasCc) {
    const badge = document.createElement('span');
    badge.className = 'cc-badge';
    badge.textContent = 'CC';
    posterWrap.appendChild(badge);
  }
  const statusRow = document.createElement('div');
  statusRow.className = 'media-card-status';
  for (const value of badges) {
    const badge = document.createElement('span');
    badge.className = 'quality-badge';
    badge.textContent = value;
    statusRow.appendChild(badge);
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
  if (subtitle) meta.appendChild(subNode);
  posterWrap.insertBefore(img, posterWrap.firstChild);
  card.appendChild(light);
  card.appendChild(posterWrap);
  if (statusRow.childElementCount) card.appendChild(statusRow);
  card.appendChild(meta);
  return card;
}

function buildBackdropUrl(backdropPath, size = 780) {
  return backdropPath ? `https://image.tmdb.org/t/p/w${size}${backdropPath}` : '';
}

function buildPosterUrl(posterPath) {
  const value = String(posterPath || '').trim();
  if (!value) return '';
  if (/^(?:https?:|data:|blob:)/i.test(value) || value.startsWith('/api/')) return value;
  return `${TMDB_IMG}${value}`;
}

function getContinueImageSrc(entry) {
  return entry.backdropPath || entry.posterPath || '';
}

function createContinueCard(entry) {
  const card = document.createElement('article');
  card.className = 'card continue-card continue-card-landscape';
  card.addEventListener('click', () => {
    runCinemaTransition(() => (
      entry.type === 'movie' ? openMovieDetails(entry.item) : openShowDetails(entry.group)
    ), 'page');
  });

  const media = document.createElement('div');
  media.className = 'continue-media';

  const img = document.createElement('img');
  img.className = 'continue-image';
  img.loading = 'lazy';
  img.alt = entry.title || 'Continue watching';
  const fallback = createImageFallback(media, entry.title, 'continue-fallback');
  bindImageFallback(img, fallback, getContinueImageSrc(entry));
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

  const progressRow = document.createElement('div');
  progressRow.className = 'continue-progress-row';
  progressRow.appendChild(createContinueProgress(entry.percent));
  const percentage = document.createElement('span');
  percentage.className = 'continue-progress-percent';
  percentage.textContent = `${Math.round(entry.percent || 0)}%`;
  progressRow.appendChild(percentage);
  overlay.appendChild(progressRow);
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

function getShowQualityTags(group) {
  const rank = new Map([['4K', 5], ['1440p', 4], ['1080p', 3], ['720p', 2], ['480p', 1]]);
  const tags = (group?.episodes || []).flatMap((episode) => episode.qualityTags || []);
  const best = tags.sort((first, second) => (rank.get(second) || 0) - (rank.get(first) || 0))[0];
  return best ? [best] : [];
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

function applyLocalWatchProgress(mediaId, watchProgress) {
  if (!mediaId || !watchProgress) return;
  libraryItems = libraryItems.map((item) => (
    item.id === mediaId
      ? { ...item, watchProgress }
      : item
  ));
  if (!detailState) {
    scheduleRenderCurrentView();
  }
}

async function saveWatchProgress(item, currentTime, duration, forceComplete = false) {
  if (!item?.id) return;
  if (!currentUser) return;
  const watchProgress = buildWatchProgress(currentTime, duration, forceComplete);
  if (!watchProgress) return;

  applyLocalWatchProgress(item.id, watchProgress);
  try {
    await apiRequest('/api/account/progress', {
      method: 'POST',
      body: {
        mediaId: item.id,
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

function addCardProgress(card, percent) {
  let row = card.querySelector('.media-card-status');
  if (!row) {
    row = document.createElement('div');
    row.className = 'media-card-status';
    card.querySelector('.meta')?.before(row);
  }
  row.appendChild(createContinueProgress(percent));
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
      subtitle: '',
      percent,
      updatedAt,
      posterPath: buildPosterUrl(item.posterPath),
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
      posterPath: buildPosterUrl(group.posterPath),
      backdropPath: group.backdropPath ? buildBackdropUrl(group.backdropPath, 780) : '',
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
    });
  }

  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function createShelf(titleText, body, options = {}) {
  const shelf = document.createElement('section');
  shelf.className = `home-shelf${options.featured ? ' featured-shelf' : ''}`;
  const header = document.createElement('div');
  header.className = 'home-shelf-header';
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = titleText;
  const actions = document.createElement('div');
  actions.className = 'home-shelf-actions';
  let seeAll = null;
  if (options.view) {
    seeAll = document.createElement('button');
    seeAll.className = 'home-see-all';
    seeAll.textContent = `See All ${titleText}`;
    seeAll.addEventListener('click', () => {
      currentView = options.view;
      detailState = null;
      renderCurrentView();
    });
    actions.appendChild(seeAll);
  }
  if (options.scrollable) {
    const railButtons = [];
    for (const [label, direction] of [['Previous', -1], ['Next', 1]]) {
      const button = document.createElement('button');
      button.className = 'home-rail-btn';
      button.setAttribute('aria-label', `${label} ${titleText}`);
      button.innerHTML = direction < 0
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
      button.addEventListener('click', () => {
        body.scrollBy({ left: direction * Math.max(320, body.clientWidth * 0.8), behavior: 'smooth' });
      });
      railButtons.push(button);
      actions.appendChild(button);
    }
    const updateRailButtons = () => {
      const overflow = body.scrollWidth > body.clientWidth + 4;
      railButtons.forEach((button) => { button.hidden = !overflow; });
      if (seeAll && isMobileLayout()) seeAll.hidden = !overflow;
      if (!overflow) return;
      railButtons[0].disabled = body.scrollLeft <= 4;
      railButtons[1].disabled = body.scrollLeft + body.clientWidth >= body.scrollWidth - 4;
    };
    body.addEventListener('scroll', updateRailButtons, { passive: true });
    window.requestAnimationFrame(updateRailButtons);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(updateRailButtons);
      observer.observe(body);
      observer.observe(shelf);
    } else {
      window.addEventListener('resize', updateRailButtons, { passive: true });
    }
  }
  header.append(title, actions);
  shelf.append(header, body);
  return shelf;
}

function getFeaturedEntries(movies, shows) {
  const entries = movies.map((item) => ({
    type: 'movie',
    title: item.title || item.name || 'Movie',
    poster: buildPosterUrl(item.posterPath),
    description: item.overview || 'A featured presentation from your private collection.',
    meta: [String(item.releaseDate || '').slice(0, 4), ...(item.genreNames || []).slice(0, 2), item.runtime ? `${item.runtime} min` : '']
      .filter(Boolean).join('  /  '),
    score: Number(item.rating) || 0,
    open: () => openMovieDetails(item),
    play: () => openPlayer(item),
  }));
  for (const group of shows) {
    const continueState = getShowContinueState(group);
    entries.push({
      type: 'show',
      title: group.name || 'TV Show',
      poster: buildPosterUrl(group.posterPath),
      description: group.overview || 'A featured series from your private collection.',
      meta: [String(group.releaseDate || '').slice(0, 4), ...(group.genreNames || []).slice(0, 2), `${new Set(group.episodes.map((episode) => episode.episode?.season)).size} season(s)`]
        .filter(Boolean).join('  /  '),
      score: Number(group.rating) || 0,
      open: () => openShowDetails(group),
      play: () => openPlayer(continueState?.episode || group.episodes[0]),
    });
  }
  return entries.sort((a, b) => b.score - a.score).slice(0, 12);
}

function renderFeaturedHero(movies, shows) {
  const entries = getFeaturedEntries(movies, shows).slice(0, isMobileLayout() ? 1 : 2);
  const wrap = document.createElement('div');
  wrap.className = 'featured-hero-wrap';
  if (!entries.length) return wrap;
  const hero = document.createElement('div');
  hero.className = 'electric-featured';
  const ticket = document.createElement('button');
  ticket.className = 'electric-featured-note';
  ticket.type = 'button';
  const posters = document.createElement('div');
  posters.className = 'electric-featured-posters';
  hero.append(ticket, posters);
  wrap.appendChild(hero);

  const createPoster = (entry, isMain) => {
    const button = document.createElement('button');
    button.className = `electric-featured-poster${isMain ? ' is-main' : ''}`;
    button.type = 'button';
    const light = document.createElement('span');
    light.className = 'electric-featured-light';
    const frame = document.createElement('span');
    frame.className = 'electric-featured-frame';
    const image = document.createElement('img');
    image.className = 'electric-featured-image';
    image.alt = entry.title;
    const fallback = createImageFallback(frame, entry.title, 'featured-poster-fallback');
    bindImageFallback(image, fallback, entry.poster);
    frame.insertBefore(image, frame.firstChild);
    const caption = document.createElement('span');
    caption.className = 'electric-featured-caption';
    const name = document.createElement('strong');
    name.textContent = entry.title;
    caption.appendChild(name);
    button.append(light, frame, caption);
    button.addEventListener('click', () => runCinemaTransition(entry.open, 'page'));
    return button;
  };

  const entry = entries[0];
  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'Featured Screening';
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const meta = document.createElement('p');
  meta.className = 'electric-featured-meta';
  meta.textContent = entry.meta;
  const description = document.createElement('p');
  description.className = 'electric-featured-description';
  description.textContent = entry.description;
  const play = document.createElement('span');
  play.className = 'electric-featured-play';
  play.innerHTML = `<span class="electric-featured-play-icon">${getPlayerIconSvg('play')}</span><i></i><span>Play Now</span>`;
  play.addEventListener('click', (event) => {
    event.stopPropagation();
    beginPlayback(entry.play);
  });
  ticket.append(eyebrow, title, meta, description, play);
  ticket.onclick = () => runCinemaTransition(entry.open, 'page');
  posters.replaceChildren(...entries.map((featured, index) => createPoster(featured, index === 0)));
  return wrap;
}

function renderContinueWatching() {
  if (!currentUser) return;
  const entries = getContinueWatchingEntries();
  if (!entries.length) return;

  const row = document.createElement('section');
  row.className = 'continue-row home-horizontal-rail';

  entries.forEach((entry) => {
    row.appendChild(createContinueCard(entry));
  });

  content.appendChild(createShelf('Continue Watching', row, { scrollable: true }));
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

  content.appendChild(createShelf('Now Showing', renderFeaturedHero(movies, shows), { featured: true }));
  renderContinueWatching();

  const movieGrid = createGrid();
  movieGrid.classList.add('home-horizontal-rail');
  movies.forEach((item) => {
    const card = createCard({
      title: item.title || item.name,
      subtitle: '',
      poster: buildPosterUrl(item.posterPath),
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      badges: item.qualityTags || [],
      onClick: () => openMovieDetails(item),
    });
    const percent = getWatchPercent(item);
    if (percent > 0 && percent < 100) {
      addCardProgress(card, percent);
    }
    movieGrid.appendChild(card);
  });
  content.appendChild(createShelf('Movies', movieGrid, { view: 'movies', scrollable: true }));

  const showGrid = createGrid();
  showGrid.classList.add('home-horizontal-rail');
  shows.forEach((group) => {
    const card = createCard({
      title: group.name,
      subtitle: '',
      poster: buildPosterUrl(group.posterPath),
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      badges: getShowQualityTags(group),
      onClick: () => openShowDetails(group),
    });
    const percent = getShowWatchPercent(group);
    if (percent > 0 && percent < 100) addCardProgress(card, percent);
    showGrid.appendChild(card);
  });
  content.appendChild(createShelf('TV Shows', showGrid, { view: 'shows', scrollable: true }));

  statusText.textContent = '';
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
      subtitle: '',
      poster: buildPosterUrl(item.posterPath),
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      badges: item.qualityTags || [],
      onClick: () => openMovieDetails(item),
    });
    const percent = getWatchPercent(item);
    if (percent > 0 && percent < 100) {
      addCardProgress(card, percent);
    }
    grid.appendChild(card);
  });

  content.appendChild(grid);
  statusText.textContent = '';
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
    const card = createCard({
      title: group.name,
      subtitle: '',
      poster: buildPosterUrl(group.posterPath),
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      badges: getShowQualityTags(group),
      onClick: () => openShowDetails(group),
    });
    const percent = getShowWatchPercent(group);
    if (percent > 0 && percent < 100) addCardProgress(card, percent);
    grid.appendChild(card);
  });

  content.appendChild(grid);
  statusText.textContent = '';
}

function buildPreferenceToggle(labelText, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'settings-preference-row';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const slider = document.createElement('span');
  slider.className = 'brass-toggle';
  input.addEventListener('change', () => onChange(input.checked));
  row.append(label, input, slider);
  return row;
}

function renderSettings() {
  content.innerHTML = '';
  statusText.textContent = '';
  const page = document.createElement('section');
  page.className = 'settings-lounge-page';
  const heading = document.createElement('div');
  heading.className = 'lounge-page-heading';
  heading.innerHTML = '<h2>Settings</h2><p>Choose how MyFlix behaves when you watch.</p>';
  const panel = document.createElement('div');
  panel.className = 'settings-card cinema-control-panel';
  panel.appendChild(buildPreferenceToggle('Cinema sound effects', getCinemaSoundsEnabled(), setCinemaSoundsEnabled));

  const subtitleRow = document.createElement('label');
  subtitleRow.className = 'settings-preference-row';
  const subtitleLabel = document.createElement('span');
  subtitleLabel.textContent = 'Default subtitle size';
  const subtitleSelect = document.createElement('select');
  subtitleSelect.className = 'mobile-select';
  [['16px', 'Small'], ['20px', 'Medium'], ['24px', 'Large']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    subtitleSelect.appendChild(option);
  });
  subtitleSelect.value = getSubtitleFontSize();
  subtitleSelect.addEventListener('change', () => setSubtitleFontSize(subtitleSelect.value));
  subtitleRow.append(subtitleLabel, subtitleSelect);
  panel.appendChild(subtitleRow);
  page.append(heading, panel);
  if (currentUser?.isAdmin) page.appendChild(createAdminScanPanel());
  content.appendChild(page);
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

function openPasswordDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay password-overlay';
  const modal = document.createElement('section');
  modal.className = 'auth-modal password-modal';
  const heading = document.createElement('h2');
  heading.className = 'auth-title';
  heading.textContent = 'Change Password';
  const copy = document.createElement('p');
  copy.className = 'account-copy';
  copy.textContent = 'Changing your password signs out your other devices.';
  const form = document.createElement('form');
  form.className = 'password-form';
  const fields = [
    ['currentPassword', 'Current password'],
    ['newPassword', 'New password'],
    ['confirmPassword', 'Confirm new password'],
  ].map(([name, labelText]) => {
    const label = document.createElement('label');
    label.className = 'auth-field';
    const labelValue = document.createElement('span');
    labelValue.className = 'auth-label';
    labelValue.textContent = labelText;
    const input = document.createElement('input');
    input.className = 'auth-input';
    input.name = name;
    input.type = 'password';
    input.autocomplete = name === 'currentPassword' ? 'current-password' : 'new-password';
    const error = document.createElement('small');
    error.className = 'auth-error';
    label.append(labelValue, input, error);
    form.appendChild(label);
    return { name, input, error };
  });
  const message = document.createElement('p');
  message.className = 'auth-message';
  const actions = document.createElement('div');
  actions.className = 'account-actions password-actions';
  const save = document.createElement('button');
  save.className = 'solid-btn';
  save.type = 'submit';
  save.textContent = 'Update Password';
  const cancel = document.createElement('button');
  cancel.className = 'ghost-btn';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());
  actions.append(save, cancel);
  form.append(message, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    fields.forEach((field) => { field.error.textContent = ''; field.input.classList.remove('has-error'); });
    save.disabled = true;
    message.textContent = 'Verifying and updating...';
    try {
      await apiRequest('/api/account/password', {
        method: 'PATCH',
        body: Object.fromEntries(fields.map((field) => [field.name, field.input.value])),
      });
      message.textContent = 'Password updated.';
      setTimeout(() => overlay.remove(), 550);
    } catch (err) {
      const errors = err.payload?.fieldErrors || {};
      fields.forEach((field) => {
        field.error.textContent = errors[field.name] || '';
        field.input.classList.toggle('has-error', !!errors[field.name]);
      });
      message.textContent = err.message || 'Could not update password.';
      save.disabled = false;
    }
  });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  modal.append(heading, copy, form);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  fields[0].input.focus();
}

function createViewingStatsPanel() {
  const section = document.createElement('section');
  section.className = 'viewing-stats-panel';
  const heading = document.createElement('div');
  heading.className = 'viewing-stats-heading';
  heading.innerHTML = '<small>Your screening history</small><h2>Viewing Statistics</h2>';
  const grid = document.createElement('div');
  grid.className = 'viewing-stats-grid';
  grid.innerHTML = '<p class="account-copy">Calculating your viewing history...</p>';
  section.append(heading, grid);
  const userId = currentUser?.id;
  apiRequest('/api/account/stats').then(({ stats }) => {
    if (!document.body.contains(section) || currentUser?.id !== userId) return;
    const entries = [
      [`${Number(stats?.watchedHours || 0).toLocaleString()}h`, 'Time watched'],
      [stats?.moviesWatched || 0, 'Movies watched'],
      [stats?.showsStarted || 0, 'Shows explored'],
      [stats?.episodesWatched || 0, 'Episodes watched'],
    ];
    grid.replaceChildren(...entries.map(([value, label]) => {
      const stat = document.createElement('article');
      stat.className = 'viewing-stat-card';
      stat.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      return stat;
    }));
  }).catch(() => {
    grid.innerHTML = '<p class="account-copy">Viewing statistics are unavailable right now.</p>';
  });
  return section;
}

function renderAccount() {
  content.innerHTML = '';
  statusText.textContent = currentUser ? '' : 'Sign in to sync progress';

  const pageHeading = document.createElement('div');
  pageHeading.className = 'lounge-page-heading';
  pageHeading.innerHTML = '<small>Electric Lounge Membership</small><h2>Account</h2><p>Your private collection, viewing progress and membership controls.</p>';
  content.appendChild(pageHeading);

  const card = document.createElement('div');
  card.className = 'settings-card account-card membership-card';

  const divider = document.createElement('div');
  divider.className = 'account-divider';

  if (!currentUser) {
    const heading = document.createElement('h2');
    heading.className = 'account-title';
    heading.textContent = 'Account';

    const copy = document.createElement('p');
    copy.className = 'account-copy';
    copy.textContent = allowSignup
      ? 'Create an optional account to keep your continue-watching progress synced across devices.'
      : 'Sign in to keep your continue-watching progress synced across devices.';

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
    if (allowSignup) actions.appendChild(signupBtn);
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

    const actions = document.createElement('div');
    actions.className = 'account-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'solid-btn';
    editBtn.textContent = 'Edit Profile';
    editBtn.addEventListener('click', () => {
      const form = document.createElement('form');
      form.className = 'profile-name-editor';
      const firstName = document.createElement('input');
      firstName.className = 'profile-name-input';
      firstName.value = currentUser.firstName || '';
      firstName.placeholder = 'First name';
      firstName.maxLength = 80;
      const lastName = document.createElement('input');
      lastName.className = 'profile-name-input';
      lastName.value = currentUser.lastName || '';
      lastName.placeholder = 'Last name';
      lastName.maxLength = 80;
      const message = document.createElement('span');
      message.className = 'profile-edit-message';
      const save = document.createElement('button');
      save.className = 'solid-btn';
      save.type = 'button';
      save.textContent = 'Save Profile';
      const cancel = document.createElement('button');
      cancel.className = 'ghost-btn';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', renderAccount);
      form.append(firstName, lastName, message);
      save.addEventListener('click', async () => {
        save.disabled = true;
        message.textContent = 'Saving...';
        try {
          const result = await apiRequest('/api/account/profile', {
            method: 'PATCH',
            body: { firstName: firstName.value, lastName: lastName.value },
          });
          currentUser = result.user;
          renderAccount();
        } catch (err) {
          const fields = err.payload?.fieldErrors || {};
          message.textContent = fields.firstName || fields.lastName || err.message || 'Could not update profile.';
          save.disabled = false;
        }
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        save.click();
      });
      heading.replaceWith(form);
      actions.replaceChildren(save, logoutBtn, cancel, passwordBtn);
      firstName.focus();
      firstName.select();
    });

    const passwordBtn = document.createElement('button');
    passwordBtn.className = 'ghost-btn';
    passwordBtn.textContent = 'Change Password';
    passwordBtn.addEventListener('click', openPasswordDialog);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'ghost-btn';
    logoutBtn.textContent = 'Log Out';
    logoutBtn.addEventListener('click', handleAccountLogout);

    actions.append(editBtn, passwordBtn, logoutBtn);
    card.appendChild(heading);
    card.appendChild(email);
    card.appendChild(actions);
  }

  content.appendChild(card);

  if (!currentUser) {
    return;
  }

  content.appendChild(createViewingStatsPanel());

  const favoriteMovies = getMovieItems().filter((item) => isMovieFavorite(item));
  const favoriteShows = getShowGroups().filter((group) => isShowFavorite(group));

  const heading = document.createElement('h2');
  heading.className = 'section-title account-collection-title';
  heading.textContent = 'Your Framed Collection';
  content.appendChild(heading);

  if (!favoriteMovies.length && !favoriteShows.length) {
    const empty = document.createElement('p');
    empty.className = 'account-copy';
    empty.textContent = 'No favorites yet. Tap the heart on a movie or show to save it here.';
    content.appendChild(empty);
    return;
  }

  const grid = createGrid();
  grid.classList.add('account-favorites-grid');
  favoriteMovies.forEach((item) => {
    grid.appendChild(createCard({
      title: item.title || item.name,
      subtitle: '',
      poster: buildPosterUrl(item.posterPath),
      hasCc: Array.isArray(item.subtitles) && item.subtitles.length > 0,
      onClick: () => openMovieDetails(item),
    }));
  });

  favoriteShows.forEach((group) => {
    grid.appendChild(createCard({
      title: group.name,
      subtitle: '',
      poster: buildPosterUrl(group.posterPath),
      hasCc: group.episodes.some((episode) => Array.isArray(episode.subtitles) && episode.subtitles.length > 0),
      onClick: () => openShowDetails(group),
    }));
  });

  content.appendChild(grid);
}

function createAdminScanPanel() {
  const panel = document.createElement('div');
  panel.className = 'settings-card account-card cinema-control-panel library-management-panel';
  const heading = document.createElement('h2');
  heading.className = 'account-title';
  heading.textContent = 'Library Management';
  const copy = document.createElement('p');
  copy.className = 'account-copy';
  copy.textContent = 'Manage the server catalog without changing or writing to your media files.';
  const stats = document.createElement('div');
  stats.className = 'admin-stat-grid';
  const status = document.createElement('p');
  status.className = 'account-copy';
  status.textContent = 'Checking scan status...';
  const metadataStatus = document.createElement('p');
  metadataStatus.className = 'account-copy';
  metadataStatus.textContent = 'Checking metadata status...';
  const actions = document.createElement('div');
  actions.className = 'account-actions admin-library-actions';
  const scanButton = document.createElement('button');
  scanButton.className = 'solid-btn';
  scanButton.textContent = 'Rescan Library';
  const metadataButton = document.createElement('button');
  metadataButton.className = 'ghost-btn';
  metadataButton.textContent = 'Refresh Missing Metadata';
  const catalogButton = document.createElement('button');
  catalogButton.className = 'ghost-btn';
  catalogButton.textContent = 'Manage Catalog';
  catalogButton.addEventListener('click', openCatalogManager);
  const markersButton = document.createElement('button');
  markersButton.className = 'ghost-btn';
  markersButton.textContent = 'Intro & Credits';
  markersButton.addEventListener('click', openPlaybackMarkerManager);
  const dashboardButton = document.createElement('button');
  dashboardButton.className = 'solid-btn';
  dashboardButton.textContent = 'Open Projection Booth';
  dashboardButton.addEventListener('click', () => { window.location.href = '/admin'; });

  const refreshStatus = async () => {
    try {
      const result = await apiRequest('/api/admin/status');
      const scan = result?.scan || {};
      const metadata = result?.metadata || {};
      const catalog = result?.catalog || {};
      const sources = result?.mediaSources || [];
      scanButton.disabled = !!scan.running;
      metadataButton.disabled = !!metadata.running;
      status.textContent = scan.running
        ? `Scanning: ${scan.filesScanned || 0} files checked, ${scan.new || 0} new.`
        : `Last scan: ${scan.filesScanned || 0} checked, ${scan.new || 0} new, ${scan.updated || 0} updated, ${scan.unavailable || 0} unavailable.`;
      metadataStatus.textContent = metadata.running
        ? `Metadata refresh: ${metadata.matched || 0} matched, ${metadata.unmatched || 0} unmatched.`
        : `Last metadata refresh: ${metadata.matched || 0} matched, ${metadata.unmatched || 0} unmatched, ${metadata.failed || 0} failed.`;
      stats.replaceChildren();
      [
        ['Movies', catalog.movies || 0],
        ['Shows', catalog.shows || 0],
        ['Episodes', catalog.episodes || 0],
        ['Sources online', `${sources.filter((source) => source.available).length}/${sources.length}`],
      ].forEach(([label, value]) => {
        const stat = document.createElement('span');
        stat.innerHTML = `<strong>${value}</strong><small>${label}</small>`;
        stats.appendChild(stat);
      });
      return { scanRunning: !!scan.running, metadataRunning: !!metadata.running };
    } catch (err) {
      status.textContent = 'Server library status is unavailable.';
      scanButton.disabled = false;
      metadataButton.disabled = false;
      return { scanRunning: false, metadataRunning: false };
    }
  };

  const pollUntilIdle = async () => {
    const running = await refreshStatus();
    if ((running.scanRunning || running.metadataRunning) && panel.isConnected) {
      setTimeout(pollUntilIdle, 1500);
    } else if (panel.isConnected) {
      await loadLibrary();
    }
  };

  scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    status.textContent = 'Starting server scan...';
    try {
      await apiRequest('/api/admin/library/scan', { method: 'POST' });
      setTimeout(pollUntilIdle, 500);
    } catch (err) {
      status.textContent = err.message || 'Could not start the scan.';
      scanButton.disabled = false;
    }
  });

  metadataButton.addEventListener('click', async () => {
    metadataButton.disabled = true;
    metadataStatus.textContent = 'Starting metadata-only refresh...';
    try {
      await apiRequest('/api/admin/library/metadata/refresh', { method: 'POST' });
      setTimeout(pollUntilIdle, 500);
    } catch (err) {
      metadataStatus.textContent = err.message || 'Could not start metadata refresh.';
      metadataButton.disabled = false;
    }
  });
  actions.append(dashboardButton, scanButton, metadataButton, catalogButton, markersButton);
  panel.append(heading, copy, stats, actions, status, metadataStatus);
  refreshStatus();
  return panel;
}

function createAdminToolDialog(title, description) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay admin-tool-overlay';
  const dialog = document.createElement('section');
  dialog.className = 'admin-tool-dialog';
  const header = document.createElement('div');
  header.className = 'admin-tool-header';
  const copy = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = description;
  copy.append(heading, text);
  const close = document.createElement('button');
  close.className = 'icon-back-btn poster-close-btn';
  close.setAttribute('aria-label', `Close ${title}`);
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  close.addEventListener('click', () => overlay.remove());
  header.append(copy, close);
  const body = document.createElement('div');
  body.className = 'admin-tool-body';
  dialog.append(header, body);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return { overlay, dialog, body };
}

async function setAdminCatalogVisibility(payload, hidden) {
  await apiRequest('/api/admin/library/visibility', {
    method: 'PATCH',
    body: { ...payload, hidden },
  });
  await loadLibrary({ render: false });
}

async function openCatalogManager() {
  const { body } = createAdminToolDialog(
    'Catalog Manager',
    'Remove or restore titles in MyFlix without deleting or changing files on the media drive.'
  );
  const openSections = new Set();
  const render = async () => {
    const scrollTop = body.scrollTop;
    body.innerHTML = '<p class="admin-tool-status">Loading catalog...</p>';
    try {
      const result = await apiRequest('/api/admin/library/manage');
      const library = result.library || { movies: [], shows: [] };
      body.replaceChildren();
      const toolbar = document.createElement('div');
      toolbar.className = 'admin-tool-toolbar';
      const removeAll = document.createElement('button');
      removeAll.className = 'ghost-btn danger-btn';
      removeAll.textContent = 'Remove Entire Catalog';
      removeAll.addEventListener('click', async () => {
        if (!window.confirm('Remove every movie and show from MyFlix? Media files will remain untouched and can be restored here.')) return;
        await setAdminCatalogVisibility({ scope: 'all' }, true);
        await render();
      });
      const restoreAll = document.createElement('button');
      restoreAll.className = 'ghost-btn';
      restoreAll.textContent = 'Restore Entire Catalog';
      restoreAll.addEventListener('click', async () => {
        await setAdminCatalogVisibility({ scope: 'all' }, false);
        await render();
      });
      toolbar.append(removeAll, restoreAll);
      body.appendChild(toolbar);

      const movieHeading = document.createElement('h3');
      movieHeading.className = 'admin-tool-section-title';
      movieHeading.textContent = 'Movies';
      body.appendChild(movieHeading);
      library.movies.forEach((movie) => {
        body.appendChild(createCatalogManagerRow(
          movie.title,
          `${movie.subtitleCount} subtitle file(s)`,
          movie.hidden,
          async (hidden) => {
            await setAdminCatalogVisibility({ scope: 'movie', id: movie.id }, hidden);
            await render();
          }
        ));
      });

      const showHeading = document.createElement('h3');
      showHeading.className = 'admin-tool-section-title';
      showHeading.textContent = 'TV Shows';
      body.appendChild(showHeading);
      library.shows.forEach((show) => {
        const showDetails = document.createElement('details');
        showDetails.className = 'admin-tree-section';
        showDetails.dataset.key = `show:${show.id}`;
        showDetails.open = openSections.has(showDetails.dataset.key);
        showDetails.addEventListener('toggle', () => {
          if (showDetails.open) openSections.add(showDetails.dataset.key);
          else openSections.delete(showDetails.dataset.key);
        });
        const summary = document.createElement('summary');
        summary.appendChild(createCatalogManagerRow(
          show.title,
          `${show.seasons.length} season(s)`,
          show.hidden,
          async (hidden) => {
            await setAdminCatalogVisibility({ scope: 'show', id: show.id }, hidden);
            await render();
          }
        ));
        showDetails.appendChild(summary);
        show.seasons.forEach((season) => {
          const seasonDetails = document.createElement('details');
          seasonDetails.className = 'admin-tree-season';
          seasonDetails.dataset.key = `season:${show.id}:${season.number}`;
          seasonDetails.open = openSections.has(seasonDetails.dataset.key);
          seasonDetails.addEventListener('toggle', () => {
            if (seasonDetails.open) openSections.add(seasonDetails.dataset.key);
            else openSections.delete(seasonDetails.dataset.key);
          });
          const seasonSummary = document.createElement('summary');
          const allHidden = season.episodes.every((episode) => episode.hidden);
          seasonSummary.appendChild(createCatalogManagerRow(
            `Season ${season.number}`,
            `${season.episodes.length} episode(s)`,
            allHidden,
            async (hidden) => {
              await setAdminCatalogVisibility({ scope: 'season', showId: show.id, season: season.number }, hidden);
              await render();
            }
          ));
          seasonDetails.appendChild(seasonSummary);
          season.episodes.forEach((episode) => {
            const code = `E${String(episode.episode || 0).padStart(2, '0')}${episode.episodeEnd ? `-E${String(episode.episodeEnd).padStart(2, '0')}` : ''}`;
            seasonDetails.appendChild(createCatalogManagerRow(
              `${code}: ${episode.title}`,
              `${episode.subtitleCount} subtitle file(s)`,
              episode.hidden,
              async (hidden) => {
                await setAdminCatalogVisibility({ scope: 'episode', id: episode.id }, hidden);
                await render();
              }
            ));
          });
          showDetails.appendChild(seasonDetails);
        });
        body.appendChild(showDetails);
      });
      const subtitleNote = document.createElement('p');
      subtitleNote.className = 'admin-tool-note';
      subtitleNote.textContent = 'Subtitle files are discovered from the read-only media drive. Their inventory is shown here; MyFlix never deletes those files.';
      body.appendChild(subtitleNote);
      body.scrollTop = scrollTop;
    } catch (err) {
      body.innerHTML = `<p class="admin-tool-status error">${err.message || 'Could not load catalog tools.'}</p>`;
    }
  };
  await render();
}

function createCatalogManagerRow(title, subtitle, hidden, onToggle) {
  const row = document.createElement('div');
  row.className = `admin-manager-row${hidden ? ' is-hidden' : ''}`;
  const copy = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = title;
  const note = document.createElement('small');
  note.textContent = subtitle;
  copy.append(name, note);
  const action = document.createElement('button');
  action.className = hidden ? 'ghost-btn' : 'ghost-btn danger-btn';
  action.textContent = hidden ? 'Restore' : 'Remove';
  action.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    action.disabled = true;
    await onToggle(!hidden);
  });
  row.append(copy, action);
  return row;
}

function markerTimeInputs(label, seconds) {
  const hasValue = seconds !== null && seconds !== undefined && Number.isFinite(Number(seconds));
  const total = hasValue ? Math.max(0, Math.round(Number(seconds))) : 0;
  const row = document.createElement('label');
  row.className = 'marker-time-row';
  const text = document.createElement('span');
  text.textContent = label;
  const fields = ['Hours', 'Minutes', 'Seconds'].map((placeholder, index) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = index === 0 ? '99' : '59';
    input.placeholder = placeholder;
    input.value = hasValue
      ? String(index === 0 ? Math.floor(total / 3600) : index === 1 ? Math.floor((total % 3600) / 60) : total % 60)
      : '';
    return input;
  });
  const group = document.createElement('span');
  group.className = 'marker-time-fields';
  fields.forEach((field) => group.appendChild(field));
  row.append(text, group);
  return {
    row,
    value: () => fields.every((field) => field.value === '')
      ? null
      : fields.reduce((sum, field, index) => sum + Math.max(0, Number(field.value) || 0) * [3600, 60, 1][index], 0),
  };
}

async function openPlaybackMarkerManager() {
  const { body } = createAdminToolDialog(
    'Intro & Credits',
    'Choose a show, season, and episode. Times are stored in SQLite and enable Skip Intro and Next Episode.'
  );
  try {
    const result = await apiRequest('/api/admin/library/manage');
    const shows = result.library?.shows || [];
    const renderTree = () => {
      body.replaceChildren();
      shows.forEach((show) => {
      const showDetails = document.createElement('details');
      showDetails.className = 'admin-tree-section marker-tree';
      const summary = document.createElement('summary');
      summary.textContent = show.title;
      showDetails.appendChild(summary);
      show.seasons.forEach((season) => {
        const seasonDetails = document.createElement('details');
        seasonDetails.className = 'admin-tree-season marker-tree';
        const seasonSummary = document.createElement('summary');
        seasonSummary.textContent = `Season ${season.number}`;
        seasonDetails.appendChild(seasonSummary);
        season.episodes.forEach((episode) => {
          const button = document.createElement('button');
          button.className = 'marker-episode-button';
          const hasMarkers = Number.isFinite(episode.playbackMarkers?.introEnd) || Number.isFinite(episode.playbackMarkers?.creditsStart);
          const episodeName = document.createElement('strong');
          episodeName.textContent = `E${String(episode.episode || 0).padStart(2, '0')} ${episode.title}`;
          const markerStatus = document.createElement('small');
          markerStatus.textContent = hasMarkers ? 'Markers assigned' : 'No markers yet';
          button.append(episodeName, markerStatus);
          button.addEventListener('click', () => renderMarkerEditor(body, show, season, episode, renderTree));
          seasonDetails.appendChild(button);
        });
        showDetails.appendChild(seasonDetails);
      });
      body.appendChild(showDetails);
      });
    };
    renderTree();
  } catch (err) {
    body.textContent = err.message || 'Could not load playback marker tools.';
  }
}

function renderMarkerEditor(body, show, season, episode, onBack) {
  body.replaceChildren();
  const back = document.createElement('button');
  back.className = 'icon-back-btn detail-back-btn';
  back.setAttribute('aria-label', 'Back to episodes');
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  back.addEventListener('click', onBack);
  const heading = document.createElement('h3');
  heading.textContent = `${show.title} / Season ${season.number} / Episode ${episode.episode}`;
  const introStart = markerTimeInputs('Intro starts', episode.playbackMarkers?.introStart);
  const introEnd = markerTimeInputs('Intro ends', episode.playbackMarkers?.introEnd);
  const creditsStart = markerTimeInputs('Credits start', episode.playbackMarkers?.creditsStart);
  const actions = document.createElement('div');
  actions.className = 'admin-tool-toolbar';
  const save = document.createElement('button');
  save.className = 'solid-btn';
  save.textContent = 'Save Markers';
  const clear = document.createElement('button');
  clear.className = 'ghost-btn';
  clear.textContent = 'Clear Markers';
  const message = document.createElement('p');
  message.className = 'admin-tool-status';
  const submit = async (markers) => {
    try {
      await apiRequest(`/api/admin/media/${episode.id}/playback-markers`, { method: 'PATCH', body: markers });
      await loadLibrary({ render: false });
      message.textContent = 'Markers saved.';
    } catch (err) {
      message.textContent = err.message || 'Could not save markers.';
    }
  };
  save.addEventListener('click', () => submit({
    introStart: introStart.value(),
    introEnd: introEnd.value(),
    creditsStart: creditsStart.value(),
  }));
  clear.addEventListener('click', () => submit({ introStart: null, introEnd: null, creditsStart: null }));
  actions.append(save, clear);
  body.append(back, heading, introStart.row, introEnd.row, creditsStart.row, actions, message);
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
    allowSignup = result?.allowSignup !== false;
  } catch (err) {
    currentUser = null;
  }
}

async function loadLibrary({ render = true } = {}) {
  statusText.textContent = 'Loading library...';
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    libraryItems = normalizeEpisodeRangesInLibrary(await res.json());
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
  const key = item.id || normalize(item.title || item.name);
  if (movieDetailCache.has(key)) return movieDetailCache.get(key);
  const details = {
    id: item.tmdbId,
    title: item.title || item.name,
    poster_path: item.posterPath,
    backdrop_path: item.backdropPath,
    overview: item.overview,
    release_date: item.releaseDate,
    vote_average: item.rating,
    runtime: item.runtime,
    genres: (item.genreNames || []).map((name) => ({ name })),
  };
  const credits = item.tmdbId
    ? await apiGet(`/api/tmdb/movie/${item.tmdbId}/credits`).catch(() => null)
    : null;
  const result = { details, credits };
  movieDetailCache.set(key, result);
  return result;
}

async function fetchMovieVideos(item) {
  if (item.tmdbId) return apiGet(`/api/tmdb/movie/${item.tmdbId}/videos`);
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

  const details = {
    id: group.tmdbId,
    name: group.name,
    poster_path: group.posterPath,
    backdrop_path: group.backdropPath,
    overview: group.overview,
    first_air_date: group.releaseDate,
    vote_average: group.rating,
    episode_run_time: group.runtime ? [group.runtime] : [],
    genres: (group.genreNames || []).map((name) => ({ name })),
  };
  const credits = group.tmdbId
    ? await apiGet(`/api/tmdb/tv/${group.tmdbId}/credits`).catch(() => null)
    : null;
  const result = { details, credits };
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

function areCompanionEpisodeParts(firstTitle, secondTitle) {
  const firstPart = getEpisodePartNumber(firstTitle);
  const secondPart = getEpisodePartNumber(secondTitle);
  if (firstPart !== 1 || secondPart !== 2) return false;
  const firstBase = stripEpisodePartSuffix(firstTitle);
  const secondBase = stripEpisodePartSuffix(secondTitle);
  return !!firstBase && firstBase.toLowerCase() === secondBase.toLowerCase();
}

async function fetchEpisodeDetailsSummary(showId, episodeInfo, options = {}) {
  if (!showId || !episodeInfo?.season || !episodeInfo?.episode) return null;
  const sourceTitle = getEpisodeTitleText(options?.sourceName || options?.title || '');
  let effectiveEpisodeInfo = inferEpisodeRange(episodeInfo, sourceTitle, options?.siblingEpisodes || []);
  const startEpisode = effectiveEpisodeInfo.episode;
  let endEpisode = Number.isFinite(effectiveEpisodeInfo?.episodeEnd) && effectiveEpisodeInfo.episodeEnd > startEpisode
    ? effectiveEpisodeInfo.episodeEnd
    : startEpisode;

  const detailsList = (await Promise.all(
    Array.from({ length: endEpisode - startEpisode + 1 }, (_value, index) =>
      fetchEpisodeDetails(showId, effectiveEpisodeInfo.season, startEpisode + index))
  )).filter(Boolean);

  if (!detailsList.length) return null;
  if (endEpisode === startEpisode) {
    const firstDetails = detailsList[0];
    const firstTitle = String(firstDetails?.name || sourceTitle || '').trim();
    if (getEpisodePartNumber(firstTitle) === 1) {
      const nextDetails = await fetchEpisodeDetails(showId, effectiveEpisodeInfo.season, startEpisode + 1);
      if (nextDetails && areCompanionEpisodeParts(firstTitle, nextDetails?.name || '')) {
        detailsList.push(nextDetails);
        endEpisode = startEpisode + 1;
        effectiveEpisodeInfo = {
          ...effectiveEpisodeInfo,
          episodeEnd: endEpisode,
        };
      }
    }
  }

  if (detailsList.length === 1) {
    return {
      ...detailsList[0],
      episodeEnd: effectiveEpisodeInfo?.episodeEnd || null,
    };
  }

  const names = detailsList.map((item) => String(item?.name || '').trim()).filter(Boolean);
  const overviews = detailsList.map((item) => String(item?.overview || '').trim()).filter(Boolean);
  const runtimes = detailsList.map((item) => Number(item?.runtime)).filter(Number.isFinite);
  const ratings = detailsList.map((item) => Number(item?.vote_average)).filter((value) => Number.isFinite(value) && value > 0);
  const voteCounts = detailsList.map((item) => Number(item?.vote_count)).filter(Number.isFinite);

  return {
    ...detailsList[0],
    name: names.join(' / '),
    overview: overviews.join(' / '),
    runtime: runtimes.length ? runtimes.reduce((sum, value) => sum + value, 0) : null,
    vote_average: ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length) : null,
    vote_count: voteCounts.length ? voteCounts.reduce((sum, value) => sum + value, 0) : 0,
    still_path: detailsList.find((item) => item?.still_path)?.still_path || detailsList[0]?.still_path || null,
    episodeEnd: effectiveEpisodeInfo?.episodeEnd || null,
  };
}

async function refreshDetailAfterMetadata(targetType, targetId) {
  movieDetailCache.clear();
  showDetailCache.clear();
  episodeDetailCache.clear();
  await loadLibrary({ render: false });
  if (targetType === 'movie') {
    const item = libraryItems.find((entry) => entry.id === targetId);
    if (item) await openMovieDetails(item);
    return;
  }
  const group = getShowGroups().find((entry) => entry.id === targetId || entry.key === `show:${targetId}`);
  if (group) await openShowDetails(group);
}

function openMetadataFixDialog(targetType, target) {
  const targetId = targetType === 'show' ? target.id : target.id;
  const initialTitle = targetType === 'show' ? target.name : (target.title || target.name);
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay metadata-overlay';
  const dialog = document.createElement('section');
  dialog.className = 'metadata-dialog';
  const header = document.createElement('div');
  header.className = 'metadata-dialog-header';
  const heading = document.createElement('div');
  heading.innerHTML = `<small>TMDB Programme Desk</small><h2>Fix Metadata</h2>`;
  const close = document.createElement('button');
  close.className = 'ghost-btn';
  close.textContent = 'Close';
  close.addEventListener('click', () => overlay.remove());
  header.append(heading, close);

  const searchRow = document.createElement('form');
  searchRow.className = 'metadata-search-row';
  const input = document.createElement('input');
  input.className = 'auth-input';
  input.value = initialTitle || '';
  input.placeholder = targetType === 'show' ? 'Search TV shows...' : 'Search movies...';
  const searchButton = document.createElement('button');
  searchButton.className = 'solid-btn';
  searchButton.textContent = 'Search TMDB';
  searchRow.append(input, searchButton);

  const message = document.createElement('p');
  message.className = 'metadata-dialog-message';
  const results = document.createElement('div');
  results.className = 'metadata-results';
  const footer = document.createElement('div');
  footer.className = 'metadata-dialog-footer';
  const reset = document.createElement('button');
  reset.className = 'ghost-btn';
  reset.textContent = 'Clear Manual Match';
  const retry = document.createElement('button');
  retry.className = 'ghost-btn';
  retry.textContent = 'Retry Automatic Match';
  footer.append(reset, retry);

  const setBusy = (busy, text = '') => {
    searchButton.disabled = busy;
    reset.disabled = busy;
    retry.disabled = busy;
    message.textContent = text;
  };

  const loadResults = async () => {
    setBusy(true, 'Searching the TMDB catalogue...');
    results.replaceChildren();
    try {
      const response = await apiGet('/api/admin/metadata/search', {
        type: targetType,
        id: targetId,
        q: input.value.trim(),
      });
      const candidates = response?.results || [];
      message.textContent = candidates.length
        ? 'Choose the exact title. Your selection will be locked against automatic scans.'
        : 'No candidates were found. Try a shorter title or include the release year.';
      for (const candidate of candidates) {
        const card = document.createElement('article');
        card.className = 'metadata-result-card';
        const posterWrap = document.createElement('div');
        posterWrap.className = 'metadata-result-poster';
        const image = document.createElement('img');
        image.alt = candidate.title || 'TMDB poster';
        const fallback = createImageFallback(posterWrap, candidate.title, 'poster-fallback compact');
        bindImageFallback(image, fallback, candidate.posterPath ? `${TMDB_IMG}${candidate.posterPath}` : '');
        posterWrap.insertBefore(image, posterWrap.firstChild);
        const body = document.createElement('div');
        body.className = 'metadata-result-body';
        const title = document.createElement('h3');
        title.textContent = candidate.title || 'Untitled';
        const facts = document.createElement('p');
        facts.textContent = [candidate.year, candidate.originalTitle && candidate.originalTitle !== candidate.title ? candidate.originalTitle : '', Number.isFinite(candidate.rating) ? `${candidate.rating.toFixed(1)}/10` : '']
          .filter(Boolean).join('  /  ');
        const overview = document.createElement('p');
        overview.textContent = candidate.overview || 'No synopsis available.';
        const choose = document.createElement('button');
        choose.className = 'solid-btn';
        choose.textContent = 'Use This Match';
        choose.addEventListener('click', async () => {
          setBusy(true, `Saving ${candidate.title}...`);
          try {
            await apiRequest('/api/admin/metadata/match', {
              method: 'POST',
              body: { targetType, targetId, tmdbId: candidate.id },
            });
            overlay.remove();
            await refreshDetailAfterMetadata(targetType, targetId);
          } catch (err) {
            setBusy(false, err.message || 'Could not save this match.');
          }
        });
        body.append(title, facts, overview, choose);
        card.append(posterWrap, body);
        results.appendChild(card);
      }
    } catch (err) {
      message.textContent = err.message || 'TMDB search failed.';
    } finally {
      searchButton.disabled = false;
      reset.disabled = false;
      retry.disabled = false;
    }
  };

  searchRow.addEventListener('submit', (event) => {
    event.preventDefault();
    loadResults();
  });
  reset.addEventListener('click', async () => {
    setBusy(true, 'Clearing the manual match...');
    try {
      await apiRequest('/api/admin/metadata/match', { method: 'DELETE', body: { targetType, targetId } });
      overlay.remove();
      await refreshDetailAfterMetadata(targetType, targetId);
    } catch (err) {
      setBusy(false, err.message || 'Could not clear this match.');
    }
  });
  retry.addEventListener('click', async () => {
    setBusy(true, 'Trying the conservative automatic matcher...');
    try {
      const response = await apiRequest('/api/admin/metadata/retry', { method: 'POST', body: { targetType, targetId } });
      if (!response.ok && response.state === 'unmatched') {
        setBusy(false, 'No unambiguous automatic match was found. Choose one manually below.');
        await loadResults();
        return;
      }
      overlay.remove();
      await refreshDetailAfterMetadata(targetType, targetId);
    } catch (err) {
      setBusy(false, err.message || 'Automatic matching failed.');
    }
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  dialog.append(header, searchRow, message, results, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  loadResults();
}

async function refreshOpenDetailPoster(targetType, targetId) {
  await loadLibrary({ render: false });
  if (targetType === 'movie') {
    const item = libraryItems.find((entry) => entry.id === targetId);
    if (item) detailState = { ...detailState, item };
  } else {
    const group = getShowGroups().find((entry) => entry.id === targetId);
    if (group) detailState = { ...detailState, group };
  }
  renderCurrentView();
}

function openPosterDialog(targetType, target) {
  if (!currentUser) return;
  const targetId = targetType === 'show' ? target.id : target.id;
  const tmdbId = target.tmdbId;
  const targetBody = targetType === 'show' ? { showId: targetId } : { mediaId: targetId };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay poster-dialog-overlay';
  const dialog = document.createElement('section');
  dialog.className = 'poster-picker-dialog is-compact';
  const header = document.createElement('div');
  header.className = 'poster-picker-header';
  const heading = document.createElement('div');
  heading.innerHTML = `<small>Personal artwork</small><h2>Edit Poster</h2>`;
  const close = document.createElement('button');
  close.className = 'icon-back-btn poster-close-btn';
  close.setAttribute('aria-label', 'Close poster picker');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  header.append(heading, close);
  const actions = document.createElement('div');
  actions.className = 'poster-picker-actions';
  const upload = document.createElement('button');
  upload.className = 'solid-btn';
  upload.textContent = 'Upload Custom Poster';
  const choose = document.createElement('button');
  choose.className = 'ghost-btn';
  choose.textContent = 'Choose from TMDB';
  choose.disabled = !tmdbId;
  const reset = document.createElement('button');
  reset.className = 'ghost-btn poster-reset-btn';
  reset.textContent = 'Reset to Original';
  reset.hidden = !(target.customPosterTmdbPath || target.customPosterPath);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  fileInput.hidden = true;
  const message = document.createElement('p');
  message.className = 'poster-picker-message';
  message.textContent = tmdbId ? 'Choose artwork for this account only.' : 'Upload artwork, or fix the TMDB match to browse TMDB posters.';
  const results = document.createElement('div');
  results.className = 'poster-picker-grid';

  const finish = async () => {
    overlay.remove();
    await refreshOpenDetailPoster(targetType, targetId);
  };
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  upload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      message.textContent = 'Poster files must be smaller than 8 MB.';
      return;
    }
    upload.disabled = true;
    message.textContent = 'Uploading poster...';
    try {
      const response = await fetch(`/api/account/poster-upload?type=${targetType}&id=${encodeURIComponent(targetId)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not upload poster.');
      await finish();
    } catch (err) {
      message.textContent = err.message || 'Could not upload poster.';
      upload.disabled = false;
    }
  });
  choose.addEventListener('click', async () => {
    choose.disabled = true;
    dialog.classList.remove('is-compact');
    dialog.classList.add('has-results');
    message.textContent = 'Loading TMDB posters...';
    results.replaceChildren();
    try {
      const mediaPath = targetType === 'show' ? 'tv' : 'movie';
      const payload = await apiGet(`/api/tmdb/${mediaPath}/${tmdbId}/images`);
      const posters = (payload?.posters || []).filter((poster) => poster?.file_path).slice(0, 24);
      if (!posters.length) message.textContent = 'No alternate posters were found.';
      else message.textContent = 'Select a poster to use for this account.';
      posters.forEach((poster) => {
        const button = document.createElement('button');
        button.className = 'poster-choice';
        const image = document.createElement('img');
        image.src = buildPosterUrl(poster.file_path);
        image.alt = 'TMDB poster option';
        image.loading = 'lazy';
        button.appendChild(image);
        button.addEventListener('click', async () => {
          button.disabled = true;
          await apiRequest('/api/account/poster', {
            method: 'POST',
            body: { ...targetBody, tmdbPath: poster.file_path },
          });
          await finish();
        });
        results.appendChild(button);
      });
    } catch (err) {
      message.textContent = /route not found/i.test(err.message || '')
        ? 'The server has the older poster API loaded. Restart npm run server, then try again.'
        : (err.message || 'Could not load TMDB posters.');
    } finally {
      choose.disabled = !tmdbId;
    }
  });
  reset.addEventListener('click', async () => {
    reset.disabled = true;
    await apiRequest('/api/account/poster', { method: 'DELETE', body: targetBody });
    await finish();
  });
  actions.append(upload, choose, reset, fileInput);
  dialog.append(header, actions, message, results);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function renderDetailHeader(title, onBack) {
  const actions = document.createElement('div');
  actions.className = 'actions';

  const back = document.createElement('button');
  back.className = 'ghost-btn icon-back-btn detail-back-btn';
  back.setAttribute('aria-label', 'Back');
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  back.addEventListener('click', onBack);
  actions.appendChild(back);

  const heading = document.createElement('p');
  heading.className = 'status';
  heading.textContent = title;

  return { actions, heading };
}

function createDetailsDisclosure(metaGrid) {
  const disclosure = document.createElement('details');
  disclosure.className = 'mobile-details-disclosure';
  disclosure.open = !isMobileLayout();
  const summary = document.createElement('summary');
  summary.innerHTML = '<span>Cast and details</span><span class="details-disclosure-icon" aria-hidden="true"></span>';
  disclosure.append(summary, metaGrid);
  return disclosure;
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
  card.className = 'detail-card electric-private-room';
  const backdrop = item.backdropPath || meta?.details?.backdrop_path;
  if (backdrop) card.style.setProperty('--detail-backdrop', `url("${buildBackdropUrl(backdrop, 1280)}")`);

  const posterFrame = document.createElement('div');
  posterFrame.className = 'detail-poster-frame';

  const img = document.createElement('img');
  img.className = 'detail-poster';
  img.alt = item.title || item.name || 'Poster';
  const posterFallback = createImageFallback(posterFrame, item.title || item.name, 'poster-fallback detail-fallback');
  bindImageFallback(img, posterFallback, buildPosterUrl(item.posterPath || meta?.details?.poster_path));
  img.addEventListener('load', () => {
    if (img.naturalWidth && img.naturalHeight) posterFrame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  });
  posterFrame.insertBefore(img, posterFrame.firstChild);

  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';

  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = meta?.details?.title || item.title || item.name || 'Movie';
  titleRow.appendChild(title);

  if (item.metadataLocked) {
    const lock = document.createElement('span');
    lock.className = 'details-brass-badge';
    lock.textContent = 'Manual Match';
    titleRow.appendChild(lock);
  }

  const rating = createRatingStars(meta?.details?.vote_average);
  if (rating) titleRow.appendChild(rating);

  const year = (meta?.details?.release_date || '').slice(0, 4);

  const overview = document.createElement('p');
  overview.className = 'detail-text';
  overview.textContent = meta?.details?.overview || 'No description available.';

  const director = meta?.credits?.crew?.find((person) => person.job === 'Director');
  const runtime = meta?.details?.runtime;
  const genres = meta?.details?.genres?.map((g) => g.name).join(', ');
  const cast = meta?.credits?.cast?.slice(0, 8) || [];
  const directorGroup = createPeopleGroup('Director', director ? [director] : []);

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
  const detailsDisclosure = createDetailsDisclosure(metaGrid);

  const play = document.createElement('button');
  play.className = 'solid-btn details-play-primary';
  play.innerHTML = `${getPlayerIconSvg('play')}<span>Play</span>`;
  play.addEventListener('click', () => beginPlayback(() => openPlayer(item)));

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
    const editPoster = document.createElement('button');
    editPoster.className = 'ghost-btn poster-edit-btn';
    editPoster.textContent = 'Edit Poster';
    editPoster.addEventListener('click', () => openPosterDialog('movie', item));
    actionRow.appendChild(editPoster);
    actionRow.appendChild(createFavoriteButton(isMovieFavorite(item), async () => {
      try {
        const nextFavorite = !isMovieFavorite(item);
        await setMovieFavorite(item, nextFavorite);
        const refreshed = libraryItems.find((entry) => entry.id === item.id) || item;
        detailState = { ...detailState, item: refreshed };
        renderMovieDetailCard(refreshed, meta);
      } catch (err) {
        setPlayerStatus('Could not update favorites right now.', true);
      }
    }));
  }
  if (currentUser?.isAdmin) {
    const fixMetadata = document.createElement('button');
    fixMetadata.className = 'ghost-btn metadata-fix-btn';
    fixMetadata.textContent = item.metadataLocked ? 'Change Match' : 'Fix Metadata';
    fixMetadata.addEventListener('click', () => openMetadataFixDialog('movie', item));
    actionRow.appendChild(fixMetadata);
  }

  body.appendChild(titleRow);
  body.appendChild(overview);
  body.appendChild(separator);
  body.appendChild(detailsDisclosure);
  body.appendChild(actionRow);

  card.appendChild(posterFrame);
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
  card.className = 'detail-card electric-private-room';
  const backdrop = group.backdropPath || meta?.details?.backdrop_path;
  if (backdrop) card.style.setProperty('--detail-backdrop', `url("${buildBackdropUrl(backdrop, 1280)}")`);

  const posterFrame = document.createElement('div');
  posterFrame.className = 'detail-poster-frame';

  const img = document.createElement('img');
  img.className = 'detail-poster';
  img.alt = group.name || 'Show poster';
  const posterFallback = createImageFallback(posterFrame, group.name, 'poster-fallback detail-fallback');
  bindImageFallback(img, posterFallback, buildPosterUrl(group.posterPath || meta?.details?.poster_path));
  img.addEventListener('load', () => {
    if (img.naturalWidth && img.naturalHeight) posterFrame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  });
  posterFrame.insertBefore(img, posterFrame.firstChild);

  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';

  const title = document.createElement('h2');
  title.className = 'detail-title';
  title.textContent = meta?.details?.name || group.name || 'TV Show';
  titleRow.appendChild(title);

  if (group.metadataLocked) {
    const lock = document.createElement('span');
    lock.className = 'details-brass-badge';
    lock.textContent = 'Manual Match';
    titleRow.appendChild(lock);
  }

  const rating = createRatingStars(meta?.details?.vote_average);
  if (rating) titleRow.appendChild(rating);

  const year = (meta?.details?.first_air_date || '').slice(0, 4);

  const overview = document.createElement('p');
  overview.className = 'detail-text';
  overview.textContent = meta?.details?.overview || 'No description available.';

  const director =
    meta?.credits?.crew?.find((person) => person.job === 'Director')
    || meta?.credits?.crew?.find((person) => person.department === 'Directing');
  const cast = meta?.credits?.cast?.slice(0, 8) || [];
  const directorGroup = createPeopleGroup('Director', director ? [director] : []);
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
  const detailsDisclosure = createDetailsDisclosure(metaGrid);

  const actionRow = document.createElement('div');
  actionRow.className = 'actions';
  if (currentUser) {
    const editPoster = document.createElement('button');
    editPoster.className = 'ghost-btn poster-edit-btn';
    editPoster.textContent = 'Edit Poster';
    editPoster.addEventListener('click', () => openPosterDialog('show', group));
    actionRow.appendChild(editPoster);
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
  if (currentUser?.isAdmin) {
    const fixMetadata = document.createElement('button');
    fixMetadata.className = 'ghost-btn metadata-fix-btn';
    fixMetadata.textContent = group.metadataLocked ? 'Change Match' : 'Fix Metadata';
    fixMetadata.addEventListener('click', () => openMetadataFixDialog('show', group));
    actionRow.appendChild(fixMetadata);
  }

  body.appendChild(titleRow);
  body.appendChild(overview);
  body.appendChild(separator);
  body.appendChild(detailsDisclosure);
  if (actionRow.childElementCount) {
    body.appendChild(actionRow);
  }

  card.appendChild(posterFrame);
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
      const effectiveEpisode = inferEpisodeRange(episode.episode, getEpisodeTitleText(episode.name), seasonEpisodes);
      const episodeView = effectiveEpisode === episode.episode ? episode : { ...episode, episode: effectiveEpisode };
      const row = document.createElement('div');
      row.className = 'episode-row';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'episode-thumb-wrap';

      const thumb = document.createElement('img');
      thumb.className = 'episode-thumb';
      thumb.alt = `${formatEpisodeLabel(episodeView)} thumbnail`;
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
      label.textContent = formatEpisodeLabel(episodeView);

      const overview = document.createElement('p');
      overview.className = 'episode-overview';
      overview.textContent = 'Episode details loading...';

      const episodeWatchPercent = getWatchPercent(episode);
      let progressWrap = null;
      if (episodeWatchPercent > 0) {
        progressWrap = document.createElement('div');
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
      }

      const metaBox = document.createElement('span');
      metaBox.className = 'episode-meta';

      const ratingPlaceholder = document.createElement('span');
      ratingPlaceholder.className = 'episode-meta-note';
      ratingPlaceholder.textContent = 'No reliable rating';

      const runtime = document.createElement('span');
      runtime.className = 'episode-runtime';
      runtime.textContent = '-- min';

      metaBox.appendChild(ratingPlaceholder);
      metaBox.appendChild(runtime);

      const play = document.createElement('button');
      play.className = 'episode-play';
      play.innerHTML = `${getPlayerIconSvg('play')}<span>Play</span>`;
      play.addEventListener('click', () => beginPlayback(() => openPlayer(episodeView)));

      left.appendChild(label);
      if (progressWrap) left.appendChild(progressWrap);
      left.appendChild(overview);

      row.appendChild(thumbWrap);
      row.appendChild(left);
      row.appendChild(metaBox);
      row.appendChild(play);
      episodeList.appendChild(row);

      if (!showId || !effectiveEpisode?.season || !effectiveEpisode?.episode) return;

      fetchEpisodeDetailsSummary(showId, effectiveEpisode, {
        sourceName: episode.name,
        siblingEpisodes: seasonEpisodes,
      })
        .then((episodeMeta) => {
          if (!episodeMeta || !document.body.contains(row)) return;

          metaBox.innerHTML = '';
          const episodeRating = hasReliableEpisodeRating(episodeMeta)
            ? createRatingStars(episodeMeta.vote_average)
            : null;
          if (episodeRating) {
            metaBox.appendChild(episodeRating);
          } else {
            const noRating = document.createElement('span');
            noRating.className = 'episode-meta-note';
            noRating.textContent = 'No reliable rating';
            metaBox.appendChild(noRating);
          }

          const runtimeValue = episodeMeta.runtime || episode.runtime;
          runtime.textContent = runtimeValue ? `${runtimeValue} min` : '-- min';
          metaBox.appendChild(runtime);
          const episodeTitle = String(episodeMeta.name || getEpisodeTitleText(episode.name) || '').trim();
          label.textContent = episodeTitle
            ? `${formatEpisode(episodeView)}: ${episodeTitle}`
            : formatEpisode(episodeView);
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
  const hide = currentView === 'account' || currentView === 'settings' || !!detailState;
  searchInput.style.display = hide ? 'none' : '';
  const hideMobileActions = isMobileLayout() && !!detailState;
  movieNightBtn.style.display = hideMobileActions ? 'none' : '';
  suggestionBtn.style.display = hideMobileActions ? 'none' : '';
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
  if (currentView === 'settings') {
    renderSettings();
    return;
  }
  renderAccount();
}

function scheduleRenderCurrentView() {
  window.requestAnimationFrame(() => {
    renderCurrentView();
  });
}

function destroyAdaptivePlayback() {
  qualityRequestToken += 1;
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
}

function updateQualityButton(label) {
  selectedPlaybackQuality = label || 'Original';
  qualityButtonLabel.textContent = selectedPlaybackQuality === 'Original' ? 'SRC' : selectedPlaybackQuality === 'Auto' ? 'AUTO' : selectedPlaybackQuality.replace('p', '');
  qualityBtn.setAttribute('aria-label', `Playback quality: ${selectedPlaybackQuality}`);
  qualityMenu.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === selectedPlaybackQuality);
  });
}

function renderQualityMenu(options = null) {
  qualityMenu.innerHTML = '';
  if (!options?.hlsAvailable) {
    const unavailable = document.createElement('span');
    unavailable.className = 'quality-menu-note';
    unavailable.textContent = options ? 'Original quality only' : 'Checking server...';
    qualityMenu.appendChild(unavailable);
    qualityBtn.disabled = !options;
    return;
  }
  qualityBtn.disabled = false;
  const choices = [
    { label: 'Original', detail: 'Direct play' },
    { label: 'Auto', detail: 'Best for connection' },
    ...(options.qualities || []).map((quality) => ({ label: quality.label, detail: 'Adaptive stream' })),
  ];
  choices.forEach((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.quality = choice.label;
    button.innerHTML = `<strong>${choice.label}</strong><small>${choice.detail}</small>`;
    button.addEventListener('click', () => selectPlaybackQuality(choice.label));
    qualityMenu.appendChild(button);
  });
  updateQualityButton(selectedPlaybackQuality);
}

function restoreDirectPlayback() {
  if (!currentPlayerItem) return;
  const resumeAt = Number(player.currentTime) || 0;
  const shouldPlay = !player.paused;
  destroyAdaptivePlayback();
  playbackMode = 'direct';
  playbackState = 'direct-loading';
  automaticFallbackAttempted = false;
  player.src = currentPlayerItem.streamUrl;
  player.load();
  player.addEventListener('loadedmetadata', () => {
    if (resumeAt > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(resumeAt, Math.max(0, player.duration - 0.1));
    if (shouldPlay) player.play().catch(() => {});
  }, { once: true });
  updateQualityButton('Original');
  setPlayerStatus('');
  sendStreamHeartbeat();
}

function attachAdaptivePlayback(masterUrl, quality, requestToken, mode = 'adaptive') {
  if (!currentPlayerItem || requestToken !== qualityRequestToken) return;
  const resumeAt = Number(player.currentTime) || 0;
  const shouldPlay = mode === 'compatibility' || !player.paused;
  if (activeHls) activeHls.destroy();
  playbackMode = mode === 'compatibility' ? 'hls-fallback' : quality === 'Auto' ? 'hls-auto' : 'hls-manual';
  playbackState = 'hls-preparing';
  if (window.Hls?.isSupported()) {
    const hls = new window.Hls({ startPosition: resumeAt, enableWorker: true });
    activeHls = hls;
    hls.attachMedia(player);
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(masterUrl));
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (quality === 'Auto') {
        hls.currentLevel = -1;
      } else {
        const height = Number.parseInt(quality, 10);
        const levelIndex = (data.levels || []).findIndex((level) => Number(level.height) === height);
        if (levelIndex >= 0) hls.currentLevel = levelIndex;
      }
      if (resumeAt > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(resumeAt, Math.max(0, player.duration - 0.1));
      if (shouldPlay) player.play().catch(() => {});
      playbackState = 'hls-playing';
      setPlayerStatus('');
      sendStreamHeartbeat();
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      playbackState = 'hls-failed';
      setPlayerStatus(mode === 'compatibility'
        ? 'Compatible playback also failed. This file may need to be converted on the server.'
        : 'The selected stream could not be played. Choose Original or another quality.', true);
      hls.destroy();
      if (activeHls === hls) activeHls = null;
    });
  } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = masterUrl;
    player.load();
    player.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0) player.currentTime = resumeAt;
      if (shouldPlay) player.play().catch(() => {});
      playbackState = 'hls-playing';
      setPlayerStatus('');
    }, { once: true });
  } else {
    playbackState = 'hls-failed';
    setPlayerStatus('HLS playback is not supported by this browser.', true);
    return;
  }
  updateQualityButton(quality);
}

async function selectPlaybackQuality(quality) {
  qualityMenu.classList.remove('open');
  qualityBtn.setAttribute('aria-expanded', 'false');
  if (quality === 'Original') {
    restoreDirectPlayback();
    return;
  }
  if (!currentPlayerItem || !playbackOptions?.hlsAvailable) return;
  const requestToken = ++qualityRequestToken;
  const mode = quality === 'Auto' ? 'adaptive' : 'manual';
  const requestedHeight = quality === 'Auto' ? undefined : Number.parseInt(quality, 10);
  updateQualityButton(quality);
  playbackState = 'hls-preparing';
  setPlayerStatus('Preparing adaptive qualities on the server...');
  try {
    let response = await apiRequest(`/api/media/${encodeURIComponent(currentPlayerItem.id)}/hls`, {
      method: 'POST',
      body: { mode, quality: requestedHeight },
    });
    let status = response.status;
    while (status?.state !== 'ready') {
      if (requestToken !== qualityRequestToken || !currentPlayerItem) return;
      if (status?.state === 'failed') throw new Error(status.error || 'Adaptive stream generation failed.');
      setPlayerStatus(`${status?.message || 'Generating adaptive stream'}${Number.isFinite(status?.progress) ? ` (${Math.round(status.progress)}%)` : ''}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await apiRequest(`/api/media/${encodeURIComponent(currentPlayerItem.id)}/hls/status?cacheKey=${encodeURIComponent(status.cacheKey)}`);
      status = response.status;
    }
    attachAdaptivePlayback(status.masterUrl, quality, requestToken, mode);
  } catch (err) {
    if (requestToken !== qualityRequestToken) return;
    playbackState = 'hls-failed';
    setPlayerStatus(err.message || 'Could not prepare adaptive playback.', true);
  }
}

async function startCompatibilityFallback() {
  if (!currentPlayerItem || automaticFallbackAttempted || playbackMode !== 'direct') return;
  automaticFallbackAttempted = true;
  playbackState = 'direct-failed';
  const requestToken = ++qualityRequestToken;
  const mediaId = currentPlayerItem.id;
  const resumeAt = Number(player.currentTime) || 0;
  setPlayerStatus('Preparing a compatible stream on the server...');
  try {
    let response = await apiRequest(`/api/media/${encodeURIComponent(mediaId)}/hls`, {
      method: 'POST',
      body: { mode: 'compatibility' },
    });
    let status = response.status;
    while (status?.state !== 'ready') {
      if (requestToken !== qualityRequestToken || currentPlayerItem?.id !== mediaId) return;
      if (status?.state === 'failed') throw new Error(status.error || 'Compatible stream generation failed.');
      playbackState = 'hls-preparing';
      setPlayerStatus(`${status?.message || 'Preparing compatible stream'}${Number.isFinite(status?.progress) ? ` (${Math.round(status.progress)}%)` : ''}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await apiRequest(`/api/media/${encodeURIComponent(mediaId)}/hls/status?cacheKey=${encodeURIComponent(status.cacheKey)}`);
      status = response.status;
    }
    if (requestToken !== qualityRequestToken || currentPlayerItem?.id !== mediaId) return;
    player.currentTime = resumeAt;
    const compatibilityQuality = String(status.qualities?.[0] || `${playbackOptions?.compatibilityFallback?.targetHeight || 720}p`);
    attachAdaptivePlayback(status.masterUrl, compatibilityQuality, requestToken, 'compatibility');
  } catch (err) {
    if (requestToken !== qualityRequestToken) return;
    playbackState = 'hls-failed';
    setPlayerStatus(err.message || 'This video could not be converted for compatible playback.', true);
  }
}

async function loadPlaybackOptions(item) {
  playbackOptions = null;
  selectedPlaybackQuality = 'Original';
  renderQualityMenu();
  try {
    const response = await apiRequest(`/api/media/${encodeURIComponent(item.id)}/playback-options`);
    if (currentPlayerItem?.id !== item.id) return;
    playbackOptions = response;
    renderQualityMenu(response);
  } catch (err) {
    if (currentPlayerItem?.id === item.id) renderQualityMenu({ hlsAvailable: false });
  }
}

function clearStreamHeartbeat() {
  if (streamHeartbeatTimer) clearInterval(streamHeartbeatTimer);
  streamHeartbeatTimer = null;
  if (streamSessionId) {
    fetch(`/api/playback/session/${encodeURIComponent(streamSessionId)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  streamSessionId = '';
}

async function sendStreamHeartbeat() {
  if (!currentPlayerItem) return;
  try {
    const response = await apiRequest('/api/playback/session', {
      method: 'POST',
      body: {
        sessionId: streamSessionId,
        mediaId: currentPlayerItem.id,
        title: currentPlayerItem.title || currentPlayerItem.name,
        mode: playbackMode,
        quality: selectedPlaybackQuality,
        position: Number(player.currentTime) || 0,
        duration: Number(player.duration) || 0,
        paused: player.paused,
      },
    });
    streamSessionId = response.sessionId || streamSessionId;
  } catch (err) {
    // Playback must continue even if telemetry is temporarily unavailable.
  }
}

function startStreamHeartbeat() {
  clearStreamHeartbeat();
  sendStreamHeartbeat();
  streamHeartbeatTimer = setInterval(sendStreamHeartbeat, 10_000);
}

function openPlayer(item) {
  if (!item.streamUrl) return;
  destroyAdaptivePlayback();
  clearStreamHeartbeat();
  currentPlayerItem = item;
  playbackMode = 'direct';
  playbackState = 'direct-loading';
  automaticFallbackAttempted = false;
  playbackOptions = null;
  selectedPlaybackQuality = 'Original';
  currentPlayerNextEpisode = null;
  if (item.isShow && item.showId) {
    const episodes = libraryItems
      .filter((entry) => entry.isShow && entry.showId === item.showId)
      .sort((first, second) => (
        (first.episode?.season || 0) - (second.episode?.season || 0)
        || (first.episode?.episode || 0) - (second.episode?.episode || 0)
      ));
    const index = episodes.findIndex((entry) => entry.id === item.id);
    currentPlayerNextEpisode = index >= 0 ? episodes[index + 1] || null : null;
  }
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
  player.onplaying = () => {
    playbackState = playbackMode === 'direct' ? 'direct-playing' : 'hls-playing';
    setPlayerStatus('');
  };
  player.oncanplay = () => setPlayerStatus('');
  player.onerror = () => {
    if (playbackMode === 'direct') {
      startCompatibilityFallback();
      return;
    }
    playbackState = 'hls-failed';
    setPlayerStatus('The compatible stream could not be played on this device.', true);
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
    updatePlayerMarkerActions();
  };
  player.onpause = () => { persist(false); sendStreamHeartbeat(); };
  player.onended = () => { persist(true); sendStreamHeartbeat(); };

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
  loadPlaybackOptions(item);
  startStreamHeartbeat();
  updatePlayerMarkerActions();
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

  clearStreamHeartbeat();
  destroyAdaptivePlayback();
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
  playbackState = 'idle';
  automaticFallbackAttempted = false;
  playbackOptions = null;
  qualityMenu.classList.remove('open');
  qualityBtn.setAttribute('aria-expanded', 'false');
  updateQualityButton('Original');
  currentPlayerNextEpisode = null;
  skipIntroBtn.classList.add('hidden');
  nextEpisodeBtn.classList.add('hidden');
  clearPlayerControlsHideTimer();
  if (playerClickToggleTimer) {
    clearTimeout(playerClickToggleTimer);
    playerClickToggleTimer = null;
  }
  playerStage.classList.add('controls-visible');
  if (document.fullscreenElement === playerStage) document.exitFullscreen().catch(() => {});
  syncPlayerControls();
}

function updatePlayerMarkerActions() {
  const markers = currentPlayerItem?.playbackMarkers || {};
  const time = Number(player.currentTime) || 0;
  const introVisible = Number.isFinite(markers.introStart)
    && Number.isFinite(markers.introEnd)
    && markers.introEnd > markers.introStart
    && time >= markers.introStart
    && time < markers.introEnd;
  const nextVisible = !!currentPlayerNextEpisode
    && Number.isFinite(markers.creditsStart)
    && time >= markers.creditsStart;
  skipIntroBtn.classList.toggle('hidden', !introVisible);
  nextEpisodeBtn.classList.toggle('hidden', !nextVisible);
}

function createLoungeModal(kicker, title) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay lounge-modal-overlay';
  const dialog = document.createElement('section');
  dialog.className = 'lounge-dialog';
  const header = document.createElement('header');
  header.className = 'lounge-dialog-header';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('small');
  eyebrow.textContent = kicker;
  const titleNode = document.createElement('h2');
  titleNode.textContent = title;
  heading.append(eyebrow, titleNode);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-back-btn lounge-dialog-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  header.append(heading, close);
  const body = document.createElement('div');
  body.className = 'lounge-dialog-body';
  dialog.append(header, body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const dismiss = () => overlay.remove();
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
  return { overlay, dialog, body, dismiss };
}

function openMovieNight() {
  const { body, dismiss } = createLoungeModal('Tonight at MyFlix', 'Movie Night Wheel');
  const controls = document.createElement('div');
  controls.className = 'movie-night-filters';
  const type = document.createElement('select');
  type.innerHTML = '<option value="all">Movies & shows</option><option value="movie">Movies only</option><option value="show">Shows only</option>';
  const genre = document.createElement('select');
  const genres = Array.from(new Set([
    ...getMovieItems().flatMap(getGenresFromItem),
    ...getShowGroups().flatMap((group) => group.genreNames || []),
  ])).sort();
  genre.innerHTML = '<option value="all">Every genre</option>';
  genres.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    genre.appendChild(option);
  });
  const runtime = document.createElement('select');
  runtime.innerHTML = '<option value="0">Any runtime</option><option value="90">Up to 90 min</option><option value="120">Up to 2 hours</option><option value="150">Up to 2.5 hours</option>';
  const unwatchedLabel = document.createElement('label');
  unwatchedLabel.className = 'movie-night-check';
  const unwatched = document.createElement('input');
  unwatched.type = 'checkbox';
  unwatched.disabled = !currentUser;
  unwatchedLabel.append(unwatched, document.createTextNode(currentUser ? ' Unwatched only' : ' Sign in for unwatched filtering'));
  controls.append(type, genre, runtime, unwatchedLabel);

  const stage = document.createElement('div');
  stage.className = 'movie-night-stage';
  const wheelWrap = document.createElement('div');
  wheelWrap.className = 'movie-night-wheel-wrap';
  const pointer = document.createElement('span');
  pointer.className = 'movie-night-pointer';
  const wheel = document.createElement('button');
  wheel.type = 'button';
  wheel.className = 'movie-night-wheel';
  wheel.innerHTML = '<span>SPIN</span>';
  wheelWrap.append(pointer, wheel);
  const result = document.createElement('div');
  result.className = 'movie-night-result';
  const resultPoster = document.createElement('img');
  resultPoster.className = 'movie-night-result-poster hidden';
  resultPoster.alt = '';
  const resultContent = document.createElement('div');
  resultContent.className = 'movie-night-result-content';
  const resultCopy = document.createElement('div');
  resultCopy.innerHTML = '<small>THE WHEEL IS READY</small><h3>Choose your filters, then spin.</h3><p>One title from your own library will get tonight\'s spotlight.</p>';
  const watch = document.createElement('button');
  watch.type = 'button';
  watch.className = 'primary-btn hidden';
  watch.textContent = 'View selection';
  resultContent.append(resultCopy, watch);
  result.append(resultPoster, resultContent);
  stage.append(wheelWrap, result);
  body.append(controls, stage);

  let chosen = null;
  wheel.addEventListener('click', () => {
    if (wheel.classList.contains('spinning')) return;
    let candidates = [
      ...getMovieItems().map((item) => ({ type: 'movie', title: item.title || item.name, item, poster: buildPosterUrl(item.posterPath), genres: getGenresFromItem(item), runtime: Number(item.runtime) || 0, watched: Number(item.watchProgress?.percent) > 0 })),
      ...getShowGroups().map((group) => ({ type: 'show', title: group.name, item: group, poster: buildPosterUrl(group.posterPath), genres: group.genreNames || [], runtime: 0, watched: group.episodes.some((episode) => Number(episode.watchProgress?.percent) > 0) })),
    ];
    if (type.value !== 'all') candidates = candidates.filter((entry) => entry.type === type.value);
    if (genre.value !== 'all') candidates = candidates.filter((entry) => entry.genres.includes(genre.value));
    const maxRuntime = Number(runtime.value) || 0;
    if (maxRuntime) candidates = candidates.filter((entry) => entry.type === 'show' || !entry.runtime || entry.runtime <= maxRuntime);
    if (unwatched.checked) candidates = candidates.filter((entry) => !entry.watched);
    if (!candidates.length) {
      resultCopy.innerHTML = '<small>NO MATCHES</small><h3>Try broader filters.</h3><p>Your current combination does not match anything in the library.</p>';
      result.classList.remove('has-poster');
      resultPoster.classList.add('hidden');
      watch.classList.add('hidden');
      return;
    }
    chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const turns = 5 + Math.random() * 3;
    wheel.style.setProperty('--wheel-turn', `${turns}turn`);
    wheel.classList.add('spinning');
    window.setTimeout(() => {
      wheel.classList.remove('spinning');
      resultCopy.innerHTML = '';
      const small = document.createElement('small');
      small.textContent = chosen.type === 'movie' ? 'TONIGHT\'S FEATURE' : 'TONIGHT\'S SERIES';
      const heading = document.createElement('h3');
      heading.textContent = chosen.title;
      const detail = document.createElement('p');
      detail.textContent = [chosen.genres.slice(0, 2).join(' / '), chosen.runtime ? `${chosen.runtime} min` : ''].filter(Boolean).join('  -  ') || 'Selected from your library';
      resultCopy.append(small, heading, detail);
      if (chosen.poster) {
        resultPoster.src = chosen.poster;
        resultPoster.alt = `${chosen.title} poster`;
        resultPoster.classList.remove('hidden');
        result.classList.add('has-poster');
      } else {
        resultPoster.removeAttribute('src');
        resultPoster.classList.add('hidden');
        result.classList.remove('has-poster');
      }
      watch.classList.remove('hidden');
    }, prefersReducedMotion() ? 80 : 2200);
  });
  watch.addEventListener('click', () => {
    if (!chosen) return;
    dismiss();
    runCinemaTransition(() => chosen.type === 'movie' ? openMovieDetails(chosen.item) : openShowDetails(chosen.item), 'page');
  });
}

function normalizeSuggestionText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function suggestionEditDistance(first, second) {
  const a = String(first || '');
  const b = String(second || '');
  const row = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const beforeUpdate = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = beforeUpdate;
    }
  }
  return row[b.length];
}

function suggestionSimilarity(first, second) {
  const longest = Math.max(first.length, second.length);
  return longest ? 1 - (suggestionEditDistance(first, second) / longest) : 1;
}

function scoreSuggestionMatch(queryText, match) {
  const query = normalizeSuggestionText(queryText);
  const title = normalizeSuggestionText(match.title || match.name);
  const queryWords = query.split(' ').filter(Boolean);
  const titleWords = title.split(' ').filter(Boolean);
  const wordScore = queryWords.length
    ? queryWords.reduce((total, word) => total + Math.max(0, ...titleWords.map((titleWord) => suggestionSimilarity(word, titleWord))), 0) / queryWords.length
    : 0;
  return Math.max(suggestionSimilarity(query, title), wordScore);
}

async function searchSuggestionTitles(routeType, searchText) {
  const exact = await apiGet(`/api/tmdb/${routeType}/search`, { q: searchText });
  if (exact.results?.length) return { matches: exact.results.slice(0, 8), broadened: false };

  const tokens = [...new Set(normalizeSuggestionText(searchText).split(' ').filter((token) => token.length >= 3))].slice(0, 3);
  const responses = await Promise.all(tokens.map((token) => (
    apiGet(`/api/tmdb/${routeType}/search`, { q: token }).catch(() => ({ results: [] }))
  )));
  const unique = new Map();
  responses.flatMap((payload) => payload.results || []).forEach((match) => {
    if (match?.id && !unique.has(match.id)) unique.set(match.id, match);
  });
  const ranked = [...unique.values()]
    .map((match) => ({ match, score: scoreSuggestionMatch(searchText, match) }))
    .filter((entry) => entry.score >= 0.5)
    .sort((first, second) => second.score - first.score || Number(second.match.popularity || 0) - Number(first.match.popularity || 0))
    .slice(0, 8)
    .map((entry) => entry.match);
  return { matches: ranked, broadened: true };
}

function openSuggestionDialog() {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }
  const { body, dismiss } = createLoungeModal('Request desk', 'Suggest a title');
  const form = document.createElement('div');
  form.className = 'suggestion-form';
  const type = document.createElement('select');
  type.innerHTML = '<option value="movie">Movie</option><option value="show">TV show</option>';
  const query = document.createElement('input');
  query.type = 'search';
  query.placeholder = 'Title name';
  query.maxLength = 180;
  const search = document.createElement('button');
  search.type = 'button';
  search.className = 'primary-btn';
  search.textContent = 'Search TMDB';
  form.append(type, query, search);
  const message = document.createElement('p');
  message.className = 'suggestion-message';
  const results = document.createElement('div');
  results.className = 'suggestion-results';
  const selection = document.createElement('div');
  selection.className = 'suggestion-selection hidden';
  const selectedPoster = document.createElement('img');
  selectedPoster.className = 'suggestion-selected-poster';
  selectedPoster.alt = '';
  const selectedPanel = document.createElement('div');
  selectedPanel.className = 'suggestion-selected-panel';
  const selectedHeading = document.createElement('div');
  selectedHeading.className = 'suggestion-selected-heading';
  const selectedTitle = document.createElement('h3');
  const selectedMeta = document.createElement('small');
  const changeSelection = document.createElement('button');
  changeSelection.type = 'button';
  changeSelection.className = 'ghost-btn suggestion-change';
  changeSelection.textContent = 'Choose another';
  selectedHeading.append(selectedTitle, selectedMeta, changeSelection);
  const note = document.createElement('textarea');
  note.placeholder = 'Optional note for the library admin';
  note.maxLength = 500;
  note.className = 'suggestion-note';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'primary-btn suggestion-submit';
  submit.textContent = 'Send suggestion';
  selectedPanel.append(selectedHeading, note, submit);
  selection.append(selectedPoster, selectedPanel);
  body.append(form, message, results, selection);
  let selected = null;

  search.addEventListener('click', async () => {
    const searchText = query.value.trim();
    if (!searchText) { message.textContent = 'Enter a title first.'; return; }
    search.disabled = true;
    message.textContent = 'Searching TMDB...';
    results.innerHTML = '';
    results.classList.remove('hidden');
    selection.classList.add('hidden');
    selected = null;
    note.value = '';
    try {
      const routeType = type.value === 'show' ? 'tv' : 'movie';
      const searchResult = await searchSuggestionTitles(routeType, searchText);
      const matches = searchResult.matches;
      message.textContent = matches.length
        ? (searchResult.broadened ? 'No exact spelling match. These close titles may be what you meant.' : 'Choose the exact version you mean.')
        : 'No matching title was found. Try fewer words or check the spelling.';
      matches.forEach((match) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestion-result';
        if (match.poster_path) {
          const image = document.createElement('img');
          image.src = `${TMDB_IMG}${match.poster_path}`;
          image.alt = '';
          button.appendChild(image);
        }
        const copy = document.createElement('span');
        const heading = document.createElement('strong');
        heading.textContent = match.title || match.name || 'Untitled';
        const year = document.createElement('small');
        year.textContent = String(match.release_date || match.first_air_date || '').slice(0, 4) || 'Year unknown';
        copy.append(heading, year);
        button.appendChild(copy);
        button.addEventListener('click', () => {
          results.querySelectorAll('button').forEach((entry) => entry.classList.remove('selected'));
          button.classList.add('selected');
          selected = {
            mediaType: type.value,
            title: match.title || match.name,
            tmdbId: match.id,
            posterPath: match.poster_path || null,
            releaseDate: match.release_date || match.first_air_date || null,
          };
          selectedTitle.textContent = selected.title;
          selectedMeta.textContent = `${selected.mediaType === 'show' ? 'TV show' : 'Movie'} - ${String(selected.releaseDate || '').slice(0, 4) || 'Year unknown'} - TMDB ${selected.tmdbId}`;
          if (selected.posterPath) {
            selectedPoster.src = `${TMDB_IMG}${selected.posterPath}`;
            selectedPoster.alt = `${selected.title} poster`;
          } else {
            selectedPoster.removeAttribute('src');
            selectedPoster.alt = '';
          }
          results.classList.add('hidden');
          selection.classList.remove('hidden');
          message.textContent = 'Add an optional note, then send your request.';
          note.focus();
        });
        results.appendChild(button);
      });
    } catch (err) {
      message.textContent = err.message || 'TMDB search failed.';
    } finally {
      search.disabled = false;
    }
  });
  submit.addEventListener('click', async () => {
    if (!selected) return;
    submit.disabled = true;
    try {
      await apiRequest('/api/account/suggestions', { method: 'POST', body: { ...selected, note: note.value.trim() } });
      dismiss();
    } catch (err) {
      message.textContent = err.message || 'Could not send the suggestion.';
      submit.disabled = false;
    }
  });
  changeSelection.addEventListener('click', () => {
    selection.classList.add('hidden');
    results.classList.remove('hidden');
    message.textContent = 'Choose the exact version you mean.';
  });
  query.addEventListener('keydown', (event) => { if (event.key === 'Enter') search.click(); });
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

homeBtn.addEventListener('click', () => {
  detailState = null;
  currentView = 'home';
  renderCurrentView();
});

movieNightBtn?.addEventListener('click', openMovieNight);
suggestionBtn?.addEventListener('click', openSuggestionDialog);

mobileNav.addEventListener('click', (event) => {
  const button = event.target.closest('.nav-btn');
  if (!button) return;
  detailState = null;
  currentView = button.dataset.view;
  renderCurrentView();
});

backBtn.addEventListener('click', closePlayer);
fullscreenBackBtn.addEventListener('click', closePlayer);
skipIntroBtn.addEventListener('click', () => {
  const introEnd = Number(currentPlayerItem?.playbackMarkers?.introEnd);
  if (!Number.isFinite(introEnd)) return;
  player.currentTime = introEnd;
  player.play().catch(() => {});
  updatePlayerMarkerActions();
});
nextEpisodeBtn.addEventListener('click', () => {
  if (!currentPlayerNextEpisode) return;
  const episode = currentPlayerNextEpisode;
  beginPlayback(() => openPlayer(episode));
});
setPlayerButtonIcon(skipBackBtn, 'replay', 'Go back 5 seconds');
setPlayerButtonIcon(skipForwardBtn, 'forward', 'Go forward 5 seconds');

qualityBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = !qualityMenu.classList.contains('open');
  qualityMenu.classList.toggle('open', open);
  qualityBtn.setAttribute('aria-expanded', String(open));
  showPlayerControls(false);
});
qualityGroup.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', (event) => {
  if (event.target.closest('#qualityGroup')) return;
  qualityMenu.classList.remove('open');
  qualityBtn.setAttribute('aria-expanded', 'false');
});

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
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (isShortcutEditableTarget(event.target)) return;
  if (playerView.classList.contains('hidden') || !player.currentSrc) return;

  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault();
    togglePlayerPlayback();
    showPlayerControls(true);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    const maxTime = Number.isFinite(player.duration) ? player.duration : player.currentTime + 5;
    player.currentTime = Math.min(maxTime, player.currentTime + 5);
    showPlayerControls(true);
    syncPlayerControls();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    player.currentTime = Math.max(0, player.currentTime - 5);
    showPlayerControls(true);
    syncPlayerControls();
  }
});

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

    requestPlayerFullscreen();
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

setSubtitleFontSize(getSubtitleFontSize());
playerStage.classList.add('controls-visible');
syncPlayerControls();
refreshSessionAndLibrary({ goHome: false });
