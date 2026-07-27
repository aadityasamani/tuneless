// ─���────────────────────────────────────────────
// Tuneless — TrackCard Component
// Displays a single track with artwork, title, artist, duration.
// ──────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, borderRadius } from '../theme/spacing';
import { formatSeconds } from '../utils/formatting';
import Artwork from './Artwork';

interface TrackCardProps {
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
  /** Whether this track is currently playing */
  isActive?: boolean;
  /** Called when the card is pressed */
  onPress?: () => void;
  /** Optional trailing action (e.g. remove queue button) */
  trailing?: React.ReactNode;
}

export default function TrackCard({
  title,
  artist,
  duration,
  thumbnail,
  isActive = false,
  onPress,
  trailing,
}: TrackCardProps) {
  return (
    <TouchableOpacity
      style={[styles.card, isActive && styles.cardActive]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <Artwork
        uri={thumbnail}
        size={48}
        borderRadius={borderRadius.sm}
        style={styles.artwork}
      />

      <View style={styles.info}>
        <Text
          style={[styles.title, isActive && styles.titleActive]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        <Text
          style={[styles.artist, isActive && styles.artistActive]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {artist}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.duration}>{formatSeconds(duration)}</Text>
        {trailing && <View style={styles.trailing}>{trailing}</View>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: 'transparent',
  },
  cardActive: {
    backgroundColor: colors.accentBg,
  },
  artwork: {
    marginRight: spacing.md,
  },
  info: {
    flex: 1,
    marginRight: spacing.sm,
  },
  title: {
    ...typography.body,
    color: colors.text,
    marginBottom: 2,
  },
  titleActive: {
    color: colors.accent,
  },
  artist: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  artistActive: {
    color: colors.accentDim,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  duration: {
    ...typography.mono,
    color: colors.textMuted,
  },
  trailing: {},
});
