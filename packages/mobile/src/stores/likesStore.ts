// ──────────────────────────────────────────────
// Tuneless — Likes Store (Zustand)
// Persisted liked song IDs
// ──────────────────────────────────────────────

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LIKED_KEY = 'tl_liked';

export interface LikesStore {
  likedIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
  isLiked: (id: string) => boolean;
}

export const useLikesStore = create<LikesStore>((set, get) => ({
  likedIds: [],
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(LIKED_KEY);
      if (raw) {
        set({ likedIds: JSON.parse(raw), loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch { set({ loaded: true }); }
  },

  toggle: async (id: string) => {
    const current = get().likedIds;
    const next = current.includes(id) ? current.filter(i => i !== id) : [...current, id];
    set({ likedIds: next });
    try { await AsyncStorage.setItem(LIKED_KEY, JSON.stringify(next)); } catch {}
  },

  isLiked: (id: string) => get().likedIds.includes(id),
}));
