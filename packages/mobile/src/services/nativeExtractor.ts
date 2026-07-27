// ──────────────────────────────────────────────
// Tuneless — Native YouTube Audio Extractor
// Wraps the Kotlin YouTubeExtractor module.
// ──────────────────────────────────────────────

import { NativeModules, Platform } from 'react-native';
import type { YouTubeExtractorNative } from '../types';

const { YouTubeExtractor } = NativeModules;

/**
 * Check if the native YouTubeExtractor module is available.
 * Returns false on iOS or if the module isn't linked.
 */
export function isModuleAvailable(): boolean {
  return Platform.OS === 'android' && YouTubeExtractor != null;
}

/**
 * Extract the direct audio URL for a YouTube video.
 * Uses the native Kotlin NewPipe-based extractor.
 *
 * @param videoId - The YouTube video id (11 characters).
 * @returns The direct audio stream URL.
 */
export async function extractAudioUrl(videoId: string): Promise<string> {
  if (!isModuleAvailable()) {
    throw new Error('YouTubeExtractor native module is not available on this platform');
  }

  try {
    const url: string = await YouTubeExtractor.extractAudioUrl(videoId);
    if (!url || url.length === 0) {
      throw new Error('Empty audio URL returned from extractor');
    }
    return url;
  } catch (error: any) {
    throw new Error(
      `Failed to extract audio URL: ${error.message || 'Unknown error'}`,
    );
  }
}

/**
 * Check whether the native module is ready.
 */
export async function isAvailable(): Promise<boolean> {
  if (!isModuleAvailable()) return false;

  try {
    return await YouTubeExtractor.isAvailable();
  } catch {
    return false;
  }
}
