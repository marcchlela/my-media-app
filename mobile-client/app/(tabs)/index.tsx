import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Brand, Screen, uiStyles } from '../../src/components/ui';
import { MediaRail } from '../../src/components/media';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { continueWatching, groupShows, movieItems } from '../../src/lib/library';
import { colors } from '../../src/theme';

export default function HomeScreen() {
  const { serverUrl, user, library, api } = useMyFlix();
  const movies = movieItems(library);
  const shows = groupShows(library);
  const watching = continueWatching(library);
  const favorites = [...movies.filter((item) => item.isFavorite), ...shows.filter((show) => show.isFavorite)];
  const recent = [...movies].reverse().slice(0, 12);

  return (
    <Screen>
      <View style={styles.header}><Brand /><Text style={styles.greeting}>{user ? `Welcome back, ${user.firstName}` : 'Your private screening room'}</Text></View>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>TONIGHT AT MYFLIX</Text>
        <Text style={styles.heroTitle}>{watching[0]?.isShow ? watching[0].showName : watching[0]?.title || movies[0]?.title || 'The lounge is ready'}</Text>
        <Text style={uiStyles.muted}>{watching.length ? 'Continue where you left off across all your MyFlix devices.' : 'Choose a title from your private collection and settle in.'}</Text>
      </View>
      {user && <MediaRail title="Continue Watching" items={watching} serverUrl={serverUrl} headers={api.mediaHeaders()} emptyText="Start a title and it will wait for you here." resume />}
      <MediaRail title="Recently Added" items={recent} serverUrl={serverUrl} headers={api.mediaHeaders()} />
      {user && <MediaRail title="Favorites" items={favorites} serverUrl={serverUrl} headers={api.mediaHeaders()} emptyText="Tap the heart on a movie or show to frame it here." />}
      <MediaRail title="Movies" items={movies} serverUrl={serverUrl} headers={api.mediaHeaders()} />
      <MediaRail title="TV Shows" items={shows} serverUrl={serverUrl} headers={api.mediaHeaders()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 12 },
  greeting: { color: colors.muted, fontSize: 13 },
  hero: { minHeight: 180, borderRadius: 22, padding: 22, justifyContent: 'flex-end', gap: 9, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.goldDim },
  heroEyebrow: { color: colors.gold, fontSize: 11, letterSpacing: 2.2, fontWeight: '800' },
  heroTitle: { color: colors.text, fontSize: 28, fontWeight: '900' },
});
