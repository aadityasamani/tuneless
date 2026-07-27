// ── Tuneless — Adaptive API Key Router ────────────────────────────
// Smart multi-key management: stores multiple YouTube API keys,
// tracks usage, fails over automatically when quota runs out.

const STORAGE_KEY = 'tl_api_keys';

export interface ApiKeyEntry {
  id: string;
  key: string;
  label: string;
  isActive: boolean;
  quotaUsed: number;
  lastError: number | null;
  addedAt: number;
}

function loadKeys(): ApiKeyEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveKeys(keys: ApiKeyEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export const keyRouter = {
  /** Get all stored keys */
  getAll(): ApiKeyEntry[] { return loadKeys(); },

  /** Add a new API key */
  add(key: string, label: string): ApiKeyEntry {
    const keys = loadKeys();
    if (keys.find(k => k.key === key)) throw new Error('Key already added');
    const entry: ApiKeyEntry = {
      id: 'key_' + Date.now(),
      key, label: label || 'Key ' + (keys.length + 1),
      isActive: true, quotaUsed: 0, lastError: null, addedAt: Date.now(),
    };
    saveKeys([...keys, entry]);
    return entry;
  },

  /** Remove a key */
  remove(id: string) {
    saveKeys(loadKeys().filter(k => k.id !== id));
  },

  /** Toggle key active/inactive */
  toggle(id: string) {
    const keys = loadKeys().map(k => k.id === id ? { ...k, isActive: !k.isActive } : k);
    saveKeys(keys);
  },

  /** Pick the best available key for an API call */
  getBest(): string | null {
    const keys = loadKeys().filter(k => k.isActive);
    if (!keys.length) return null;

    // Sort: least quota used first, then no recent errors
    const sorted = keys.sort((a, b) => {
      if ((a.lastError || 0) > Date.now() - 3600000) return 1; // errored in last hour
      if ((b.lastError || 0) > Date.now() - 3600000) return -1;
      return a.quotaUsed - b.quotaUsed;
    });

    return sorted[0]?.key || null;
  },

  /** Mark a key as having an error (quota exceeded, etc.) */
  markError(key: string) {
    const keys = loadKeys().map(k => {
      if (k.key === key) return { ...k, lastError: Date.now() };
      return k;
    });
    saveKeys(keys);
  },

  /** Mark a key as having used some quota */
  markUsed(key: string) {
    const keys = loadKeys().map(k => {
      if (k.key === key) return { ...k, quotaUsed: k.quotaUsed + 1 };
      return k;
    });
    saveKeys(keys);
  },

  /** Reset daily counters (call on app boot) */
  resetDaily() {
    const keys = loadKeys().map(k => ({ ...k, quotaUsed: 0, lastError: null }));
    saveKeys(keys);
  },
};
