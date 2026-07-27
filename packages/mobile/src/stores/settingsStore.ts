import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'tuneless_settings';

export interface SettingsStore {
  youtubeApiKey: string;
  crossfadeSec: number;
  spotifyId: string;
  spotifySecret: string;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  setCrossfade: (sec: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  youtubeApiKey: '',
  crossfadeSec: 3,
  spotifyId: '',
  spotifySecret: '',
  loaded: false,

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          youtubeApiKey: parsed.youtubeApiKey || '',
          crossfadeSec: parsed.crossfadeSec ?? 3,
          spotifyId: parsed.spotifyId || '',
          spotifySecret: parsed.spotifySecret || '',
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch { set({ loaded: true }); }
  },

  saveApiKey: async (key: string) => {
    set({ youtubeApiKey: key });
    try {
      const state = get();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
        youtubeApiKey: state.youtubeApiKey,
        crossfadeSec: state.crossfadeSec,
        spotifyId: state.spotifyId,
        spotifySecret: state.spotifySecret,
      }));
    } catch {}
  },

  clearApiKey: async () => {
    set({ youtubeApiKey: '' });
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
  },

  setCrossfade: async (sec: number) => {
    set({ crossfadeSec: sec });
    try {
      const state = get();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
        youtubeApiKey: state.youtubeApiKey,
        crossfadeSec: sec,
        spotifyId: state.spotifyId,
        spotifySecret: state.spotifySecret,
      }));
    } catch {}
  },
}));
