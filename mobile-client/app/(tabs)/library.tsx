import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MediaRail } from '../../src/components/media';
import { Screen, Title } from '../../src/components/ui';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { groupShows, movieItems } from '../../src/lib/library';
import { colors } from '../../src/theme';

type Filter = 'all' | 'movies' | 'shows' | 'favorites';

export default function LibraryScreen() {
  const { library, serverUrl, api, user, isDemo } = useMyFlix();
  const [filter, setFilter] = useState<Filter>('all');
  const movies = movieItems(library);
  const shows = groupShows(library);
  const favoriteMovies = movies.filter((item) => item.isFavorite);
  const favoriteShows = shows.filter((show) => show.isFavorite);
  return (
    <Screen demo={isDemo}>
      <Title>Your Library</Title>
      <View style={styles.filters}>{(['all', 'movies', 'shows', ...(user ? ['favorites'] : [])] as Filter[]).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
      {(filter === 'all' || filter === 'movies') && <MediaRail title="Movies" items={movies} serverUrl={serverUrl} headers={api.mediaHeaders()} />}
      {(filter === 'all' || filter === 'shows') && <MediaRail title="TV Shows" items={shows} serverUrl={serverUrl} headers={api.mediaHeaders()} />}
      {filter === 'favorites' && <><MediaRail title="Favorite Movies" items={favoriteMovies} serverUrl={serverUrl} headers={api.mediaHeaders()} /><MediaRail title="Favorite Shows" items={favoriteShows} serverUrl={serverUrl} headers={api.mediaHeaders()} /></>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 20 },
  filterActive: { backgroundColor: colors.burgundy, borderColor: colors.goldDim },
  filterText: { color: colors.muted, fontWeight: '700' },
  filterTextActive: { color: colors.text },
});
