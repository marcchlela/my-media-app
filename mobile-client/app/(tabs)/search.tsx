import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { MediaRail } from '../../src/components/media';
import { Screen, Title } from '../../src/components/ui';
import { useMyFlix } from '../../src/context/MyFlixContext';
import { searchLibrary } from '../../src/lib/library';
import { colors } from '../../src/theme';

export default function SearchScreen() {
  const { library, serverUrl, api } = useMyFlix();
  const [query, setQuery] = useState('');
  const results = searchLibrary(library, query);
  return (
    <Screen>
      <Title>Search the lounge</Title>
      <View style={styles.search}><Ionicons name="search" color={colors.gold} size={20} /><TextInput value={query} onChangeText={setQuery} placeholder="Movies, shows, genres..." placeholderTextColor={colors.muted} style={styles.input} autoFocus /></View>
      <MediaRail title={`Movies${query ? ` (${results.movies.length})` : ''}`} items={results.movies} serverUrl={serverUrl} headers={api.mediaHeaders()} emptyText="No matching movies." />
      <MediaRail title={`TV Shows${query ? ` (${results.shows.length})` : ''}`} items={results.shows} serverUrl={serverUrl} headers={api.mediaHeaders()} emptyText="No matching shows." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15 },
  input: { flex: 1, color: colors.text, fontSize: 16 },
});
