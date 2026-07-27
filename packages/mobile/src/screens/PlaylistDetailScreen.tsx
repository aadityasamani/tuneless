// ──────────────────────────────────────────────
// Tuneless — PlaylistDetailScreen
// Playlist track list with shuffle all, play individual tracks.
// ──────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, borderRadius } from '../theme/spacing';
import { formatSeconds } from '../utils/formatting';
import { usePlaylistStore } from '../stores/playlistStore';
import { useLikesStore } from '../stores/likesStore';
import { usePlayerStore } from '../stores/playerStore';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import TrackCard from '../components/TrackCard';
import EmptyState from '../components/EmptyState';
import Toast from '../components/Toast';
import type { PlaylistTrack, Track, RootStackParamList } from '../types';
import type { Playlist } from '../types';

type PlaylistDetailRoute = RouteProp<RootStackParamList, 'PlaylistDetail'>;

export default function PlaylistDetailScreen() {
  const route = useRoute<PlaylistDetailRoute>();
  const navigation = useNavigation<any>();
  const { playlistId } = route.params;

  const { playlists, updatePlaylist } = usePlaylistStore();
  const { likedIds } = useLikesStore();
  const { setQueue, setActivePlaylist, currentIndex, isPlaying } = usePlayerStore();
  const [toast, setToast] = React.useState<{
    visible: boolean;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }>({ visible: false, message: '', type: 'info' });
  const [resolving, setResolving] = React.useState(false);

  const isLikedPlaylist = playlistId === '__liked';

  const playlist = useMemo(() => {
    if (isLikedPlaylist) {
      const likedIdsArr = likedIds;
      return likedIdsArr.length > 0 ? { id: '__liked', name: 'Liked Songs', tracks: likedIdsArr.map((id: string) => ({ id, title: 'Liked Song', artist: '', searchQuery: '', ytId: id, duration: 0 })), duration: 0, createdAt: Date.now(), updatedAt: Date.now() } : null;
    }
    return playlists.find((p) => p.id === playlistId);
  }, [playlists, playlistId, isLikedPlaylist, likedIds]);

  const showToast = (
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
  ) => {
    setToast({ visible: true, message, type });
  };

  const handlePlayAll = useCallback(async () => {
    if (!playlist || playlist.tracks.length === 0) return;

    const tracks: Track[] = playlist.tracks.map((pt) => ({
      id: pt.ytId || pt.searchQuery,
      title: pt.title,
      artist: pt.artist,
      duration: pt.duration,
    }));

    setActivePlaylist(playlist.id, tracks);
    await setQueue(tracks, 0);
    navigation.navigate('FullPlayer');
  }, [playlist, setQueue, setActivePlaylist, navigation]);

  const handleShufflePlay = useCallback(async () => {
    if (!playlist || playlist.tracks.length === 0) return;

    const tracks: Track[] = playlist.tracks.map((pt) => ({
      id: pt.ytId || pt.searchQuery,
      title: pt.title,
      artist: pt.artist,
      duration: pt.duration,
    }));

    setActivePlaylist(playlist.id, tracks);

    // Shuffle manually
    const { buildShuffleOrder } = require('../utils/shuffle');
    const order = buildShuffleOrder(tracks);
    const shuffledTracks = order.map((i: number) => tracks[i]);

    await setQueue(shuffledTracks, 0);
    navigation.navigate('FullPlayer');
  }, [playlist, setQueue, setActivePlaylist, navigation]);

  const handlePlayTrack = useCallback(
    async (trackIndex: number) => {
      if (!playlist) return;

      const tracks: Track[] = playlist.tracks.map((pt) => ({
        id: pt.ytId || pt.searchQuery,
        title: pt.title,
        artist: pt.artist,
        duration: pt.duration,
      }));

      setActivePlaylist(playlist.id, tracks);
      await setQueue(tracks, trackIndex);
      navigation.navigate('FullPlayer');
    },
    [playlist, setQueue, setActivePlaylist, navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PlaylistTrack; index: number }) => (
      <TrackCard
        title={item.title}
        artist={item.artist}
        duration={item.duration}
        onPress={() => handlePlayTrack(index)}
      />
    ),
    [handlePlayTrack],
  );

  const keyExtractor = useCallback((item: PlaylistTrack) => item.id, []);

  if (!playlist) {
    return (
      <View style={styles.container}>
        <EmptyState icon="⚠" title="Playlist not found" />
      </View>
    );
  }

  // Calculate total duration from known durations
  const totalDuration = playlist.tracks.reduce((sum, t) => sum + t.duration, 0);
  const resolvedCount = playlist.tracks.filter((t) => t.ytId).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {playlist.name}
          </Text>
          <Text style={styles.headerMeta}>
            {playlist.tracks.length} tracks
            {totalDuration > 0 && ` · ${formatSeconds(totalDuration)}`}
            {resolvedCount > 0 && ` · ${resolvedCount} resolved`}
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handlePlayAll}
          disabled={playlist.tracks.length === 0}
        >
          <Text style={styles.actionIcon}>���</Text>
          <Text style={styles.actionLabel}>Play All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.shuffleBtn]}
          onPress={handleShufflePlay}
          disabled={playlist.tracks.length === 0}
        >
          <Text style={styles.actionIcon}>↻</Text>
          <Text style={styles.actionLabel}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      {/* Track list */}
      {playlist.tracks.length > 0 ? (
        <FlatList
          data={playlist.tracks}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <EmptyState
          icon="♪"
          title="No tracks"
          subtitle="This playlist is empty"
        />
      )}

      {/* Toast */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backIcon: {
    fontSize: 24,
    color: colors.text,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text,
  },
  headerMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
  },
  shuffleBtn: {
    backgroundColor: colors.surface2,
  },
  actionIcon: {
    fontSize: 16,
    color: colors.bg,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.bg,
  },
  list: {
    paddingBottom: 120,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
});
