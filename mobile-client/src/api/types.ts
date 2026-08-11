export type MyFlixUser = {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
};

export type WatchProgress = {
  position: number;
  duration: number;
  percent: number;
  updatedAt: number;
};

export type PlaybackMarkers = {
  introStart: number | null;
  introEnd: number | null;
  creditsStart: number | null;
  introConfidence?: number | null;
  creditsConfidence?: number | null;
  source?: string | null;
};

export type Subtitle = { id: string; name: string; language: string; src: string };

export type MediaItem = {
  id: string;
  name: string;
  title: string;
  isShow: boolean;
  showId: string | null;
  showKey: string | null;
  showName: string | null;
  episode: { season: number; episode: number; episodeEnd?: number } | null;
  tmdbId: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  releaseDate: string | null;
  rating: number | null;
  runtime: number | null;
  genreNames: string[];
  qualityTags: string[];
  mimeType: string;
  available: boolean;
  streamUrl: string | null;
  subtitles: Subtitle[];
  isFavorite: boolean;
  watchProgress: WatchProgress | null;
  playbackMarkers: PlaybackMarkers | null;
};

export type ShowGroup = {
  id: string;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  releaseDate: string | null;
  rating: number | null;
  genreNames: string[];
  isFavorite: boolean;
  episodes: MediaItem[];
};

export type HealthResponse = {
  ok: boolean;
  database?: boolean;
  catalog?: { movies: number; shows: number; episodes: number };
};

export type Capabilities = {
  ok: boolean;
  serverVersion: string;
  hlsAvailable: boolean;
  ffmpegAvailable: boolean;
  signupAllowed: boolean;
  authRequired: boolean;
  playback: { default: 'direct'; compatibilityFallback: boolean };
};

export type PlaybackOptions = {
  ok: boolean;
  directPlay: boolean;
  defaultMode: 'direct';
  hlsAvailable: boolean;
  compatibilityFallback: { available: boolean; targetHeight: number };
  qualities: { label: string; height: number }[];
  source: { width: number | null; height: number | null; videoCodec: string | null; audioCodec: string | null; container: string | null };
};

export type HlsStatus = {
  state: 'idle' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  error?: string;
  mode: 'adaptive' | 'manual' | 'compatibility';
  cacheKey: string;
  masterUrl?: string;
  qualities?: string[];
};

export type AccountMeResponse = {
  ok: boolean;
  authenticated: boolean;
  user: MyFlixUser | null;
  allowSignup: boolean;
};

export type SessionResponse = { ok: true; user: MyFlixUser; sessionToken: string };
