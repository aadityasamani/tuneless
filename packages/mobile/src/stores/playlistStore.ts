import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Playlist, PlaylistTrack } from '../types';

const STORAGE_KEY = 'tuneless_playlists';

export interface PlaylistStore {
  playlists: Playlist[];
  ytCache: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  addPlaylist: (playlist: Playlist) => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist>;
  removePlaylist: (id: string) => Promise<void>;
  updatePlaylist: (id: string, updates: Partial<Playlist>) => Promise<void>;
  getCachedYtId: (playlistTrackId: string) => string | undefined;
  setCachedYtId: (playlistTrackId: string, ytId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: PlaylistTrack) => Promise<void>;
  savePlaylists: () => Promise<void>;
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  ytCache: {},
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          playlists: parsed.playlists || [],
          ytCache: parsed.ytCache || {},
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  addPlaylist: async (playlist: Playlist) => {
    set((state) => ({
      playlists: [playlist, ...state.playlists],
    }));
    await get().savePlaylists();
  },

  createPlaylist: async (name: string) => {
    const pl: Playlist = {
      id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: name.trim(),
      duration: 0,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => ({ playlists: [pl, ...state.playlists] }));
    await get().savePlaylists();
    return pl;
  },

  addTrackToPlaylist: async (playlistId: string, track: PlaylistTrack) => {
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, tracks: [...p.tracks, track], updatedAt: Date.now() } : p
      ),
    }));
    await get().savePlaylists();
  },

  removePlaylist: async (id: string) => {
    set((state) => ({
      playlists: state.playlists.filter((p: Playlist) => p.id !== id),
    }));
    await get().savePlaylists();
  },

  updatePlaylist: async (id: string, updates: Partial<Playlist>) => {
    set((state) => ({
      playlists: state.playlists.map((p: Playlist) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    }));
    await get().savePlaylists();
  },

  getCachedYtId: (playlistTrackId: string) => {
    return get().ytCache[playlistTrackId];
  },

  setCachedYtId: async (playlistTrackId: string, ytId: string) => {
    set((state) => ({
      ytCache: { ...state.ytCache, [playlistTrackId]: ytId },
    }));
    for (const playlist of get().playlists) {
      const track = playlist.tracks.find((t: PlaylistTrack) => t.id === playlistTrackId);
      if (track) {
        track.ytId = ytId;
        break;
      }
    }
    await get().savePlaylists();
  },

  savePlaylists: async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          playlists: get().playlists,
          ytCache: get().ytCache,
        }),
      );
    } catch {
      // Silent fail
    }
  },
}));
