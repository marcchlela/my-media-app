import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { imageUrl, Rating } from '../../../src/components/media';
import { Button, Poster, Screen, Title, uiStyles } from '../../../src/components/ui';
import { useMyFlix } from '../../../src/context/MyFlixContext';
import type { MediaItem, ShowGroup } from '../../../src/api/types';
import { groupShows } from '../../../src/lib/library';
import { colors } from '../../../src/theme';

function episodeCode(item: MediaItem) {
  return `S${String(item.episode?.season || 0).padStart(2, '0')}E${String(item.episode?.episode || 0).padStart(2, '0')}`;
}

export default function DetailsScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: 'movie' | 'show'; id: string }>();
  const app = useMyFlix();
  const movie = kind === 'movie' ? app.library.find((item) => item.id === id && !item.isShow) || null : null;
  const show = kind === 'show' ? groupShows(app.library).find((item) => item.id === id) || null : null;
  const [season, setSeason] = useState(show?.episodes[0]?.episode?.season || 1);
  const [error, setError] = useState('');
  const target = movie || show;
  if (!target) return <Screen><Button label="Back" icon="arrow-back" onPress={() => router.back()} variant="secondary" /><Text style={uiStyles.muted}>This title is no longer in the library.</Text></Screen>;

  const title = movie ? movie.title : (show as ShowGroup).name;
  const overview = target.overview || 'No description is available yet.';
  const posterPath = imageUrl(target.posterPath, app.serverUrl);
  const backdropPath = imageUrl(target.backdropPath, app.serverUrl);
  const isFavorite = target.isFavorite;
  const episodes = show?.episodes.filter((item) => item.episode?.season === season) || [];
  const seasons = show ? Array.from(new Set(show.episodes.map((item) => item.episode?.season || 0))) : [];

  async function favorite() {
    setError('');
    try {
      if (movie) await app.toggleFavorite(movie);
      else if (show) await app.toggleFavorite({ id: show.id, isShow: true, isFavorite: show.isFavorite });
    } catch (reason) { setError((reason as Error).message); }
  }

  function play(item: MediaItem) {
    router.push({ pathname: '/player/[id]', params: { id: item.id } });
  }

  return (
    <Screen style={styles.screen}>
      <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.text} /></Pressable>
      <ImageBackground source={backdropPath ? { uri: backdropPath, headers: app.api.mediaHeaders() } : undefined} style={styles.backdrop} imageStyle={styles.backdropImage}>
        <View style={styles.backdropShade} />
        <Poster source={posterPath} title={title} headers={app.api.mediaHeaders()} width={152} />
      </ImageBackground>
      <View style={styles.headingRow}><View style={styles.headingCopy}><Text style={styles.heading}>{title}</Text><View style={styles.metadata}><Rating value={target.rating} /><Text style={styles.metadataText}>{target.releaseDate?.slice(0, 4) || 'Year unknown'}</Text>{movie?.runtime ? <Text style={styles.metadataText}>{movie.runtime} min</Text> : null}</View></View><Pressable accessibilityLabel={isFavorite ? 'Remove favorite' : 'Add favorite'} style={[styles.favorite, isFavorite && styles.favoriteActive]} onPress={favorite}><Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={23} color={colors.text} /></Pressable></View>
      <Text style={styles.overview}>{overview}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {movie && <Button label="Play Movie" icon="play" onPress={() => play(movie)} disabled={!movie.available} />}
      {show && <>
        <Title>Seasons</Title>
        <View style={styles.seasons}>{seasons.map((number) => <Pressable key={number} style={[styles.season, number === season && styles.seasonActive]} onPress={() => setSeason(number)}><Text style={[styles.seasonText, number === season && styles.seasonTextActive]}>Season {number}</Text></Pressable>)}</View>
        <View style={styles.episodes}>{episodes.map((episode) => <Pressable key={episode.id} style={styles.episode} onPress={() => play(episode)} disabled={!episode.available}><View style={styles.episodeCopy}><Text style={styles.episodeCode}>{episodeCode(episode)}</Text><Text style={styles.episodeTitle}>{episode.title}</Text>{episode.watchProgress && <View style={styles.progressTextRow}><Text style={styles.episodeMeta}>{Math.round(episode.watchProgress.percent)}% watched</Text></View>}<Text numberOfLines={3} style={styles.episodeOverview}>{episode.overview || 'Episode details are not available.'}</Text></View><Ionicons name="play-circle" size={39} color={episode.available ? colors.gold : colors.muted} /></Pressable>)}</View>
      </>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 8 },
  back: { position: 'absolute', zIndex: 4, top: 20, left: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#100b0bcc' },
  backdrop: { height: 330, marginHorizontal: -18, marginTop: -18, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 22 },
  backdropImage: { opacity: 0.55 },
  backdropShade: { ...StyleSheet.absoluteFillObject, backgroundColor: '#100b0b55' },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headingCopy: { flex: 1, gap: 8 },
  heading: { color: colors.text, fontSize: 29, fontWeight: '900' },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  metadataText: { color: colors.muted },
  favorite: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 25, borderWidth: 1, borderColor: colors.line },
  favoriteActive: { backgroundColor: colors.burgundyBright, borderColor: colors.goldDim },
  overview: { color: '#d8cdb8', fontSize: 15, lineHeight: 23 },
  error: { color: colors.danger },
  seasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  season: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18 },
  seasonActive: { backgroundColor: colors.burgundy, borderColor: colors.gold },
  seasonText: { color: colors.muted, fontWeight: '700' },
  seasonTextActive: { color: colors.text },
  episodes: { gap: 11 },
  episode: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  episodeCopy: { flex: 1, gap: 5 },
  episodeCode: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  episodeTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  episodeMeta: { color: colors.burgundyBright, fontSize: 12, fontWeight: '800' },
  progressTextRow: { flexDirection: 'row' },
  episodeOverview: { color: colors.muted, lineHeight: 18, fontSize: 13 },
});
