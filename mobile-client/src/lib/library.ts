import type { MediaItem, ShowGroup } from '../api/types';

export function groupShows(items: MediaItem[]): ShowGroup[] {
  const groups = new Map<string, ShowGroup>();
  items.filter((item) => item.isShow && item.showId).forEach((episode) => {
    const showId = episode.showId as string;
    let group = groups.get(showId);
    if (!group) {
      group = {
        id: showId,
        name: episode.showName || 'TV Show',
        posterPath: episode.posterPath,
        backdropPath: episode.backdropPath,
        overview: episode.overview,
        releaseDate: episode.releaseDate,
        rating: episode.rating,
        genreNames: episode.genreNames || [],
        isFavorite: false,
        episodes: [],
      };
      groups.set(showId, group);
    }
    group.episodes.push(episode);
    group.isFavorite ||= episode.isFavorite;
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    episodes: group.episodes.sort((a, b) =>
      (a.episode?.season || 0) - (b.episode?.season || 0)
      || (a.episode?.episode || 0) - (b.episode?.episode || 0)),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function movieItems(items: MediaItem[]) {
  return items.filter((item) => !item.isShow).sort((a, b) => a.title.localeCompare(b.title));
}

export function continueWatching(items: MediaItem[]) {
  return items.filter((item) => {
    const percent = Number(item.watchProgress?.percent) || 0;
    return percent > 0 && percent < 92;
  }).sort((a, b) => Number(b.watchProgress?.updatedAt) - Number(a.watchProgress?.updatedAt));
}

export function findNextEpisode(items: MediaItem[], current: MediaItem): MediaItem | null {
  if (!current.isShow || !current.showId) return null;
  const episodes = items.filter((item) => item.showId === current.showId).sort((a, b) =>
    (a.episode?.season || 0) - (b.episode?.season || 0)
    || (a.episode?.episode || 0) - (b.episode?.episode || 0));
  const index = episodes.findIndex((episode) => episode.id === current.id);
  return index >= 0 ? episodes[index + 1] || null : null;
}

export function progressPayload(mediaId: string, position: number, duration: number, complete = false) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safePosition = complete ? safeDuration : Math.max(0, Math.min(Number(position) || 0, safeDuration));
  return {
    mediaId,
    position: safePosition,
    duration: safeDuration,
    percent: safeDuration > 0 ? Math.min(100, (safePosition / safeDuration) * 100) : 0,
    updatedAt: Date.now(),
  };
}

export function searchLibrary(items: MediaItem[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { movies: movieItems(items), shows: groupShows(items) };
  return {
    movies: movieItems(items).filter((item) => `${item.title} ${item.genreNames.join(' ')}`.toLocaleLowerCase().includes(needle)),
    shows: groupShows(items).filter((show) => `${show.name} ${show.genreNames.join(' ')}`.toLocaleLowerCase().includes(needle)),
  };
}
