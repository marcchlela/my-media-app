/* ==========================================================================
   render.js — builds .media-card elements (framed posters) from data.js
   into any container with a data-rail attribute. This is the layer you'd
   hook real TMDB data into: swap MOVIES/SERIES for a fetch() result with
   the same shape, and everything below keeps working unchanged.
   ========================================================================== */

function createMediaCard(item, kind) {
  const card = document.createElement('a');
  card.className = 'media-card';
  card.href = `detail.html?id=${item.id}&type=${kind}`;

  const frameWrap = document.createElement('div');
  frameWrap.className = 'framed-poster framed-poster--grid is-interactive media-card__frame';
  frameWrap.style.position = 'relative';

  // badges
  if (item.badges && item.badges.length) {
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'media-card__badges';
    item.badges.forEach(b => {
      const badge = document.createElement('span');
      badge.className = 'media-badge' + (b === 'IMAX' ? ' media-badge--imax' : '');
      badge.textContent = b;
      badgeWrap.appendChild(badge);
    });
    frameWrap.appendChild(badgeWrap);
  }

  // poster image or placeholder gradient+title
  if (item.poster) {
    const img = document.createElement('img');
    img.className = 'framed-poster__img';
    img.src = item.poster;
    img.alt = item.title;
    frameWrap.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'framed-poster__placeholder';
    placeholder.style.background = item.gradient || 'linear-gradient(160deg,#3a2a4a,#1a1a1a)';
    placeholder.textContent = item.title;
    frameWrap.appendChild(placeholder);
  }

  // progress bar, if mid-watch
  if (item.progress) {
    const progWrap = document.createElement('div');
    progWrap.className = 'media-card__progress-wrap';
    const progFill = document.createElement('div');
    progFill.className = 'media-card__progress-fill';
    progFill.style.width = item.progress + '%';
    progWrap.appendChild(progFill);
    frameWrap.appendChild(progWrap);
  }

  card.appendChild(frameWrap);

  const title = document.createElement('div');
  title.className = 'media-card__title';
  title.textContent = item.title;
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'media-card__meta';
  meta.textContent = kind === 'series'
    ? `${item.seasons} Seasons · ${item.genre}`
    : `${item.year} · ${item.genre}`;
  card.appendChild(meta);

  return card;
}

function renderRail(containerId, items, kind) {
  const container = document.getElementById(containerId);
  if (!container) return;
  items.forEach(item => container.appendChild(createMediaCard(item, kind)));
}

function renderGrid(containerId, items, kind) {
  const container = document.getElementById(containerId);
  if (!container) return;
  items.forEach(item => container.appendChild(createMediaCard(item, kind)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('movies-rail')) renderRail('movies-rail', MOVIES, 'movie');
  if (document.getElementById('series-rail')) renderRail('series-rail', SERIES, 'series');
  if (document.getElementById('movies-grid')) renderGrid('movies-grid', MOVIES, 'movie');
  if (document.getElementById('series-grid')) renderGrid('series-grid', SERIES, 'series');
});
