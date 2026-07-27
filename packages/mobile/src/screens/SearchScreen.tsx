// ──────────────────────────────────────────────
// Tuneless — Search Screen
// YouTube search with play next & add to queue
// ──────────────────────────────────────────────

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { useSearchStore } from '../stores/searchStore';
import { usePlayerStore } from '../stores/playerStore';
import { useNavigation } from '@react-navigation/native';
import TrackCard from '../components/TrackCard';
import EmptyState from '../components/EmptyState';
import type { SearchResult, Track } from '../types';

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const { query, results, loading, error, executeSearch, setQuery } = useSearchStore();
  const { setQueue, addToQueue, addToQueueNext } = usePlayerStore();
  const [inputValue, setInputValue] = useState(query);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((text: string) => {
    setInputValue(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => executeSearch(text), 400);
  }, [executeSearch]);

  const handlePlayNow = useCallback(async (result: SearchResult) => {
    const track: Track = { id: result.id, title: result.title, artist: result.artist, duration: result.duration, thumbnail: result.thumbnail };
    await setQueue([track], 0);
    navigation.navigate('FullPlayer');
  }, [setQueue, navigation]);

  const handlePlayNext = useCallback(async (result: SearchResult) => {
    const track: Track = { id: result.id, title: result.title, artist: result.artist, duration: result.duration, thumbnail: result.thumbnail };
    await addToQueueNext(track);
  }, [addToQueueNext]);

  const handleAddToQueue = useCallback(async (result: SearchResult) => {
    const track: Track = { id: result.id, title: result.title, artist: result.artist, duration: result.duration, thumbnail: result.thumbnail };
    await addToQueue(track);
  }, [addToQueue]);

  const renderItem = useCallback(({ item }: { item: SearchResult }) => (
    <View style={s.itemRow}>
      <TrackCard
        title={item.title}
        artist={item.artist}
        duration={item.duration}
        thumbnail={item.thumbnail}
        onPress={() => handlePlayNow(item)}
        containerStyle={{ flex: 1 }}
      />
      <TouchableOpacity style={s.smallBtn} onPress={() => handlePlayNext(item)}>
        <Text style={s.smallBtnText}>+</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.smallBtn} onPress={() => handleAddToQueue(item)}>
        <Text style={s.smallBtnText}>���</Text>
      </TouchableOpacity>
    </View>
  ), [handlePlayNow, handlePlayNext, handleAddToQueue]);

  const keyExtractor = useCallback((item: SearchResult) => item.id, []);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Search</Text>
      </View>
      <View style={s.inputContainer}>
        <TextInput ref={inputRef} style={s.input} placeholder="Search YouTube..." placeholderTextColor={colors.textMuted}
          value={inputValue} onChangeText={handleSearch} onSubmitEditing={() => executeSearch(inputValue)}
          returnKeyType="search" autoCapitalize="none" autoCorrect={false} />
        {inputValue.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={() => { setInputValue(''); setQuery(''); }}>
            <Text style={s.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading && <View style={s.centered}><ActivityIndicator size="large" color={colors.accent} /></View>}
      {error && <View style={s.centered}><Text style={s.errorText}>{error}</Text></View>}
      {!loading && !error && results.length > 0 && (
        <FlatList data={results} renderItem={renderItem} keyExtractor={keyExtractor} contentContainerStyle={s.list} ItemSeparatorComponent={() => <View style={s.separator} />} />
      )}
      {!loading && !error && results.length === 0 && query.length > 0 && <EmptyState icon="🔍" title="No results found" subtitle="Try a different search term" />}
      {!loading && !error && results.length === 0 && query.length === 0 && <EmptyState icon="♪" title="Search for music" subtitle="Find any song on YouTube and play it instantly" />}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.text },
  inputContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.lg, marginBottom: spacing.lg, backgroundColor: colors.surface, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, ...typography.body, color: colors.text, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  clearBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  clearIcon: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  list: { paddingBottom: 120 },
  separator: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.md },
  smallBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  smallBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
});
