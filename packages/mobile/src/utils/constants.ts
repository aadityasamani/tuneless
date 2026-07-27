import { NativeModules } from 'react-native';
import type { YouTubeExtractorNative } from '../types';

const { YouTubeExtractor } = NativeModules;

export const NativeExtractor: YouTubeExtractorNative = {
  extractAudioUrl: async (videoId: string): Promise<string> => {
    if (YouTubeExtractor?.extractAudioUrl) return YouTubeExtractor.extractAudioUrl(videoId);
    throw new Error('YouTubeExtractor native module not available');
  },
  isAvailable: async (): Promise<boolean> => {
    if (YouTubeExtractor?.isAvailable) return YouTubeExtractor.isAvailable();
    return false;
  },
};

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const API_RETRY_DELAY = 1000;
export const API_MAX_RETRIES = 3;

// Simple multi-key router (AsyncStorage-backed for RN)
export const keyRouter = {
  getAll: (): { id: string; key: string; label: string }[] => {
    try { return JSON.parse(localStorage.getItem('tl_api_keys') || '[]'); } catch { return []; }
  },
  add: (key: string, label: string) => {
    const keys = keyRouter.getAll();
    if (keys.find(k => k.key === key)) throw new Error('Key already added');
    keys.push({ id: 'key_' + Date.now(), key, label, isActive: true, quotaUsed: 0, lastError: null, addedAt: Date.now() });
    try { localStorage.setItem('tl_api_keys', JSON.stringify(keys)); } catch {}
  },
};
