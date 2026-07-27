// ──────────────────────────────────────────────
// Tuneless — Track Resolver
// Resolves PlaylistTrack items to playable Track objects
// via the YouTube API, and manages shuffle queues.
// ──────────────────────────────────────────────

import type { Track, PlaylistTrack, SearchResult } from '../types';
import { resolveTrack } from './youtubeApi';
import { buildShuffleOrder as buildShuffleOrderUtil } from '../utils/shuffle';

/**
 * Convert a PlaylistTrack (or SearchResult) to a playable Track.
 * If playlistTrack.ytId is already set, uses it directly.
 * Otherwise, calls resolveTrack against the YouTube Data API.
 *
 * Returns null if the track cannot be resolved.
 */
export async function trackToSong(
  playlistTrack: PlaylistTrack,
): Promise<Track | null> {
  let videoId = playlistTrack.ytId;

  if (!videoId) {
    // Try to resolve via YouTube API
    const result: SearchResult | null = await resolveTrack(
      playlistTrack.searchQuery,
    );
    if (!result || !result.id) return null;
    videoId = result.id;
  }

  return {
    id: videoId,
    title: playlistTrack.title,
    artist: playlistTrack.artist,
    duration: playlistTrack.duration,
  };
}

/**
 * Convert an array of PlaylistTracks to an array of Tracks,
 * resolving each one. Tracks that fail resolution are skipped.
 */
export async function tracksToSongs(
  playlistTracks: PlaylistTrack[],
): Promise<Track[]> {
  const results: Track[] = [];
  for (const pt of playlistTracks) {
    try {
      const song = await trackToSong(pt);
      if (song) results.push(song);
    } catch {
      // Skip unresolvable tracks
    }
  }
  return results;
}

/**
 * Build a shuffled queue order from a track array.
 * Uses Fisher-Yates shuffle + same-artist spreading.
 */
export function buildShuffledQueue(tracks: Track[]): number[] {
  if (tracks.length <= 1) return tracks.map((_, i) => i);
  return buildShuffleOrderUtil(tracks);
}

/**
 * Get the next track index in a shuffled queue.
 * Handles repeat modes.
 */
export function getNextShuffledTrack(
  currentIndex: number,
  totalTracks: number,
  shuffleOrder: number[],
  repeat: 'off' | 'all' | 'one',
  shufflePos: number,
): { trackIndex: number; shufflePos: number } | null {
  if (totalTracks === 0) return null;

  if (repeat === 'one') {
    return { trackIndex: currentIndex, shufflePos };
  }

  const nextPos = shufflePos + 1;

  if (nextPos >= shuffleOrder.length) {
    if (repeat === 'all') {
      return { trackIndex: shuffleOrder[0], shufflePos: 0 };
    }
    return null; // Reached end (repeat off)
  }

  return { trackIndex: shuffleOrder[nextPos], shufflePos: nextPos };
}

/**
 * Get the previous track index in a shuffled queue.
 */
export function getPrevShuffledTrack(
  currentIndex: number,
  totalTracks: number,
  shuffleOrder: number[],
  repeat: 'off' | 'all' | 'one',
  shufflePos: number,
): { trackIndex: number; shufflePos: number } | null {
  if (totalTracks === 0) return null;

  if (repeat === 'one') {
    return { trackIndex: currentIndex, shufflePos };
  }

  const prevPos = shufflePos - 1;

  if (prevPos < 0) {
    if (repeat === 'all') {
      const lastPos = shuffleOrder.length - 1;
      return { trackIndex: shuffleOrder[lastPos], shufflePos: lastPos };
    }
    return null; // At beginning (repeat off)
  }

  return { trackIndex: shuffleOrder[prevPos], shufflePos: prevPos };
}
