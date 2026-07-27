// ──────────────────────────────────────────────
// Tuneless — Full Player Screen
// Full-screen player with shuffle, repeat, like, queue drawer
// ──���───────────────────────────────────────────

import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, FlatList } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { formatSeconds } from '../utils/formatting';
import { usePlayerStore } from '../stores/playerStore';
import { useLikesStore } from '../stores/likesStore';
import { useNavigation } from '@react-navigation/native';
import Artwork from '../components/Artwork';
import ProgressSlider from '../components/ProgressSlider';
import type { Track } from '../types';

export default function FullPlayerScreen() {
  const navigation = useNavigation<any>();
  const { queue, currentIndex, isPlaying, isBuffering, position, duration, progress, repeat, shuffle, togglePlayPause, skipToNext, skipToPrevious, seekToFraction, toggleShuffle, toggleRepeat, updateProgress } = usePlayerStore();
  const { likedIds, toggle: toggleLike } = useLikesStore();
  const [showQueue, setShowQueue] = useState(false);

  const currentTrack = queue[currentIndex];
  const isLiked = currentTrack ? likedIds.includes(currentTrack.id) : false;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isPlaying) { interval = setInterval(() => updateProgress(), 500); }
    return () => { if (interval) clearInterval(interval); };
  }, [isPlaying, updateProgress]);

  const handleLike = useCallback(() => { if (currentTrack) toggleLike(currentTrack.id); }, [currentTrack, toggleLike]);
  const handleQueuePress = useCallback(() => setShowQueue(v => !v), []);

  const getRepeatIcon = () => repeat === 'one' ? '🔂' : '🔁';
  const getRepeatColor = () => repeat !== 'off' ? colors.accent : colors.textMuted;
  const getShuffleColor = () => shuffle ? colors.accent : colors.textMuted;

  if (!currentTrack) {
    return (
      <View style={s.container}>
        <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.downIcon}>���</Text></TouchableOpacity></View>
        <View style={s.centered}><Text style={s.noTrackText}>No track playing</Text></View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.downIcon}>▼</Text></TouchableOpacity>
        <Text style={s.headerLabel}>Now Playing</Text>
        <TouchableOpacity onPress={handleQueuePress}><Text style={s.queueIcon}>{showQueue ? '✕' : '☰'}</Text></TouchableOpacity>
      </View>

      {showQueue ? (
        <QueueDrawer queue={queue} currentIndex={currentIndex} onPlay={(i) => { navigation.goBack(); }} onClose={() => setShowQueue(false)} />
      ) : (
        <>
          <View style={s.artworkContainer}>
            <Artwork uri={currentTrack.thumbnail} size={280} borderRadius={borderRadius.xl} />
          </View>

          <View style={s.trackInfo}>
            <Text style={s.trackTitle} numberOfLines={2}>{currentTrack.title}</Text>
            <Text style={s.trackArtist} numberOfLines={1}>{currentTrack.artist}</Text>
          </View>

          <View style={s.progressContainer}>
            <ProgressSlider progress={progress} onSeek={seekToFraction} height={6} />
            <View style={s.timeRow}>
              <Text style={s.timeText}>{formatSeconds(position)}</Text>
              <Text style={s.timeText}>{formatSeconds(duration)}</Text>
            </View>
          </View>

          <View style={s.controls}>
            <TouchableOpacity onPress={toggleShuffle} style={s.controlSide}>
              <Text style={[s.controlIcon, { color: getShuffleColor() }]}>↻</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={skipToPrevious} style={s.controlMain}>
              <Text style={s.mainIcon}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={s.playBtn}>
              <Text style={s.playIcon}>{isBuffering ? '⏳' : isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={skipToNext} style={s.controlMain}>
              <Text style={s.mainIcon}>⏭</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLike} style={s.controlSide}>
              <Text style={[s.controlIcon, { color: isLiked ? colors.heart : colors.textMuted }]}>{isLiked ? '❤' : '♡'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleRepeat} style={s.controlSide}>
              <Text style={[s.controlIcon, { color: getRepeatColor() }]}>{getRepeatIcon()}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function QueueDrawer({ queue, currentIndex, onPlay, onClose }: { queue: Track[]; currentIndex: number; onPlay: (i: number) => void; onClose: () => void }) {
  return (
    <View style={qd.container}>
      <View style={qd.header}><Text style={qd.title}>Up Next ({queue.length})</Text></View>
      <FlatList
        data={queue}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={[qd.item, index === currentIndex && qd.itemActive]} onPress={() => onPlay(index)}>
            <Artwork uri={item.thumbnail} size={36} />
            <View style={qd.info}>
              <Text style={[qd.itemTitle, index === currentIndex && qd.itemTitleActive]} numberOfLines={1}>{item.title}</Text>
              <Text style={qd.itemArtist} numberOfLines={1}>{item.artist}</Text>
            </View>
            <Text style={qd.index}>#{index + 1}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const qd = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl },
  header: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...typography.h3, color: colors.textSecondary },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  itemActive: { backgroundColor: colors.surface, borderRadius: borderRadius.md, paddingHorizontal: spacing.sm },
  info: { flex: 1 },
  itemTitle: { ...typography.body, color: colors.text },
  itemTitleActive: { color: colors.accent, fontWeight: '600' },
  itemArtist: { ...typography.bodySmall, color: colors.textSecondary },
  index: { ...typography.monoSmall, color: colors.textMuted },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.playerBg, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noTrackText: { ...typography.h2, color: colors.textMuted },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  downIcon: { fontSize: 20, color: colors.text },
  headerLabel: { ...typography.label, color: colors.textSecondary },
  queueIcon: { fontSize: 22, color: colors.text },
  artworkContainer: { alignItems: 'center', paddingVertical: spacing.xxl },
  trackInfo: { paddingHorizontal: spacing.xxl, marginBottom: spacing.xxl },
  trackTitle: { ...typography.h1, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  trackArtist: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  progressContainer: { paddingHorizontal: spacing.xxl, marginBottom: spacing.xxl },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  timeText: { ...typography.monoSmall, color: colors.textMuted },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.lg },
  controlSide: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  controlIcon: { fontSize: 22 },
  controlMain: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  mainIcon: { fontSize: 28, color: colors.text },
  playBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 32, color: colors.bg },
});
