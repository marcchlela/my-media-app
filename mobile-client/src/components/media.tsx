import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MediaItem, ShowGroup } from '../api/types';
import { joinServerUrl } from '../lib/server-url';
import { colors } from '../theme';
import { Poster, ProgressBar, Title, uiStyles } from './ui';

type MediaTarget = MediaItem | ShowGroup;

export function imageUrl(path: string | null | undefined, serverUrl: string): string | null {
  const value = String(path || '').trim();
  if (!value) return null;
  if (/^https?:/i.test(value)) return value;
  if (value.startsWith('/api/')) return joinServerUrl(serverUrl, value);
  return `https://image.tmdb.org/t/p/w500${value}`;
}

function isShowGroup(target: MediaTarget): target is ShowGroup {
  return 'episodes' in target;
}

export function MediaCard({ target, serverUrl, headers, resume = false }: { target: MediaTarget; serverUrl: string; headers?: Record<string, string>; resume?: boolean }) {
  const show = isShowGroup(target);
  const title = show ? target.name : target.isShow ? target.showName || target.title : target.title;
  const progress = show ? null : target.watchProgress;
  const open = () => {
    if (resume && !show) {
      router.push({ pathname: '/player/[id]', params: { id: target.id } });
      return;
    }
    router.push({
      pathname: '/details/[kind]/[id]',
      params: { kind: show || target.isShow ? 'show' : 'movie', id: show ? target.id : target.isShow ? target.showId || target.id : target.id },
    });
  };
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={open}>
      <Poster source={imageUrl(target.posterPath, serverUrl)} title={title} headers={headers} />
      <Text numberOfLines={2} style={styles.cardTitle}>{title}</Text>
      {progress && <ProgressBar percent={progress.percent} />}
    </Pressable>
  );
}

export function MediaRail({ title, items, serverUrl, headers, emptyText, resume = false }: {
  title: string; items: MediaTarget[]; serverUrl: string; headers?: Record<string, string>; emptyText?: string; resume?: boolean;
}) {
  return (
    <View style={styles.section}>
      <Title>{title}</Title>
      {items.length ? (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(item) => `${'episodes' in item ? 'show' : 'media'}-${item.id}`}
          renderItem={({ item }) => <MediaCard target={item} serverUrl={serverUrl} headers={headers} resume={resume} />}
          contentContainerStyle={styles.rail}
          showsHorizontalScrollIndicator={false}
        />
      ) : <Text style={uiStyles.muted}>{emptyText || 'Nothing is showing here yet.'}</Text>}
    </View>
  );
}

export function Rating({ value }: { value: number | null }) {
  if (!value) return null;
  return <View style={styles.rating}><Ionicons name="star" size={14} color={colors.gold} /><Text style={styles.ratingText}>{value.toFixed(1)}</Text></View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  rail: { gap: 14, paddingHorizontal: 2, paddingBottom: 16 },
  card: { width: 132, gap: 8 },
  cardTitle: { color: colors.text, fontWeight: '700', lineHeight: 18 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingText: { color: colors.gold, fontWeight: '800' },
});
