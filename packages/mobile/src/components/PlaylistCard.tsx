// ──────────────────────────────────────────────
// Tuneless — PlaylistCard Component
// Displays a playlist with artwork, name, track count, duration,
// shuffle button, and delete.
// ──────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, borderRadius } from '../theme/spacing';
import { formatSeconds } from '../utils/formatting';
import type { Playlist } from '../types';
import Artwork from './Artwork';

interface PlaylistCardProps {
  playlist: Playlist;
  onPress?: () => void;
  onShuffle?: () => void;
  onDelete?: () => void;
}

export default function PlaylistCard({
  playlist,
  onPress,
  onShuffle,
  onDelete,
}: PlaylistCardProps) {
  const trackCount = playlist.tracks.length;
  const firstTrack = playlist.tracks[0];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Artwork
        uri={firstTrack?.ytId ? `https://img.youtube.com/vi/${firstTrack.ytId}/default.jpg` : undefined}
        size={56}
        borderRadius={borderRadius.md}
        style={styles.artwork}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {playlist.name}
        </Text>
        <Text style={styles.meta}>
          {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
          {playlist.duration > 0 && ` · ${formatSeconds(playlist.duration)}`}
        </Text>
        {playlist.sourceLabel && (
          <Text style={styles.source} numberOfLines={1}>
            {playlist.sourceLabel}
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        {onShuffle && (
          <TouchableOpacity
            style={styles.shuffleBtn}
            onPress={onShuffle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.shuffleIcon}>↻</Text>
          </TouchableOpacity>
        )}
        {onDelete && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  artwork: {
    marginRight: spacing.md,
  },
  info: {
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    ...typography.h3,
    color: colors.text,
    marginBottom: 2,
  },
  meta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  source: {
    ...typography.monoSmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shuffleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleIcon: {
    fontSize: 18,
    color: colors.accent,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(231,76,60,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '700',
  },
});
