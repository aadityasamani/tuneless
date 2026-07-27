// ───���──────────────────────────────────────────
// Tuneless — Library Screen
// Playlists, liked songs, create, import
// ──────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { usePlaylistStore } from '../stores/playlistStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { useNavigation } from '@react-navigation/native';
import { parseCSV, parseSpotifyJSON } from '../services/playlistParser';
import PlaylistCard from '../components/PlaylistCard';
import EmptyState from '../components/EmptyState';
import Toast from '../components/Toast';
import type { Playlist, Track } from '../types';
import { buildShuffleOrder } from '../utils/shuffle';

export default function LibraryScreen() {
  const navigation = useNavigation<any>();
  const { playlists, addPlaylist, removePlaylist, createPlaylist } = usePlaylistStore();
  const { likedIds } = useLikesStore();
  const { setQueue, toggleShuffle, shuffle } = usePlayerStore();
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as const });

  const showToast = (m: string, t: 'info' | 'success' | 'warning' | 'error' = 'info') => setToast({ visible: true, message: m, type: t });

  const handleImport = useCallback(async () => {
    try {
      let picked: any;
      try {
        const DP = require('react-native-document-picker');
        const result = await DP.pick({ type: [DP.types.allFiles] });
        picked = result[0];
      } catch (err: any) { if (err?.code !== 'DOCUMENT_PICKER_CANCELED') showToast('Picker unavailable', 'error'); return; }
      if (!picked) return;
      setImporting(true);
      const RNFS = require('react-native-fs');
      const content = await RNFS.readFile(picked.uri, 'utf8');
      const fn = (picked.name || '').toLowerCase();
      const now = Date.now();
      let pl: Playlist;

      if (fn.endsWith('.csv')) {
        const tracks = parseCSV(content);
        pl = { id: `pl-${now}`, name: picked.name?.replace(/\.csv$/i, '') || 'CSV', tracks, duration: 0, createdAt: now, updatedAt: now, sourceLabel: 'CSV' };
      } else if (fn.endsWith('.json')) {
        const parsed = parseSpotifyJSON(content);
        pl = { id: `pl-${now}`, name: parsed.name || picked.name?.replace(/\.json$/i, '') || 'Spotify', tracks: parsed.tracks, duration: parsed.tracks.reduce((s: number, t: any) => s + t.duration, 0), createdAt: now, updatedAt: now, sourceLabel: parsed.sourceLabel };
      } else { showToast('Use .csv or .json', 'warning'); setImporting(false); return; }

      await addPlaylist(pl);
      showToast(`Imported "${pl.name}" (${pl.tracks.length} tracks)`, 'success');
    } catch (err: any) { showToast(err.message || 'Import failed', 'error'); }
    finally { setImporting(false); }
  }, [addPlaylist]);

  const handleCreatePlaylist = useCallback(() => {
    Alert.prompt('New Playlist', 'Enter a name:', async (name) => {
      if (name?.trim()) {
        const pl = await createPlaylist(name.trim());
        navigation.navigate('PlaylistDetail', { playlistId: pl.id });
      }
    });
  }, [createPlaylist, navigation]);

  const handleShufflePlay = useCallback(async (playlist: Playlist) => {
    if (!playlist.tracks.length) return;
    const tracks: Track[] = playlist.tracks.map(pt => ({ id: pt.ytId || pt.searchQuery, title: pt.title, artist: pt.artist, duration: pt.duration }));
    await setQueue(tracks, 0);
    if (!shuffle) await toggleShuffle();
    navigation.navigate('FullPlayer');
  }, [setQueue, shuffle, toggleShuffle, navigation]);

  const handleDelete = useCallback((p: Playlist) => {
    Alert.alert('Delete', `Remove "${p.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removePlaylist(p.id) },
    ]);
  }, [removePlaylist]);

  // Build items list with Liked Songs at top
  const allItems: Array<{ type: 'liked' } | { type: 'pl'; playlist: Playlist }> = [
    ...(likedIds.length > 0 ? [{ type: 'liked' as const }] : []),
    ...playlists.map(pl => ({ type: 'pl' as const, playlist: pl })),
  ];

  const renderItem = useCallback(({ item }: { item: typeof allItems[0] }) => {
    if (item.type === 'liked') {
      return (
        <TouchableOpacity style={s.likedCard} onPress={() => navigation.navigate('PlaylistDetail', { playlistId: '__liked' })}>
          <View style={s.likedArt}><Text style={s.likedIcon}>❤</Text></View>
          <View style={s.plInfo}>
            <Text style={s.plName}>Liked Songs</Text>
            <Text style={s.plMeta}>{likedIds.length} song{likedIds.length !== 1 ? 's' : ''}</Text>
          </View>
        </TouchableOpacity>
      );
    }
    return (
      <PlaylistCard
        playlist={item.playlist}
        onPress={() => navigation.navigate('PlaylistDetail', { playlistId: item.playlist.id })}
        onShuffle={() => handleShufflePlay(item.playlist)}
        onDelete={() => handleDelete(item.playlist)}
      />
    );
  }, [likedIds.length, navigation, handleShufflePlay, handleDelete]);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Library</Text>
        <TouchableOpacity style={s.createBtn} onPress={handleCreatePlaylist}>
          <Text style={s.createBtnIcon}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.importBtn, importing && s.disabled]} onPress={handleImport} disabled={importing}>
          <Text style={s.importLabel}>Import</Text>
        </TouchableOpacity>
      </View>
      {importing && <View style={s.banner}><Text style={s.bannerText}>Importing...</Text></View>}
      {allItems.length > 0 ? (
        <FlatList data={allItems} renderItem={renderItem} keyExtractor={(_, i) => String(i)} contentContainerStyle={s.list} showsVerticalScrollIndicator={false} />
      ) : (
        <EmptyState icon="📚" title="No playlists yet" subtitle="Tap + to create or Import to add from CSV" />
      )}
      <Toast visible={toast.visible} message={toast.message} type={toast.type} onDismiss={() => setToast(p => ({ ...p, visible: false }))} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1 },
  createBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  createBtnIcon: { fontSize: 22, color: colors.bg, fontWeight: '700', lineHeight: 24 },
  importBtn: { backgroundColor: colors.surface2, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.sm },
  disabled: { opacity: 0.5 },
  importLabel: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  banner: { backgroundColor: colors.accentBg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginHorizontal: spacing.lg, borderRadius: borderRadius.sm, marginBottom: spacing.sm },
  bannerText: { ...typography.bodySmall, color: colors.accent, textAlign: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  likedCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  likedArt: { width: 48, height: 48, borderRadius: 8, backgroundColor: 'rgba(231,76,60,0.15)', alignItems: 'center', justifyContent: 'center' },
  likedIcon: { fontSize: 20 },
  plInfo: { flex: 1 },
  plName: { ...typography.body, color: colors.text, fontWeight: '600' },
  plMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});
