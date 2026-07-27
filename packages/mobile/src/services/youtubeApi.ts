// ──────────────────────────────────────────────
// Tuneless — YouTube Data API v3 Service
// ──────────────────────────────────────────────

import { YOUTUBE_API_BASE, API_RETRY_DELAY, API_MAX_RETRIES } from '../utils/constants';
import type { SearchResult } from '../types';
import { wait } from '../utils/formatting';

let _apiKey: string = '';

/** Set the YouTube Data API v3 key. */
export function setApiKey(key: string): void {
  _apiKey = key;
}

/** Get the current API key. */
export function getApiKey(): string {
  return _apiKey;
}

/** Whether a key has been configured. */
export function hasApiKey(): boolean {
  return _apiKey.length > 0;
}

/**
 * Parse an ISO 8601 duration (PT3M45S) to total seconds.
 */
function isoDurationToSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const s = parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + s;
}

/**
 * Search YouTube for tracks matching `query`.
 * Returns up to `maxResults` items (default 10).
 */
export async function searchYouTube(
  query: string,
  maxResults: number = 10,
): Promise<SearchResult[]> {
  if (!_apiKey) {
    throw new Error('YouTube API key not configured');
  }

  const url = `${YOUTUBE_API_BASE}/search?part=snippet&maxResults=${maxResults}&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&key=${_apiKey}`;

  const data = await fetchWithRetry(url);

  if (!data.items || data.items.length === 0) {
    return [];
  }

  // Extract video ids to fetch durations
  const videoIds = data.items.map((item: any) => item.id.videoId).join(',');

  // Fetch durations from the videos endpoint
  let durationMap: Record<string, number> = {};
  try {
    const detailsUrl = `${YOUTUBE_API_BASE}/videos?part=contentDetails&id=${videoIds}&key=${_apiKey}`;
    const detailsData = await fetchWithRetry(detailsUrl);
    if (detailsData.items) {
      for (const item of detailsData.items) {
        durationMap[item.id] = isoDurationToSeconds(
          item.contentDetails.duration,
        );
      }
    }
  } catch {
    // Non-critical; durations will be 0
  }

  return data.items.map((item: any) => {
    const videoId = item.id.videoId;
    const snippet = item.snippet;
    return {
      id: videoId,
      title: snippet.title || '',
      artist: snippet.channelTitle || 'Unknown',
      duration: durationMap[videoId] || 0,
      thumbnail: snippet.thumbnails?.default?.url || undefined,
      channel: snippet.channelTitle || undefined,
    };
  });
}

/**
 * Resolve a single search query to the best-matching video id.
 * Returns null on failure.
 */
export async function resolveTrack(query: string): Promise<SearchResult | null> {
  try {
    const results = await searchYouTube(query, 3);
    if (results.length === 0) return null;

    // Score and pick best match
    const { scoreTitle } = require('../utils/scoring');
    let best = results[0];
    let bestScore = scoreTitle(best.title, query);

    for (let i = 1; i < results.length; i++) {
      const s = scoreTitle(results[i].title, query);
      if (s > bestScore) {
        bestScore = s;
        best = results[i];
      }
    }

    return best;
  } catch {
    return null;
  }
}

/**
 * Fetch a URL with retry logic.
 */
async function fetchWithRetry(url: string, retries: number = API_MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        // Rate limited — wait and retry
        if (data.error.code === 403 && attempt < retries) {
          await wait(API_RETRY_DELAY * (attempt + 1));
          continue;
        }
        throw new Error(data.error.message || 'YouTube API error');
      }

      return data;
    } catch (err: any) {
      if (attempt < retries) {
        await wait(API_RETRY_DELAY * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}
