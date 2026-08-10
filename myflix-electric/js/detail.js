/* ==========================================================================
   detail.js — reads ?id=&type= from the URL and populates the detail page
   from MOVIES/SERIES in data.js. Falls back to the first movie if no
   match is found, so the page never renders empty during development.
   ========================================================================== */

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function findItem(id, type) {
  const list = type === 'series' ? SERIES : MOVIES;
  return list.find(i => i.id === id) || list[0];
}

document.addEventListener('DOMContentLoaded', () => {
  const type = getQueryParam('type') || 'movie';
  const id = getQueryParam('id') || (type === 'series' ? SERIES[0].id : MOVIES[0].id);
  const item = findItem(id, type);
  if (!item) return;

  // Title + poster
  document.getElementById('detail-title').textContent = item.title;
  document.title = item.title + ' — MyFlix';

  const placeholder = document.getElementById('detail-poster-placeholder');
  const posterFrame = document.getElementById('detail-poster');

  if (item.poster) {
    posterFrame.innerHTML = `<img class="framed-poster__img" src="${item.poster}" alt="${item.title}">`;
  } else {
    placeholder.style.background = item.gradient || 'linear-gradient(160deg,#3a2a4a,#1a1a1a)';
    placeholder.innerHTML = item.title.toUpperCase().split(' ').join('<br>');
  }

  // Kicker
  document.getElementById('detail-kicker-text').textContent =
    type === 'series' ? 'Series' : 'Featured Film';

  // Meta row
  const metaRow = document.getElementById('detail-meta-row');
  metaRow.innerHTML = '';
  const metaItems = type === 'series'
    ? [`${item.seasons} Seasons`, item.genre]
    : [item.year, item.genre];
  metaItems.forEach(m => {
    const span = document.createElement('span');
    span.textContent = m;
    metaRow.appendChild(span);
  });

  // Badges row
  const badgesRow = document.getElementById('detail-badges-row');
  badgesRow.innerHTML = '';
  (item.badges || []).forEach(b => {
    const span = document.createElement('span');
    span.className = 'detail-badge';
    span.textContent = b === 'CC' ? 'CC Available' : b;
    badgesRow.appendChild(span);
  });
  if (!item.badges || !item.badges.length) {
    badgesRow.style.display = 'none';
  }

  // Synopsis: generic placeholder text per item since data.js doesn't carry one.
  document.getElementById('detail-synopsis').textContent =
    `Sit back and enjoy ${item.title}, part of your personal collection. Replace this synopsis ` +
    `with real metadata pulled from TMDB when you wire up your importer.`;

  // Progress row only shown if mid-watch
  const progressRow = document.querySelector('.detail-progress-row');
  if (item.progress) {
    progressRow.querySelector('.progress-track__fill').style.width = item.progress + '%';
    progressRow.querySelectorAll('span')[0].textContent = item.progress + '% watched';
  } else {
    progressRow.style.display = 'none';
  }

  // Play button label
  const playBtn = document.querySelector('.detail-actions .btn-play');
  if (playBtn) {
    playBtn.lastChild.textContent = item.progress ? ' Resume Playing' : ' Play Now';
  }

  // Cast list: data.js doesn't carry cast/director info yet, so this is
  // hidden by default. Populate it once you wire up real TMDB data, e.g.
  // item.director and item.cast = ['Actor One', 'Actor Two', ...].
  const castList = document.getElementById('detail-cast-list');
  if (item.director || (item.cast && item.cast.length)) {
    if (item.director) {
      const chip = document.createElement('span');
      chip.className = 'cast-chip';
      chip.textContent = item.director + ', Director';
      castList.appendChild(chip);
    }
    (item.cast || []).forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'cast-chip';
      chip.textContent = name;
      castList.appendChild(chip);
    });
  } else {
    castList.style.display = 'none';
  }

  // Related rail: same genre, excluding current item
  const pool = type === 'series' ? SERIES : MOVIES;
  const related = pool.filter(i => i.id !== item.id && i.genre === item.genre);
  const fallbackRelated = pool.filter(i => i.id !== item.id).slice(0, 6);
  renderRail('related-rail', related.length ? related : fallbackRelated, type);
});
