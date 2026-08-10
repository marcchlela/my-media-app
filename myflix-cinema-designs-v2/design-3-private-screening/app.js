
const nowShowing = [
  { title: 'TMNT', fullTitle: 'Teenage Mutant Ninja Turtles', meta: 'S04E22 · 72%', screen: 'Screen 2', progress: 72, poster: '', gradient: 'linear-gradient(145deg, #341a4e, #6d182b 58%, #1a0e10)' },
  { title: 'Normal', fullTitle: 'Normal', meta: 'Feature · 45%', screen: 'Screen 1', progress: 45, poster: '', gradient: 'linear-gradient(145deg, #153040, #2b2d24 60%, #0c0d0d)' },
  { title: 'The Rookie', fullTitle: 'The Rookie', meta: 'S03E10 · 28%', screen: 'Screen 3', progress: 28, poster: '', gradient: 'linear-gradient(145deg, #142518, #2a1830 64%, #070708)' }
];

const continueWatching = [
  { title: 'Normal', subtitle: 'Resume · 45%', progress: 45, poster: '', gradient: 'linear-gradient(120deg, #153040, #091013)' },
  { title: 'The Rookie', subtitle: 'S03E10 · 28%', progress: 28, poster: '', gradient: 'linear-gradient(120deg, #3a1515, #0e0d0e)' },
  { title: 'Taxi Driver', subtitle: 'Resume · 60%', progress: 60, poster: '', gradient: 'linear-gradient(120deg, #3a2116, #0b0a08)' },
  { title: 'First Cow', subtitle: 'Resume · 32%', progress: 32, poster: '', gradient: 'linear-gradient(120deg, #293118, #0b0b08)' }
];

const movies = [
  { title: 'Hoppers', badge: '4K', poster: '', gradient: 'linear-gradient(145deg, #d39d00, #51320d)' },
  { title: 'Paris, Texas', badge: 'CC', poster: '', gradient: 'linear-gradient(145deg, #cc4e00, #35130b)' },
  { title: 'Capernaum', badge: 'HD', poster: '', gradient: 'linear-gradient(145deg, #861d24, #240909)' },
  { title: 'Interstellar', badge: 'IMAX', poster: '', gradient: 'linear-gradient(145deg, #0c1d58, #050510)' },
  { title: 'Summit of the Gods', badge: 'CC', poster: '', gradient: 'linear-gradient(145deg, #1d5370, #08131d)' },
  { title: 'The Archive', badge: '4K', poster: '', gradient: 'linear-gradient(145deg, #2a2b2c, #060606)' }
];

const series = [
  { title: 'Chronicles', badge: '4K', poster: '', gradient: 'linear-gradient(145deg, #5b3412, #090502)' },
  { title: 'Neon City', badge: 'IMAX', poster: '', gradient: 'linear-gradient(145deg, #06266a, #6b1249)' },
  { title: 'Shadow Line', badge: 'CC', poster: '', gradient: 'linear-gradient(145deg, #283a3a, #050707)' },
  { title: 'Beyond Horizon', badge: '4K', poster: '', gradient: 'linear-gradient(145deg, #202f63, #15100d)' }
];

function posterBackground(item) {
  return item.poster
    ? `linear-gradient(180deg, transparent 48%, rgba(0,0,0,.72)), url('${item.poster}')`
    : item.gradient;
}

function topbar() {
  return `
    <header class="topbar">
      <div class="search"><span>⌕</span><input placeholder="Search the lobby..." /></div>
      <button class="ghost-btn">All genres⌄</button>
      <button class="ghost-btn">Sort⌄</button>
      <button class="import-btn">+ Import</button>
    </header>
  `;
}

function sidebar(extra = '') {
  return `
    <aside class="sidebar">
      <div class="brand"><div class="brand-name">MYFLIX</div><div class="brand-tag">Home Cinema</div></div>
      <nav class="nav">
        <button class="nav-item active"><span>⌂</span>Lobby</button>
        <button class="nav-item"><span>▦</span>Movies</button>
        <button class="nav-item"><span>▣</span>Series</button>
        <button class="nav-item"><span>♡</span>Watchlist</button>
        <button class="nav-item"><span>⚙</span>Settings</button>
      </nav>
      <div class="mini-card">
        <div class="eyebrow">Now showing</div>
        <strong>Normal</strong>
        <p>Resume at 45% · Screen 1</p>
        <div class="progress"><span style="width:45%"></span></div>
      </div>
      ${extra}
    </aside>
  `;
}

function progressBar(value) {
  return `<div class="progress"><span style="width:${value}%"></span></div>`;
}

function posterCard(item, variant = '') {
  return `
    <article class="poster-card ${variant}">
      <div class="poster-art" style="background:${posterBackground(item)}; background-size:cover; background-position:center;">
        <span>${item.fullTitle || item.title}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.meta || item.screen || ''}</p>
      ${typeof item.progress === 'number' ? progressBar(item.progress) : ''}
      ${item.badge ? `<em>${item.badge}</em>` : ''}
    </article>
  `;
}

function watchingCard(item) {
  return `
    <article class="watch-card">
      <div class="watch-thumb" style="background:${posterBackground(item)}; background-size:cover; background-position:center;"><span>▶</span></div>
      <div class="watch-info"><strong>${item.title}</strong><small>${item.subtitle}</small>${progressBar(item.progress)}</div>
    </article>
  `;
}

function row(title, items, extraClass = '') {
  return `
    <section class="media-row ${extraClass}">
      <div class="section-head"><h2>${title}</h2><a>View all</a></div>
      <div class="poster-row">${items.map(item => posterCard(item)).join('')}</div>
    </section>
  `;
}

function render() {
  document.getElementById('app').innerHTML = `
    <div class="app private">
      <div class="screening-bg"></div>
      ${sidebar(`<div class="table-prop"><div class="popcorn"></div></div>`)}
      <main class="main">
        ${topbar()}
        <section class="screening-hero">
          <div class="section-head now-head"><h2>Now Showing</h2><span class="status-dot">3 screens active</span></div>
          <div class="lightbox-stage">${nowShowing.map(item => posterCard(item, 'lightbox')).join('')}</div>
        </section>
        ${row('Movies', movies, 'movies-row')}
        <section class="continue-section compact-continue">
          <div class="section-head"><h2>Continue Watching</h2><a>View all</a></div>
          <div class="watch-row">${continueWatching.map(watchingCard).join('')}</div>
        </section>
        ${row('Series', series, 'series-row')}
      </main>
    </div>
  `;
}
render();
