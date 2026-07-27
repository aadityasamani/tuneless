// ──────────────────────────────────────────────
// Tuneless — Discover Screen
// Recently played, recommendations
// ──────────────────────────────────────────────

import React, { useCallback, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { usePlayerStore } from '../stores/playerStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlaylistStore } from '../stores/playlistStore';
import { buildRecommendations } from '../services/recommendations';
import { useNavigation } from '@react-navigation/native';
import Artwork from '../components/Artwork';
import EmptyState from '../components/EmptyState';
import type { Track, RecommendedTrack } from '../types';

export default function DiscoverScreen() {
  const navigation = useNavigation<any>();
  const { queue, currentIndex, setQueue } = usePlayerStore();
  const { likedIds } = useLikesStore();
  const { playlists } = usePlaylistStore();

  const [recs, setRecs] = React.useState<RecommendedTrack[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recents, setRecents] = React.useState<Track[]>([]);

  useEffect(() => {
    try {
      const raw = require('react-native').AsyncStorage.getItem('tl_recents');
      raw.then((r: string | null) => { if (r) setRecents(JSON.parse(r).slice(0, 20)); }).catch(() => {});
    } catch {}
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 100));
    const result = buildRecommendations(playlists, recents, new Set(likedIds), queue, 20);
    setRecs(result);
    setLoading(false);
  }, [playlists, recents, likedIds, queue]);

  const handlePlayRecommended = useCallback(async (rec: RecommendedTrack) => {
    const track: Track = { id: rec.id, title: rec.title, artist: rec.artist, duration: 0, thumbnail: rec.thumbnail };
    await setQueue([track], 0);
    navigation.navigate('FullPlayer');
  }, [setQueue, navigation]);

  const items = [
    ...(recs.length > 0 ? [{ type: 'section' as const, label: 'Recommended for You' }] : []),
    ...(recs.length > 0 ? recs.map(r => ({ type: 'rec' as const, rec: r })) : []),
    ...(recents.length > 3 ? [{ type: 'section' as const, label: 'Recently Played' }] : []),
    ...(recents.length > 3 ? recents.slice(0, 10).map((t, i) => ({ type: 'recent' as const, track: t, idx: i })) : []),
  ];

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Discover</Text>
        <TouchableOpacity style={s.refreshBtn} onPress={handleRefresh} disabled={loading}>
          <Text style={s.refreshText}>{loading ? '...' : 'Find Music'}</Text>
        </TouchableOpacity>
      </View>

      {loading && <View style={s.centered}><ActivityIndicator size="large" color={colors.accent} /></View>}

      {!loading && items.length === 0 && (
        <EmptyState icon="🎵" title="Start listening" subtitle="Play some songs and come back for recommendations" />
      )}

      {!loading && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => {
            if (item.type === 'section') {
              return <Text style={s.sectionLabel}>{item.label}</Text>;
            }
            if (item.type === 'rec') {
              return (
                <TouchableOpacity style={s.item} onPress={() => handlePlayRecommended(item.rec)}>
                  <Artwork uri={item.rec.thumbnail} size={44} />
                  <View style={s.info}>
                    <Text style={s.itemTitle} numberOfLines={1}>{item.rec.title}</Text>
                    <Text style={s.itemArtist} numberOfLines={1}>{item.rec.artist}</Text>
                    {item.rec.reason && <Text style={s.reason} numberOfLines={1}>{item.rec.reason}</Text>}
                  </View>
                  <Text style={s.source}>{item.rec.source}</Text>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity style={s.item} onPress={() => {
                const t: Track = { id: item.track.id, title: item.track.title, artist: item.track.artist, duration: item.track.duration, thumbnail: item.track.thumbnail };
                setQueue([t], 0).then(() => navigation.navigate('FullPlayer'));
              }}>
                <Artwork uri={item.track.thumbnail} size={40} />
                <View style={s.info}>
                  <Text style={s.itemTitle} numberOfLines={1}>{item.track.title}</Text>
                  <Text style={s.itemArtist} numberOfLines={1}>{item.track.artist}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md },
  headerTitle: { ...typography.h1, color: colors.text },
  refreshBtn: { backgroundColor: colors.accent, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: borderRadius.sm },
  refreshText: { ...typography.body, color: colors.bg, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { ...typography.label, color: colors.textSecondary, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, gap: spacing.md },
  info: { flex: 1 },
  itemTitle: { ...typography.body, color: colors.text },
  itemArtist: { ...typography.bodySmall, color: colors.textSecondary },
  reason: { ...typography.monoSmall, color: colors.accent, marginTop: 2 },
  source: { ...typography.monoSmall, color: colors.textMuted },
});
