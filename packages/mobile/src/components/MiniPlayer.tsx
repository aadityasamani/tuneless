// ──────────────────────────────────────────────
// Tuneless — MiniPlayer Component
// Persistent bottom bar showing now-playing track info,
// progress, play/pause, and next buttons.
// ──────────────────────────────────────────────

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, borderRadius, playerHeight } from '../theme/spacing';
import { formatSeconds } from '../utils/formatting';
import { usePlayerStore } from '../stores/playerStore';
import Artwork from './Artwork';
import ProgressSlider from './ProgressSlider';

interface MiniPlayerProps {
  onPress: () => void; // Open full player
}

export default function MiniPlayer({ onPress }: MiniPlayerProps) {
  const {
    queue,
    currentIndex,
    isPlaying,
    position,
    duration,
    progress,
    togglePlayPause,
    skipToNext,
    seekToFraction,
  } = usePlayerStore();

  const currentTrack = queue[currentIndex];

  // Poll progress while playing
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        usePlayerStore.getState().updateProgress();
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  if (!currentTrack) return null;

  return (
    <View style={styles.container}>
      {/* Thin progress bar at top */}
      <View style={styles.progressBarContainer}>
        <View
          style={[
            styles.progressBar,
            { width: `${Math.max(0, Math.min(100, progress * 100))}%` },
          ]}
        />
      </View>

      <TouchableOpacity style={styles.content} onPress={onPress} activeOpacity={0.9}>
        {/* Artwork */}
        <Artwork
          uri={currentTrack.thumbnail}
          size={44}
          borderRadius={borderRadius.sm}
          style={styles.artwork}
        />

        {/* Track info */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {currentTrack.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1} ellipsizeMode="tail">
            {currentTrack.artist}
          </Text>
        </View>

        {/* Controls */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={togglePlayPause}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.controlIcon}>
            {isPlaying ? '⏸' : '▶'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={skipToNext}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.controlIcon}>⏭</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  progressBarContainer: {
    height: 2,
    backgroundColor: colors.progressBg,
    width: '100%',
  },
  progressBar: {
    height: 2,
    backgroundColor: colors.progressFill,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    height: playerHeight,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  artwork: {},
  info: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  artist: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  controlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: {
    fontSize: 20,
    color: colors.text,
  },
});
