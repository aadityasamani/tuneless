// ──────────────────────────────────────────────
// Tuneless — Player Store (Zustand)
// Queue, playback, shuffle, crossfade, session memory
// ─���────────────────────────────────────────────

import { create } from 'zustand';
import TrackPlayer, { State, Event } from 'react-native-track-player';
import type { Track, RepeatMode } from '../types';
import { buildShuffleOrder } from '../utils/shuffle';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'tl_player_session';

export interface PlayerStore {
  // Queue
  queue: Track[];
  currentIndex: number;

  // Play state
  isPlaying: boolean;
  isBuffering: boolean;

  // Shuffle
  shuffle: boolean;
  shuffleOrder: number[];
  shufflePos: number;

  // Repeat
  repeat: RepeatMode;

  // Active playlist context
  activePlaylistId: string | null;
  activePlaylistTracks: Track[];

  // Progress
  progress: number;
  duration: number;
  position: number;

  // Crossfade
  crossfadeSec: number;

  // Session
  sessionLoaded: boolean;

  // Actions
  setQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  addToQueue: (track: Track) => Promise<void>;
  addToQueueNext: (track: Track) => Promise<void>;
  removeFromQueue: (index: number) => Promise<void>;
  clearQueue: () => Promise<void>;

  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  seekToFraction: (fraction: number) => Promise<void>;

  toggleShuffle: () => Promise<void>;
  toggleRepeat: () => void;
  setCrossfade: (sec: number) => Promise<void>;

  setActivePlaylist: (id: string | null, tracks?: Track[]) => void;

  updateProgress: () => Promise<void>;
  syncFromTrackPlayer: () => Promise<void>;
  onTrackEnded: () => Promise<void>;

  // Session persistence
  saveSession: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  isBuffering: false,
  shuffle: false,
  shuffleOrder: [],
  shufflePos: 0,
  repeat: 'off',
  activePlaylistId: null,
  activePlaylistTracks: [],
  progress: 0,
  duration: 0,
  position: 0,
  crossfadeSec: 3,
  sessionLoaded: false,

  // ── Session ──

  saveSession: async () => {
    const { queue, currentIndex } = get();
    const session = {
      queue: queue.slice(0, 50).map(t => ({ id: t.id, title: t.title, artist: t.artist, thumbnail: t.thumbnail })),
      currentIndex,
      timestamp: Date.now(),
    };
    try { await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  },

  restoreSession: async () => {
    try {
      const raw = await AsyncStorage.getItem(SESSION_KEY);
      if (!raw) { set({ sessionLoaded: true }); return; }
      const s = JSON.parse(raw);
      if (s.queue?.length > 0 && (Date.now() - s.timestamp) < 86400000) {
        const idx = s.currentIndex >= 0 && s.currentIndex < s.queue.length ? s.currentIndex : 0;
        set({ queue: s.queue, currentIndex: idx, sessionLoaded: true });
      } else {
        set({ sessionLoaded: true });
      }
    } catch { set({ sessionLoaded: true }); }
  },

  // ── Queue ──

  setQueue: async (tracks: Track[], startIndex = 0) => {
    const rnTracks = tracks.map(t => ({ id: t.id, url: t.audioUrl || '', title: t.title, artist: t.artist, duration: t.duration, artwork: t.thumbnail }));
    await TrackPlayer.reset();
    if (rnTracks.length > 0) {
      await TrackPlayer.add(rnTracks);
      if (startIndex > 0) await TrackPlayer.skip(startIndex);
      await TrackPlayer.play();
    }
    set({ queue: tracks, currentIndex: startIndex });
    get().saveSession();
  },

  addToQueue: async (track: Track) => {
    const rnTrack = { id: track.id, url: '', title: track.title, artist: track.artist, duration: track.duration, artwork: track.thumbnail };
    await TrackPlayer.add(rnTrack);
    set(state => ({ queue: [...state.queue, track] }));
    get().saveSession();
  },

  addToQueueNext: async (track: Track) => {
    const { queue, currentIndex } = get();
    const newQueue = [...queue];
    const insertAt = currentIndex >= 0 && currentIndex < queue.length ? currentIndex + 1 : queue.length;
    newQueue.splice(insertAt, 0, track);
    set({ queue: newQueue });
    get().saveSession();
  },

  removeFromQueue: async (index: number) => {
    set(state => ({ queue: state.queue.filter((_, i) => i !== index) }));
  },

  clearQueue: async () => {
    await TrackPlayer.reset();
    set({ queue: [], currentIndex: -1 });
    get().saveSession();
  },

  // ── Playback ──

  play: async () => { try { await TrackPlayer.play(); set({ isPlaying: true }); } catch {} },
  pause: async () => { try { await TrackPlayer.pause(); set({ isPlaying: false }); } catch {} },

  togglePlayPause: async () => {
    const state = await TrackPlayer.getPlaybackState();
    if (state.state === 'playing' || state.state === '3') { await TrackPlayer.pause(); set({ isPlaying: false }); }
    else { await TrackPlayer.play(); set({ isPlaying: true }); }
  },

  skipToNext: async () => {
    const { queue, currentIndex, repeat } = get();
    if (currentIndex >= queue.length - 1) {
      if (repeat === 'all') { try { await TrackPlayer.skip(0); set({ currentIndex: 0 }); } catch {} }
      return;
    }
    try { await TrackPlayer.skipToNext(); set({ currentIndex: currentIndex + 1 }); } catch {}
    get().saveSession();
  },

  skipToPrevious: async () => {
    const { currentIndex, repeat, position } = get();
    if (position > 3) { try { await TrackPlayer.seekTo(0); } catch {} return; }
    if (currentIndex <= 0) {
      if (repeat === 'all') {
        const lastIdx = get().queue.length - 1;
        if (lastIdx >= 0) { try { await TrackPlayer.skip(lastIdx); set({ currentIndex: lastIdx }); } catch {} }
      }
      return;
    }
    try { await TrackPlayer.skipToPrevious(); set({ currentIndex: currentIndex - 1 }); } catch {}
    get().saveSession();
  },

  seekTo: async (position: number) => { try { await TrackPlayer.seekTo(position); } catch {} },
  seekToFraction: async (fraction: number) => {
    const duration = (await TrackPlayer.getProgress()).duration;
    if (duration > 0) try { await TrackPlayer.seekTo(fraction * duration); } catch {}
  },

  toggleShuffle: async () => {
    const next = !get().shuffle;
    try { await TrackPlayer.setShuffleMode(next); } catch {}
    set({ shuffle: next });
  },

  toggleRepeat: () => {
    const { repeat } = get();
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(repeat) + 1) % modes.length];
    set({ repeat: next });
  },

  setCrossfade: async (sec: number) => {
    set({ crossfadeSec: sec });
    try { await AsyncStorage.setItem('tl_crossfade', sec.toString()); } catch {}
  },

  setActivePlaylist: (id: string | null, tracks?: Track[]) => {
    set({ activePlaylistId: id, activePlaylistTracks: tracks || [] });
  },

  // ── Progress ──

  updateProgress: async () => {
    try {
      const progress = await TrackPlayer.getProgress();
      set({
        progress: progress.duration > 0 ? progress.position / progress.duration : 0,
        duration: progress.duration,
        position: progress.position,
      });
    } catch {}
  },

  syncFromTrackPlayer: async () => {
    try {
      const state = await TrackPlayer.getPlaybackState();
      const idx = await TrackPlayer.getActiveTrackIndex().catch(() => undefined);
      const progress = await TrackPlayer.getProgress();
      set({
        isPlaying: state.state === 'playing' || state.state === '3',
        isBuffering: state.state === 'buffering' || state.state === '2',
        currentIndex: idx ?? get().currentIndex,
        progress: progress.duration > 0 ? progress.position / progress.duration : 0,
        duration: progress.duration,
        position: progress.position,
      });
    } catch {}
  },

  onTrackEnded: async () => {
    const { queue, currentIndex, repeat } = get();
    const next = currentIndex + 1;
    if (next < queue.length) {
      await get().skipToNext();
    } else if (repeat === 'all' && queue.length > 0) {
      try { await TrackPlayer.skip(0); set({ currentIndex: 0, isPlaying: true }); } catch {}
    }
    get().saveSession();
  },
}));
