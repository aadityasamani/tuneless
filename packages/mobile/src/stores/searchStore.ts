// ──────────────────────────────────────────────
// Tuneless — Search Store (Zustand)
// Manages YouTube search state.
// ──────────────────────────────────────────────

import { create } from 'zustand';
import type { SearchResult } from '../types';
import { searchYouTube } from '../services/youtubeApi';

export interface SearchStore {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;

  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  /** Execute a YouTube search */
  executeSearch: (query: string) => Promise<void>;
  /** Clear search state */
  clearSearch: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  query: '',
  results: [],
  loading: false,
  error: null,

  setQuery: (query: string) => set({ query }),
  setResults: (results: SearchResult[]) => set({ results }),
  setLoading: (loading: boolean) => set({ loading }),
  setError: (error: string | null) => set({ error }),

  executeSearch: async (query: string) => {
    if (!query.trim()) {
      set({ query, results: [], loading: false, error: null });
      return;
    }

    set({ query, loading: true, error: null });

    try {
      const results = await searchYouTube(query);
      set({ results, loading: false });
    } catch (err: any) {
      set({
        results: [],
        loading: false,
        error: err.message || 'Search failed',
      });
    }
  },

  clearSearch: () => {
    set({ query: '', results: [], loading: false, error: null });
  },
}));
