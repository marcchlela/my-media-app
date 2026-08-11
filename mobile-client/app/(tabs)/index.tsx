import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Brand, Poster, Screen, uiStyles } from '../../src/components/ui';
import { imageUrl, MediaRail } from '../../src/components/media';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { continueWatching, groupShows, movieItems } from '../../src/lib/library';
import { colors } from '../../src/theme';

export default function HomeScreen() {
  const { serverUrl, user, library, api, isDemo } = useMyFlix();
  const movies = movieItems(library);
  const shows = groupShows(library);
  const watching = continueWatching(library);
  const favorites = [...movies.filter((item) => item.isFavorite), ...shows.filter((show) => show.isFavorite)];
  const recent = [...movies].reverse().slice(0, 12);
  const heroItem = watching[0] || movies[0] || null;
  const heroTitle = heroItem?.isShow ? heroItem.showName || heroItem.title : heroItem?.title || 'The lounge is ready';

  return (
    <Screen demo={isDemo}>
      <View style={styles.header}><Brand /><Text style={styles.greeting}>{user ? `Welcome back, ${user.firstName}` : 'Your private screening room'}</Text></View>
      <View style={styles.hero}>
        <View style={styles.heroCopy}><Text style={styles.heroEyebrow}>TONIGHT AT MYFLIX</Text><Text style={styles.heroTitle}>{heroTitle}</Text><Text style={uiStyles.muted}>{watching.length ? 'Continue where you left off across all your MyFlix devices.' : 'Choose a title from your private collection and settle in.'}</Text></View>
        {heroItem && <Poster source={imageUrl(heroItem.posterPath, serverUrl)} title={heroTitle} headers={api.mediaHeaders()} width={92} />}
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
  hero: { minHeight: 188, borderRadius: 22, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.goldDim },
  heroCopy: { flex: 1, justifyContent: 'center', gap: 9 },
  heroEyebrow: { color: colors.gold, fontSize: 11, letterSpacing: 2.2, fontWeight: '800' },
  heroTitle: { color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: '900' },
});
