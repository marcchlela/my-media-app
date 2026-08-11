const content = document.getElementById('adminContent');
const nav = document.getElementById('adminNav');
const viewTitle = document.getElementById('viewTitle');
const viewKicker = document.getElementById('viewKicker');
const refreshButton = document.getElementById('refreshAdmin');
const lastUpdated = document.getElementById('lastUpdated');
const serverPulse = document.getElementById('serverPulse');
const serverState = document.getElementById('serverState');
const serverHost = document.getElementById('serverHost');
const toast = document.getElementById('adminToast');

const VIEW_META = {
  overview: ['Projection Booth', 'OPERATIONS OVERVIEW'],
  library: ['Library Control', 'CATALOG & METADATA'],
  streams: ['Active Streams', 'VIEWER ACTIVITY'],
  jobs: ['Job Queue', 'BACKGROUND OPERATIONS'],
  markers: ['Playback Markers', 'INTROS, OUTROS & NEXT EPISODES'],
  storage: ['Storage Vault', 'MEDIA, CACHE & BACKUPS'],
  system: ['Server System', 'HARDWARE & MEDIA TOOLS'],
};

const ICONS = {
  overview: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  library: '<svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4zM8 5.5v13M16 5.5v13M4 10h4M16 10h4M4 15h4M16 15h4"/></svg>',
  streams: '<svg viewBox="0 0 24 24"><path d="M8 5a9 9 0 0 1 0 14M5 8a5 5 0 0 1 0 8"/><circle cx="15" cy="12" r="3"/></svg>',
  jobs: '<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7zM4 10H2M4 14H2M22 10h-2M22 14h-2M10 4V2M14 4V2M10 22v-2M14 22v-2"/></svg>',
  markers: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 18h16M7 3v6M17 15v6M12 9v6"/></svg>',
  storage: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
  system: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM8 1v3M12 1v3M16 1v3M8 20v3M12 20v3M16 20v3M1 8h3M1 12h3M1 16h3M20 8h3M20 12h3M20 16h3"/></svg>',
};

document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = ICONS[node.dataset.icon] || ''; });

let currentView = 'overview';
let refreshTimer = null;
let toastTimer = null;
let libraryCache = null;
let libraryTab = 'movies';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function bytes(value) {
  const number = Number(value) || 0;
  if (number < 1024) return `${number} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = number;
  let unit = 'B';
  for (const next of units) {
    size /= 1024;
    unit = next;
    if (size < 1024) break;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function duration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function relativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const delta = Math.max(0, Date.now() - Number(timestamp));
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
  return new Date(Number(timestamp)).toLocaleDateString();
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = '/desktop#account';
    throw new Error('Sign in is required.');
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function loading() {
  content.innerHTML = '<div class="booth-loader"><span></span><p>Checking the projection booth...</p></div>';
}

function empty(message) {
  return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function meter(label, storage) {
  if (!storage?.available) return `<div class="storage-meter"><header><span>${escapeHtml(label)}</span><span>Unavailable</span></header><div class="meter-track"><span style="width:0"></span></div></div>`;
  return `<div class="storage-meter"><header><span>${escapeHtml(label)}</span><span>${bytes(storage.usedBytes)} of ${bytes(storage.totalBytes)} · ${storage.usedPercent}%</span></header><div class="meter-track"><span style="width:${Math.min(100, Number(storage.usedPercent) || 0)}%"></span></div></div>`;
}

function streamRows(streams) {
  if (!streams.length) return empty('The lounge is quiet. No active streams right now.');
  return `<div class="stream-list">${streams.map((stream) => {
    const percent = stream.duration ? Math.min(100, (stream.position / stream.duration) * 100) : 0;
    return `<div class="stream-row"><div><strong>${escapeHtml(stream.title)}</strong><small>${escapeHtml(stream.userName)} · ${escapeHtml(stream.quality)} · ${stream.paused ? 'Paused' : 'Playing'} · ${duration(stream.position)} / ${duration(stream.duration)}</small></div><div class="stream-progress"><span style="width:${percent}%"></span></div></div>`;
  }).join('')}</div>`;
}

function jobRows(jobs, cancellable = false) {
  if (!jobs.length) return empty('No jobs to display.');
  return `<div class="job-list">${jobs.map((job) => `<div class="job-row"><div><strong>${escapeHtml(job.label)}</strong><small>${escapeHtml(job.message || job.type)} · ${relativeTime(job.startedAt || job.createdAt)}</small></div><div><div class="meter-track"><span style="width:${Math.min(100, Number(job.progress) || 0)}%"></span></div></div><div>${cancellable ? `<button class="admin-button danger" data-action="cancel-job" data-id="${escapeHtml(job.id)}">Cancel</button>` : `<span class="job-state">${escapeHtml(job.state)}</span>`}</div></div>`).join('')}</div>`;
}

async function renderOverview() {
  const data = await api('/api/admin/overview');
  const { catalog, storage, system, streams, jobs, warnings } = data;
  serverHost.textContent = system.host.hostname;
  const primaryStorage = storage.volumes.movies.available ? storage.volumes.movies : storage.volumes.data;
  content.innerHTML = `
    <div class="metric-grid">
      <article class="metric-card"><small>Library</small><strong>${catalog.movies + catalog.shows}</strong><em>${catalog.movies} movies · ${catalog.shows} shows · ${catalog.episodes} episodes</em></article>
      <article class="metric-card"><small>Active streams</small><strong>${streams.length}</strong><em>${streams.filter((entry) => !entry.paused).length} currently playing</em></article>
      <article class="metric-card"><small>Storage used</small><strong>${primaryStorage.available ? `${primaryStorage.usedPercent}%` : 'N/A'}</strong><em>${primaryStorage.available ? `${bytes(primaryStorage.freeBytes)} free on media volume` : 'Media volume unavailable'}</em></article>
      <article class="metric-card"><small>Server memory</small><strong>${system.memory.usedPercent}%</strong><em>${bytes(system.memory.usedBytes)} of ${bytes(system.memory.totalBytes)}</em></article>
    </div>
    <div class="dashboard-grid">
      <div>
        <section class="panel"><div class="panel-title"><h3>Storage room</h3><span>LIVE VOLUME STATUS</span></div>${meter('Movies', storage.volumes.movies)}${meter('TV shows', storage.volumes.tvShows)}${meter('Application data', storage.volumes.data)}</section>
        <section class="panel"><div class="panel-title"><h3>Now streaming</h3><span>${streams.length} ACTIVE</span></div>${streamRows(streams)}</section>
        <section class="panel"><div class="panel-title"><h3>Recent operations</h3><span>${jobs.active.length} RUNNING</span></div>${jobRows([...jobs.active, ...jobs.recent].slice(0, 7), false)}</section>
      </div>
      <aside>
        <section class="panel"><div class="panel-title"><h3>Booth notices</h3><span>${warnings.length} ITEMS</span></div><div class="warning-list">${warnings.length ? warnings.map((warning) => `<div class="warning-item ${escapeHtml(warning.level)}"><span class="warning-dot"></span><div><strong>${escapeHtml(warning.title)}</strong><small>${escapeHtml(warning.detail)}</small></div></div>`).join('') : '<div class="warning-item"><span class="warning-dot"></span><div><strong>Everything looks ready</strong><small>No operational warnings were detected.</small></div></div>'}</div></section>
        <section class="panel"><div class="panel-title"><h3>Server card</h3><span>${system.host.container ? 'CONTAINER' : 'HOST PROCESS'}</span></div><table class="stat-table"><tr><th>Host</th><td>${escapeHtml(system.host.hostname)}</td></tr><tr><th>CPU</th><td>${escapeHtml(system.cpu.model)}</td></tr><tr><th>Cores</th><td>${system.cpu.cores}</td></tr><tr><th>Uptime</th><td>${duration(system.host.uptimeSeconds)}</td></tr><tr><th>FFmpeg</th><td>${system.tools.ffmpeg.available ? 'Ready' : 'Missing'}</td></tr><tr><th>Intro detector</th><td>${system.tools.fingerprint.available ? 'Ready' : 'Missing'}</td></tr></table></section>
      </aside>
    </div>`;
}

function subtitleControls(item) {
  if (!item.subtitles?.length) return '';
  return `<div>${item.subtitles.map((subtitle) => `<label class="subtitle-chip"><input type="checkbox" data-action="subtitle" data-id="${escapeHtml(subtitle.id)}" ${subtitle.enabled ? 'checked' : ''}>${escapeHtml(subtitle.language || subtitle.name)}</label>`).join('')}</div>`;
}

function movieRow(movie) {
  return `<div class="catalog-row ${movie.hidden ? 'is-hidden' : ''} ${movie.available ? '' : 'is-missing'}" data-search="${escapeHtml(movie.title.toLowerCase())}"><div class="catalog-copy"><strong>${escapeHtml(movie.title)}</strong><small><span>${bytes(movie.file_size)}</span><span>${duration(movie.duration_seconds)}</span>${movie.unmatched ? '<span class="status-badge bad">Unmatched</span>' : '<span class="status-badge good">TMDB matched</span>'}${movie.available ? '' : '<span class="status-badge bad">Missing file</span>'}</small>${subtitleControls(movie)}</div><div class="catalog-actions"><button class="admin-button" data-action="match" data-type="movie" data-id="${escapeHtml(movie.id)}" data-title="${escapeHtml(movie.title)}">Metadata</button><button class="admin-button" data-action="visibility" data-scope="movie" data-id="${escapeHtml(movie.id)}" data-hidden="${movie.hidden ? 'false' : 'true'}">${movie.hidden ? 'Show' : 'Hide'}</button><button class="admin-button danger" data-action="delete" data-scope="movie" data-id="${escapeHtml(movie.id)}" data-title="${escapeHtml(movie.title)}">Remove</button></div></div>`;
}

function episodeRow(show, season, episode) {
  const number = `S${String(season.number).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}${episode.episodeEnd ? `-E${String(episode.episodeEnd).padStart(2, '0')}` : ''}`;
  return `<div class="catalog-row ${episode.hidden ? 'is-hidden' : ''} ${episode.available ? '' : 'is-missing'}" data-search="${escapeHtml(`${show.title} ${episode.title}`.toLowerCase())}"><div class="catalog-copy"><strong>${number} · ${escapeHtml(episode.title)}</strong><small><span>${bytes(episode.fileSize)}</span>${episode.available ? '' : '<span class="status-badge bad">Missing file</span>'}</small>${subtitleControls(episode)}</div><div class="catalog-actions"><button class="admin-button" data-action="visibility" data-scope="episode" data-id="${escapeHtml(episode.id)}" data-hidden="${episode.hidden ? 'false' : 'true'}">${episode.hidden ? 'Show' : 'Hide'}</button><button class="admin-button danger" data-action="delete" data-scope="episode" data-id="${escapeHtml(episode.id)}" data-title="${escapeHtml(episode.title)}">Remove</button></div></div>`;
}

function showTree(show) {
  return `<details class="catalog-tree" data-search="${escapeHtml(show.title.toLowerCase())}"><summary>${escapeHtml(show.title)} · ${show.seasons.length} seasons ${show.unmatched ? '<span class="status-badge bad">Unmatched</span>' : ''}</summary><div class="catalog-list"><div class="catalog-row ${show.hidden ? 'is-hidden' : ''}"><div class="catalog-copy"><strong>Series controls</strong><small><span>${show.seasons.reduce((sum, season) => sum + season.episodes.length, 0)} episodes</span></small></div><div class="catalog-actions"><button class="admin-button" data-action="match" data-type="show" data-id="${escapeHtml(show.id)}" data-title="${escapeHtml(show.title)}">Metadata</button><button class="admin-button" data-action="visibility" data-scope="show" data-id="${escapeHtml(show.id)}" data-hidden="${show.hidden ? 'false' : 'true'}">${show.hidden ? 'Show' : 'Hide'}</button><button class="admin-button danger" data-action="delete" data-scope="show" data-id="${escapeHtml(show.id)}" data-title="${escapeHtml(show.title)}">Remove show</button></div></div>${show.seasons.map((season) => `<details class="catalog-tree"><summary>Season ${season.number} · ${season.episodes.length} episodes</summary><div class="catalog-list"><div class="catalog-row"><div class="catalog-copy"><strong>Season ${season.number} controls</strong></div><div class="catalog-actions"><button class="admin-button" data-action="visibility" data-scope="season" data-show-id="${escapeHtml(show.id)}" data-season="${season.number}" data-hidden="true">Hide season</button><button class="admin-button danger" data-action="delete" data-scope="season" data-show-id="${escapeHtml(show.id)}" data-season="${season.number}" data-title="${escapeHtml(`${show.title} Season ${season.number}`)}">Remove season</button></div></div>${season.episodes.map((episode) => episodeRow(show, season, episode)).join('')}</div></details>`).join('')}</div></details>`;
}

function suggestionRows(suggestions) {
  if (!suggestions.length) return empty('No title suggestions yet.');
  return suggestions.map((suggestion) => `<div class="suggestion-row" data-search="${escapeHtml(suggestion.title.toLowerCase())}"><div class="catalog-copy"><strong>${escapeHtml(suggestion.title)}</strong><small><span>${escapeHtml(suggestion.mediaType)}</span><span>TMDB ${suggestion.tmdbId}</span><span>From ${escapeHtml(suggestion.user.name)}</span><span>${relativeTime(suggestion.createdAt)}</span><span class="status-badge ${suggestion.status === 'approved' ? 'good' : suggestion.status === 'declined' ? 'bad' : ''}">${escapeHtml(suggestion.status)}</span></small>${suggestion.note ? `<small>${escapeHtml(suggestion.note)}</small>` : ''}</div><div class="catalog-actions"><button class="admin-button primary" data-action="suggestion" data-id="${escapeHtml(suggestion.id)}" data-status="approved">Approve</button><button class="admin-button danger" data-action="suggestion" data-id="${escapeHtml(suggestion.id)}" data-status="declined">Decline</button></div></div>`).join('');
}

async function renderLibrary() {
  const [library, suggestions] = await Promise.all([api('/api/admin/library/manage'), api('/api/admin/suggestions')]);
  libraryCache = library.library;
  content.innerHTML = `
    <div class="section-heading"><div><h2>Library floor</h2><p>Hide titles instantly, remove stale catalog records, manage metadata and subtitles.</p></div><div class="section-actions"><button class="admin-button" data-action="refresh-metadata">Refresh missing metadata</button><button class="admin-button primary" data-action="scan">Scan library</button></div></div>
    <div class="library-toolbar"><input id="librarySearch" class="admin-input" type="search" placeholder="Search this control list..."><span class="status-badge">Removing here does not delete media files</span></div>
    <div class="tab-strip"><button data-tab="movies" class="${libraryTab === 'movies' ? 'active' : ''}">Movies (${libraryCache.movies.length})</button><button data-tab="shows" class="${libraryTab === 'shows' ? 'active' : ''}">Shows (${libraryCache.shows.length})</button><button data-tab="missing" class="${libraryTab === 'missing' ? 'active' : ''}">Missing / unmatched</button><button data-tab="suggestions" class="${libraryTab === 'suggestions' ? 'active' : ''}">Suggestions (${suggestions.suggestions.filter((item) => item.status === 'pending').length})</button></div>
    <div id="libraryRows" class="catalog-list">${libraryTab === 'movies' ? libraryCache.movies.map(movieRow).join('') : libraryTab === 'shows' ? libraryCache.shows.map(showTree).join('') : libraryTab === 'missing' ? [...libraryCache.movies.filter((item) => item.unmatched || !item.available).map(movieRow), ...libraryCache.shows.filter((item) => item.unmatched).map(showTree)].join('') || empty('No missing or unmatched titles.') : suggestionRows(suggestions.suggestions)}</div>`;
  bindLibraryEvents();
}

function bindLibraryEvents() {
  document.getElementById('librarySearch')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('#libraryRows > [data-search]').forEach((row) => { row.hidden = query && !row.dataset.search.includes(query); });
  });
  content.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    libraryTab = button.dataset.tab;
    renderLibrary().catch(handleRenderError);
  }));
}

async function renderStreams() {
  const data = await api('/api/admin/streams');
  content.innerHTML = `<div class="section-heading"><div><h2>Viewer activity</h2><p>Sessions expire automatically when a player stops reporting for 45 seconds.</p></div><span class="status-badge good">${data.streams.length} active</span></div><section class="panel">${streamRows(data.streams)}</section>`;
}

async function renderJobs() {
  const data = await api('/api/admin/jobs');
  content.innerHTML = `<div class="section-heading"><div><h2>Background operations</h2><p>Library scans, intro analysis, adaptive video generation, and maintenance jobs.</p></div><div class="section-actions"><button class="admin-button" data-action="analyze-intros">Analyze intros</button><button class="admin-button primary" data-action="scan">Scan library</button></div></div><section class="panel"><div class="panel-title"><h3>Active queue</h3><span>${data.jobs.active.length} RUNNING</span></div>${jobRows(data.jobs.active, true)}</section><section class="panel"><div class="panel-title"><h3>Job history</h3><span>LAST ${data.jobs.recent.length}</span></div>${jobRows(data.jobs.recent, false)}</section>`;
}

function confidenceLabel(value) {
  if (!Number.isFinite(Number(value))) return '<span class="confidence low">Not detected</span>';
  const percent = Math.round(Number(value) * 100);
  return `<span class="confidence ${percent >= 75 ? 'high' : 'low'}">${percent}% confidence</span>`;
}

async function renderMarkers() {
  const data = await api('/api/admin/playback-markers');
  content.innerHTML = `<div class="section-heading"><div><h2>Playback marker review</h2><p>Audio fingerprints detect recurring intros. Chapters and duration estimates cover credits until reviewed.</p></div><div class="section-actions"><button class="admin-button" data-action="analyze-intros" data-force="true">Re-analyze all</button><button class="admin-button primary" data-action="analyze-intros">Analyze pending</button></div></div>${data.fingerprintAvailable ? '' : '<div class="warning-item warning"><span class="warning-dot"></span><div><strong>Fingerprint tool unavailable</strong><small>Install Chromaprint fpcalc in the server environment.</small></div></div>'}<div>${data.shows.map((show) => `<details class="marker-show"><summary>${escapeHtml(show.title)}</summary>${show.seasons.map((season) => `<section class="marker-season"><h3>Season ${season.number}</h3><div class="catalog-list">${season.episodes.map((episode) => { const marker = episode.playbackMarkers || {}; return `<div class="catalog-row"><div class="catalog-copy"><strong>E${String(episode.episode).padStart(2, '0')} · ${escapeHtml(episode.title)}</strong><small><span>Intro ${Number.isFinite(marker.introStart) ? `${duration(marker.introStart)}–${duration(marker.introEnd)}` : 'not detected'}</span><span>Credits ${Number.isFinite(marker.creditsStart) ? duration(marker.creditsStart) : 'not detected'}</span><span>${escapeHtml(marker.source || 'unreviewed')}</span>${confidenceLabel(marker.introConfidence)}</small></div><button class="admin-button" data-action="edit-marker" data-marker="${encodeURIComponent(JSON.stringify({ id: episode.id, title: episode.title, marker }))}">Review</button></div>`; }).join('')}</div></section>`).join('')}</details>`).join('')}</div>`;
}

async function renderStorage() {
  const data = await api('/api/admin/storage');
  const storage = data.storage;
  content.innerHTML = `<div class="section-heading"><div><h2>Storage vault</h2><p>Media mounts are read-only to MyFlix. Backups and generated caches live under the data directory.</p></div><div class="section-actions"><button class="admin-button danger" data-action="clear-hls">Clear adaptive cache</button><button class="admin-button primary" data-action="backup">Create database backup</button></div></div><div class="system-grid"><section class="panel"><div class="panel-title"><h3>Mounted volumes</h3><span>FILESYSTEM</span></div>${meter('Movies', storage.volumes.movies)}${meter('TV shows', storage.volumes.tvShows)}${meter('Application data', storage.volumes.data)}</section><section class="panel"><div class="panel-title"><h3>Managed data</h3><span>MYFLIX</span></div><table class="stat-table"><tr><th>Database</th><td>${bytes(storage.usage.databaseBytes)}</td></tr><tr><th>Adaptive HLS cache</th><td>${bytes(storage.usage.hlsCacheBytes)}</td></tr><tr><th>Subtitle cache</th><td>${bytes(storage.usage.subtitleCacheBytes)}</td></tr><tr><th>Custom posters</th><td>${bytes(storage.usage.customPosterBytes)}</td></tr>${storage.usage.media.map((row) => `<tr><th>${escapeHtml(row.media_type)} media</th><td>${bytes(row.bytes)} · ${row.missing || 0} missing</td></tr>`).join('')}</table></section></div><section class="panel"><div class="panel-title"><h3>Database backups</h3><span>${storage.backups.length} COPIES</span></div>${storage.backups.length ? `<div class="compact-list">${storage.backups.map((backup) => `<div class="compact-row"><strong>${escapeHtml(backup.filename)}</strong><small>${bytes(backup.sizeBytes)} · ${relativeTime(backup.createdAt)}</small></div>`).join('')}</div>` : empty('No backups have been created yet.')}</section>`;
}

async function renderSystem() {
  const data = await api('/api/admin/system');
  const system = data.system;
  content.innerHTML = `<div class="section-heading"><div><h2>${system.host.container ? 'Server container' : 'Server process'}</h2><p>These are stats from the machine environment running MyFlix, not the device viewing this page.</p></div><span class="status-badge good">Uptime ${duration(system.processUptimeSeconds)}</span></div><div class="system-grid"><section class="panel"><div class="panel-title"><h3>Compute</h3><span>${escapeHtml(system.host.architecture)}</span></div><table class="stat-table"><tr><th>Hostname</th><td>${escapeHtml(system.host.hostname)}</td></tr><tr><th>Platform</th><td>${escapeHtml(system.host.platform)}</td></tr><tr><th>CPU</th><td>${escapeHtml(system.cpu.model)}</td></tr><tr><th>Logical cores</th><td>${system.cpu.cores}</td></tr><tr><th>Load average</th><td>${system.cpu.loadAverage.map((value) => Number(value).toFixed(2)).join(' / ')}</td></tr></table></section><section class="panel"><div class="panel-title"><h3>Memory</h3><span>${system.memory.usedPercent}% USED</span></div>${meter('System memory', { available: true, totalBytes: system.memory.totalBytes, usedBytes: system.memory.usedBytes, freeBytes: system.memory.freeBytes, usedPercent: system.memory.usedPercent })}<table class="stat-table"><tr><th>MyFlix process</th><td>${bytes(system.memory.processBytes)}</td></tr><tr><th>Node</th><td>${escapeHtml(system.node)}</td></tr></table></section><section class="panel"><div class="panel-title"><h3>Media toolchain</h3><span>CAPABILITIES</span></div><table class="stat-table"><tr><th>FFmpeg</th><td>${system.tools.ffmpeg.available ? 'Ready' : 'Missing'}</td></tr><tr><th>Chromaprint</th><td>${system.tools.fingerprint.available ? 'Ready' : 'Missing'}</td></tr><tr><th>Software H.264</th><td>${system.tools.encoders.software ? 'Available' : 'Missing'}</td></tr><tr><th>Intel QSV</th><td>${system.tools.encoders.intelQsv ? 'Compiled' : 'Unavailable'}</td></tr><tr><th>VAAPI</th><td>${system.tools.encoders.vaapi ? 'Compiled' : 'Unavailable'}</td></tr><tr><th>NVIDIA NVENC</th><td>${system.tools.encoders.nvidiaNvenc ? 'Compiled' : 'Unavailable'}</td></tr><tr><th>Render device mounted</th><td>${system.tools.gpuDeviceAvailable ? 'Yes' : 'No'}</td></tr><tr><th>NVIDIA device mounted</th><td>${system.tools.nvidiaDeviceAvailable ? 'Yes' : 'No'}</td></tr><tr><th>Selected encoder</th><td>${escapeHtml(system.tools.recommendedEncoder)}</td></tr></table></section><section class="panel"><div class="panel-title"><h3>Temperatures</h3><span>${system.temperatures.length} SENSORS</span></div>${system.temperatures.length ? `<table class="stat-table">${system.temperatures.map((sensor) => `<tr><th>${escapeHtml(sensor.name)}</th><td>${sensor.celsius}°C</td></tr>`).join('')}</table>` : empty(system.host.container ? 'No thermal sensors are exposed to this container.' : 'No readable thermal sensors were found.')}</section></div>`;
}

function modal(title, description) {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `<section class="admin-modal"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="admin-modal-content"></div><div class="modal-actions"><button class="admin-button" data-close>Cancel</button></div></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  return { overlay, body: overlay.querySelector('.admin-modal-content'), actions: overlay.querySelector('.modal-actions'), close };
}

function markerTimeFields(name, seconds) {
  const valid = Number.isFinite(Number(seconds));
  const total = valid ? Math.floor(Number(seconds)) : null;
  const values = total === null ? ['', '', ''] : [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return `<div class="marker-time" data-time="${name}"><label>Hours<input type="number" min="0" value="${values[0]}"></label><label>Minutes<input type="number" min="0" max="59" value="${values[1]}"></label><label>Seconds<input type="number" min="0" max="59" step="0.1" value="${values[2]}"></label></div>`;
}

function readMarkerTime(root, name) {
  const values = Array.from(root.querySelectorAll(`[data-time="${name}"] input`)).map((input) => input.value.trim());
  if (values.every((value) => value === '')) return null;
  const [hours, minutes, seconds] = values.map((value) => Number(value || 0));
  if (![hours, minutes, seconds].every(Number.isFinite) || hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds >= 60) throw new Error('Use valid hour, minute, and second values.');
  return hours * 3600 + minutes * 60 + seconds;
}

function openMarkerEditor(payload) {
  const { overlay, body, actions, close } = modal(`Review ${payload.title}`, `Detection source: ${payload.marker.source || 'none'} · Intro confidence: ${Number.isFinite(payload.marker.introConfidence) ? `${Math.round(payload.marker.introConfidence * 100)}%` : 'not available'}`);
  body.innerHTML = `<div class="marker-form"><div class="marker-field"><span>Intro starts</span>${markerTimeFields('introStart', payload.marker.introStart)}</div><div class="marker-field"><span>Intro ends</span>${markerTimeFields('introEnd', payload.marker.introEnd)}</div><div class="marker-field"><span>Credits start</span>${markerTimeFields('creditsStart', payload.marker.creditsStart)}</div></div>`;
  const clear = document.createElement('button');
  clear.className = 'admin-button danger';
  clear.textContent = 'Clear markers';
  const save = document.createElement('button');
  save.className = 'admin-button primary';
  save.textContent = 'Save manual markers';
  actions.append(clear, save);
  async function submit(values) {
    try {
      await api(`/api/admin/media/${encodeURIComponent(payload.id)}/playback-markers`, { method: 'PATCH', body: values });
      close();
      showToast('Playback markers saved.');
      loadView(false);
    } catch (error) { showToast(error.message, true); }
  }
  clear.addEventListener('click', () => submit({ introStart: null, introEnd: null, creditsStart: null }));
  save.addEventListener('click', () => {
    try { submit({ introStart: readMarkerTime(overlay, 'introStart'), introEnd: readMarkerTime(overlay, 'introEnd'), creditsStart: readMarkerTime(overlay, 'creditsStart') }); }
    catch (error) { showToast(error.message, true); }
  });
}

function openMetadataMatcher(targetType, targetId, title) {
  const { body, actions, close } = modal(`Match ${title}`, 'Search TMDB and lock the correct default metadata and poster for the whole library.');
  body.innerHTML = `<div class="library-toolbar"><input class="admin-input" type="search" value="${escapeHtml(title)}"><button class="admin-button primary">Search</button></div><p class="confidence">Choose the exact edition or year.</p><div class="match-results"></div>`;
  const input = body.querySelector('input');
  const search = body.querySelector('button');
  const results = body.querySelector('.match-results');
  const run = async () => {
    search.disabled = true;
    results.innerHTML = empty('Searching TMDB...');
    try {
      const data = await api(`/api/admin/metadata/search?type=${encodeURIComponent(targetType)}&id=${encodeURIComponent(targetId)}&q=${encodeURIComponent(input.value.trim())}`);
      results.innerHTML = data.results.length ? data.results.map((result) => `<button class="match-result" data-tmdb="${result.id}">${result.posterPath ? `<img src="https://image.tmdb.org/t/p/w342${escapeHtml(result.posterPath)}" alt="">` : ''}<strong>${escapeHtml(result.title)}</strong><small>${escapeHtml(result.year || 'Year unknown')} · ${Math.round(Number(result.confidence) || 0)} match score</small></button>`).join('') : empty('No TMDB matches found.');
      results.querySelectorAll('[data-tmdb]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api('/api/admin/metadata/match', { method: 'POST', body: { targetType, targetId, tmdbId: Number(button.dataset.tmdb) } });
          close();
          showToast('Default metadata updated.');
          loadView(false);
        } catch (error) { showToast(error.message, true); button.disabled = false; }
      }));
    } catch (error) { results.innerHTML = empty(error.message); }
    finally { search.disabled = false; }
  };
  search.addEventListener('click', run);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
  const retry = document.createElement('button');
  retry.className = 'admin-button';
  retry.textContent = 'Return to automatic match';
  retry.addEventListener('click', async () => {
    try { await api('/api/admin/metadata/retry', { method: 'POST', body: { targetType, targetId } }); close(); showToast('Automatic metadata matching retried.'); loadView(false); }
    catch (error) { showToast(error.message, true); }
  });
  actions.prepend(retry);
}

async function handleAction(button) {
  const action = button.dataset.action;
  try {
    if (action === 'scan') {
      await api('/api/admin/library/scan', { method: 'POST', body: { analyzeIntros: true } });
      showToast('Library scan started. Intro analysis will follow.');
    } else if (action === 'refresh-metadata') {
      await api('/api/admin/library/metadata/refresh', { method: 'POST', body: {} });
      showToast('Missing metadata refresh started.');
    } else if (action === 'visibility') {
      await api('/api/admin/library/visibility', { method: 'PATCH', body: { scope: button.dataset.scope, id: button.dataset.id, showId: button.dataset.showId, season: button.dataset.season, hidden: button.dataset.hidden === 'true' } });
      showToast('Catalog visibility updated.');
      await loadView(false);
    } else if (action === 'delete') {
      const confirmation = modal(`Remove ${button.dataset.title}?`, 'This removes the catalog record, watch references, and generated metadata. It does not delete the media file, so a later scan can import it again.');
      const confirm = document.createElement('button');
      confirm.className = 'admin-button danger';
      confirm.textContent = 'Remove catalog record';
      confirmation.actions.appendChild(confirm);
      confirm.addEventListener('click', async () => {
        try {
          await api('/api/admin/library/catalog', { method: 'DELETE', body: { scope: button.dataset.scope, id: button.dataset.id, showId: button.dataset.showId, season: button.dataset.season } });
          confirmation.close();
          showToast('Catalog record removed.');
          loadView(false);
        } catch (error) { showToast(error.message, true); }
      });
    } else if (action === 'match') {
      openMetadataMatcher(button.dataset.type, button.dataset.id, button.dataset.title);
    } else if (action === 'suggestion') {
      await api(`/api/admin/suggestions/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: { status: button.dataset.status } });
      showToast(`Suggestion ${button.dataset.status}.`);
      await loadView(false);
    } else if (action === 'cancel-job') {
      await api(`/api/admin/jobs/${encodeURIComponent(button.dataset.id)}/cancel`, { method: 'POST', body: {} });
      showToast('Cancellation requested.');
      await loadView(false);
    } else if (action === 'analyze-intros') {
      await api('/api/admin/playback-markers/analyze', { method: 'POST', body: { force: button.dataset.force === 'true' } });
      showToast('Audio-fingerprint intro analysis started.');
    } else if (action === 'backup') {
      const data = await api('/api/admin/storage/backup', { method: 'POST', body: {} });
      showToast(`Backup created: ${data.backup.filename}`);
      await loadView(false);
    } else if (action === 'clear-hls') {
      await api('/api/admin/storage/hls-cache', { method: 'DELETE', body: {} });
      showToast('Adaptive quality cache cleared.');
      await loadView(false);
    } else if (action === 'edit-marker') {
      openMarkerEditor(JSON.parse(decodeURIComponent(button.dataset.marker)));
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadView(showLoader = true) {
  clearInterval(refreshTimer);
  refreshTimer = null;
  if (showLoader) loading();
  const [title, kicker] = VIEW_META[currentView];
  viewTitle.textContent = title;
  viewKicker.textContent = kicker;
  nav.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
  try {
    const renderers = { overview: renderOverview, library: renderLibrary, streams: renderStreams, jobs: renderJobs, markers: renderMarkers, storage: renderStorage, system: renderSystem };
    await renderers[currentView]();
    serverPulse.classList.add('online');
    serverState.textContent = 'Server online';
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (['overview', 'streams', 'jobs', 'system'].includes(currentView)) {
      refreshTimer = setInterval(() => loadView(false), currentView === 'system' ? 10_000 : 5_000);
    }
  } catch (error) {
    handleRenderError(error);
  }
}

function handleRenderError(error) {
  serverPulse.classList.remove('online');
  serverState.textContent = 'Needs attention';
  content.innerHTML = `<div class="empty-state"><div><h2>Could not load this control room</h2><p>${escapeHtml(error.message || 'The server did not respond.')}</p></div></div>`;
}

nav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  currentView = button.dataset.view;
  loadView();
});

content.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handleAction(button);
});

content.addEventListener('change', async (event) => {
  if (event.target.dataset.action !== 'subtitle') return;
  try {
    await api(`/api/admin/subtitles/${encodeURIComponent(event.target.dataset.id)}`, { method: 'PATCH', body: { enabled: event.target.checked } });
    showToast(`Subtitle ${event.target.checked ? 'enabled' : 'disabled'}.`);
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message, true);
  }
});

refreshButton.addEventListener('click', () => loadView(false));
loadView();
