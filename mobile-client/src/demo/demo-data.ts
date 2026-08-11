import type { Capabilities, MediaItem, MyFlixUser, WatchProgress } from '../api/types';

const now = Date.now();

function progress(position: number, duration: number, ageMinutes: number): WatchProgress {
  return {
    position,
    duration,
    percent: duration > 0 ? (position / duration) * 100 : 0,
    updatedAt: now - ageMinutes * 60_000,
  };
}

function media(input: Partial<MediaItem> & Pick<MediaItem, 'id' | 'title'>): MediaItem {
  const { id, title, ...overrides } = input;
  return {
    id,
    name: title,
    title,
    isShow: false,
    showId: null,
    showKey: null,
    showName: null,
    episode: null,
    tmdbId: null,
    posterPath: null,
    backdropPath: null,
    overview: null,
    releaseDate: null,
    rating: null,
    runtime: null,
    genreNames: [],
    qualityTags: ['1080p'],
    mimeType: 'video/mp4',
    available: true,
    streamUrl: `demo://${id}`,
    subtitles: [],
    isFavorite: false,
    watchProgress: null,
    playbackMarkers: null,
    ...overrides,
  };
}

function episode(show: {
  id: string;
  name: string;
  overview: string;
  genres: string[];
  favorite?: boolean;
}, season: number, number: number, title: string, input: Partial<MediaItem> = {}): MediaItem {
  return media({
    id: `demo_${show.id}_s${season}e${number}`,
    title,
    name: title,
    isShow: true,
    showId: show.id,
    showKey: show.id,
    showName: show.name,
    episode: { season, episode: number },
    overview: input.overview || show.overview,
    releaseDate: `202${Math.min(6, season)}-${String(number + 1).padStart(2, '0')}-14`,
    rating: 7.8 + number / 10,
    runtime: 48,
    genreNames: show.genres,
    qualityTags: ['1080p', 'CC'],
    isFavorite: !!show.favorite,
    playbackMarkers: { introStart: 8, introEnd: 64, creditsStart: 2_620, source: 'demo' },
    ...input,
  });
}

export const DEMO_USER: MyFlixUser = {
  id: -1,
  firstName: 'Alex',
  lastName: 'Lounge',
  fullName: 'Alex Lounge',
  email: 'demo@myflix.local',
  isAdmin: false,
};

export const DEMO_CAPABILITIES: Capabilities = {
  ok: true,
  serverVersion: 'development-demo',
  hlsAvailable: false,
  ffmpegAvailable: false,
  signupAllowed: true,
  authRequired: false,
  playback: { default: 'direct', compatibilityFallback: false },
};

export function createDemoLibrary(): MediaItem[] {
  const signalHouse = {
    id: 'demo_show_signal_house',
    name: 'Signal House',
    overview: 'A night-shift radio engineer discovers that an abandoned theatre is broadcasting messages from tomorrow.',
    genres: ['Mystery', 'Drama'],
    favorite: true,
  };
  const velvetFrequency = {
    id: 'demo_show_velvet_frequency',
    name: 'Velvet Frequency',
    overview: 'Two sound archivists follow a forgotten recording through hidden rooms beneath a coastal hotel.',
    genres: ['Drama', 'Adventure'],
  };

  return [
    media({
      id: 'demo_movie_meridian',
      title: 'Midnight at Meridian',
      overview: 'A projectionist has one night to restore a lost premiere before the old Meridian Cinema closes its doors.',
      releaseDate: '2025-10-18',
      rating: 8.4,
      runtime: 118,
      genreNames: ['Drama', 'Mystery'],
      qualityTags: ['4K', 'CC'],
      isFavorite: true,
      watchProgress: progress(2_780, 7_080, 4),
      playbackMarkers: { introStart: null, introEnd: null, creditsStart: 6_720, source: 'demo' },
    }),
    media({
      id: 'demo_movie_glass_orbit',
      title: 'The Glass Orbit',
      overview: 'A quiet observatory receives a signal that appears to be reflecting the memories of everyone listening.',
      releaseDate: '2024-06-07',
      rating: 7.9,
      runtime: 104,
      genreNames: ['Science Fiction', 'Thriller'],
      qualityTags: ['1080p', 'CC'],
    }),
    media({
      id: 'demo_movie_neon_harbor',
      title: 'Neon Harbor',
      overview: 'A ferry captain and a lounge singer unravel one final secret before sunrise reaches the harbor.',
      releaseDate: '2023-11-02',
      rating: 7.6,
      runtime: 96,
      genreNames: ['Crime', 'Romance'],
      qualityTags: ['720p'],
    }),
    episode(signalHouse, 1, 1, 'The Empty Frequency', { watchProgress: progress(2_880, 2_880, 240) }),
    episode(signalHouse, 1, 2, 'A Voice After Midnight', { watchProgress: progress(1_164, 2_880, 9) }),
    episode(signalHouse, 1, 3, 'The Red Dial'),
    episode(signalHouse, 2, 1, 'House Lights'),
    episode(velvetFrequency, 1, 1, 'The Archive Below'),
    episode(velvetFrequency, 1, 2, 'Room 17'),
  ].map((item) => ({
    ...item,
    episode: item.episode ? { ...item.episode } : null,
    genreNames: [...item.genreNames],
    qualityTags: [...item.qualityTags],
    subtitles: [...item.subtitles],
    watchProgress: item.watchProgress ? { ...item.watchProgress } : null,
    playbackMarkers: item.playbackMarkers ? { ...item.playbackMarkers } : null,
  }));
}
