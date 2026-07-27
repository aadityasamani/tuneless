// ─���────────���───────────────────────────────────
// Tuneless — QueueScreen
// Queue list with clear all and remove individual tracks.
// ──────────────────────────────────────────────

import React, { useCallback } from 'react';
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
import { spacing } from '../theme/spacing';
import { usePlayerStore } from '../stores/playerStore';
import { useNavigation } from '@react-navigation/native';
import TrackCard from '../components/TrackCard';
import EmptyState from '../components/EmptyState';
import type { Track } from '../types';

export default function QueueScreen() {
  const navigation = useNavigation<any>();
  const {
    queue,
    currentIndex,
    isPlaying,
    activePlaylistId,
    shuffle,
    toggleShuffle,
    clearQueue,
    removeFromQueue,
  } = usePlayerStore();

  const handleClear = useCallback(() => {
    if (queue.length === 0) return;

    Alert.alert('Clear Queue', 'Remove all tracks from the queue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => clearQueue(),
      },
    ]);
  }, [queue.length, clearQueue]);

  const handleRemove = useCallback(
    (index: number) => {
      removeFromQueue(index);
    },
    [removeFromQueue],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Track; index: number }) => (
      <TrackCard
        title={item.title}
        artist={item.artist}
        duration={item.duration}
        thumbnail={item.thumbnail}
        isActive={index === currentIndex}
        trailing={
          <TouchableOpacity
            onPress={() => handleRemove(index)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.removeIcon}>✕</Text>
          </TouchableOpacity>
        }
      />
    ),
    [currentIndex, handleRemove],
  );

  const keyExtractor = useCallback(
    (item: Track, index: number) => `${item.id}-${index}`,
    [],
  );

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
          <Text style={styles.headerTitle}>Queue</Text>
          <Text style={styles.headerMeta}>
            {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
            {activePlaylistId && ' · from playlist'}
          </Text>
        </View>

        {queue.length > 0 && (
          <View style={styles.headerActions}>
            {/* Shuffle toggle */}
            <TouchableOpacity
              style={[styles.shuffleToggle, shuffle && styles.shuffleActive]}
              onPress={toggleShuffle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.shuffleIcon,
                  { color: shuffle ? colors.shuffleOn : colors.shuffleOff },
                ]}
              >
                ↻
              </Text>
            </TouchableOpacity>

            {/* Clear */}
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Tracks */}
      {queue.length > 0 ? (
        <FlatList
          data={queue}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <EmptyState
          icon="♪"
          title="Queue is empty"
          subtitle="Search for music or play a playlist to add tracks"
        />
      )}
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  shuffleToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleActive: {
    backgroundColor: colors.accentBg,
  },
  shuffleIcon: {
    fontSize: 20,
    fontWeight: '700',
  },
  clearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(231,76,60,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearIcon: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '700',
  },
  list: {
    paddingBottom: 120,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
  removeIcon: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
  },
});
