/* ==========================================================================
   data.js — sample library data.
   Replace `poster` with a real image path (e.g. "posters/inception.jpg")
   once you're importing real TMDB artwork. Leave it null to keep the
   placeholder gradient + title treatment.
   ========================================================================== */

const MOVIES = [
  { id: 'pulp-fiction', title: 'Pulp Fiction', year: 1994, genre: 'Crime', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#c9342f,#1a1a1a)' },
  { id: 'casablanca', title: 'Casablanca', year: 1942, genre: 'Romance', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#c9a35c,#5a4322)' },
  { id: 'inception', title: 'Inception', year: 2010, genre: 'Sci-Fi', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#3a4a6a,#0a0e1a)' },
  { id: 'dark-knight', title: 'The Dark Knight', year: 2008, genre: 'Action', badges: ['IMAX'], progress: null, poster: null, gradient: 'linear-gradient(160deg,#2a2a32,#08080a)' },
  { id: 'spirited-away', title: 'Spirited Away', year: 2001, genre: 'Animation', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#c96a3a,#5a2a1a)' },
  { id: 'lotr-rotk', title: 'The Lord of the Rings: ROTK', year: 2003, genre: 'Fantasy', badges: ['CC'], progress: null, poster: null, gradient: 'linear-gradient(160deg,#5a4a2a,#1a140a)' },
  { id: 'django', title: 'Django Unchained', year: 2012, genre: 'Western', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#8a2a1a,#1a0a0a)' },
  { id: 'goodfellas', title: 'GoodFellas', year: 1990, genre: 'Crime', badges: [], progress: null, poster: null, gradient: 'linear-gradient(160deg,#3a3a3a,#0a0a0a)' },
  { id: 'interstellar', title: 'Interstellar', year: 2014, genre: 'Sci-Fi', badges: ['IMAX', 'CC'], progress: 62, poster: null, gradient: 'linear-gradient(160deg,#1a2a4a,#0a1020)' },
  { id: 'grand-budapest', title: 'The Grand Budapest Hotel', year: 2014, genre: 'Comedy', badges: [], progress: 45, poster: null, gradient: 'linear-gradient(160deg,#d9b96a,#8a5a2a)', director: 'Wes Anderson', cast: ['Ralph Fiennes', 'Tony Revolori', 'Saoirse Ronan'] },
];

const SERIES = [
  { id: 'got', title: 'Game of Thrones', seasons: 8, genre: 'Fantasy', badges: [], poster: null, gradient: 'linear-gradient(160deg,#4a4a4a,#0a0a0a)' },
  { id: 'breaking-bad', title: 'Breaking Bad', seasons: 5, genre: 'Drama', badges: [], poster: null, gradient: 'linear-gradient(160deg,#5a6a2a,#1a1a0a)' },
  { id: 'the-crown', title: 'The Crown', seasons: 6, genre: 'Drama', badges: ['CC'], poster: null, gradient: 'linear-gradient(160deg,#3a2a4a,#0a0a1a)' },
  { id: 'sherlock', title: 'Sherlock', seasons: 4, genre: 'Mystery', badges: [], poster: null, gradient: 'linear-gradient(160deg,#2a2a2a,#0a0a0a)' },
  { id: 'stranger-things', title: 'Stranger Things', seasons: 4, genre: 'Sci-Fi', badges: [], poster: null, gradient: 'linear-gradient(160deg,#7a1a1a,#1a0a1a)' },
  { id: 'mandalorian', title: 'The Mandalorian', seasons: 3, genre: 'Sci-Fi', badges: ['IMAX'], poster: null, gradient: 'linear-gradient(160deg,#2a3a4a,#0a0a14)' },
];
