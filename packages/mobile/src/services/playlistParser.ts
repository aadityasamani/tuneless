// ──────────���───────────────────────────────────
// Tuneless — Playlist Parser (CSV Exportify & Spotify JSON)
// ──────────────────────────────────────────────

import type { PlaylistTrack } from '../types';

/**
 * Parse an Exportify CSV string into PlaylistTrack objects.
 * Exportify export format (header row):
 *   Position,Track,Artist,Album,URI,...
 *
 * CSV may contain quoted fields with commas.
 */
export function parseCSV(csvText: string): PlaylistTrack[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]);
  const trackCol = findCol(header, 'Track', 'Name');
  const artistCol = findCol(header, 'Artist', 'Artists');
  const positionCol = findCol(header, 'Position', '#');

  if (trackCol === -1 || artistCol === -1) return [];

  const tracks: PlaylistTrack[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCSVLine(lines[i]);
    const title = (fields[trackCol] || '').trim();
    const artist = (fields[artistCol] || '').trim();
    if (!title || !artist) continue;

    const searchQuery = `${title} ${artist}`;
    const key = searchQuery.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    tracks.push({
      id: `csv-${i}-${Date.now()}`,
      title,
      artist,
      searchQuery,
      ytId: null,
      duration: 0,
    });
  }

  return tracks;
}

/**
 * Parse a Spotify playlist JSON export (e.g. from SpotMyBackup or similar tools).
 * Expected format:
 * {
 *   "name": "...",
 *   "tracks": [
 *     { "track": { "name": "...", "artists": [{ "name": "..." }], "duration_ms": ... } }
 *   ]
 * }
 */
export function parseSpotifyJSON(jsonText: string): {
  name: string;
  tracks: PlaylistTrack[];
  sourceLabel: string;
} {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON');
  }

  // Support both array format and {tracks: [...]} format
  const items: any[] = data.tracks || data.playlist?.tracks || data.items || data;

  if (!Array.isArray(items)) {
    throw new Error('No tracks array found in JSON');
  }

  const name = data.name || data.playlist?.name || 'Imported Playlist';
  const tracks: PlaylistTrack[] = [];

  for (const entry of items) {
    const track = entry.track || entry;
    if (!track || !track.name) continue;

    const title = track.name.trim();
    const artist = track.artists
      ? track.artists.map((a: any) => a.name).join(', ')
      : track.artist || 'Unknown';
    const durationMs = track.duration_ms || track.duration || 0;

    if (!title) continue;

    tracks.push({
      id: `spot-${tracks.length}-${Date.now()}`,
      title,
      artist,
      searchQuery: `${title} ${artist}`,
      ytId: null,
      duration: Math.floor(durationMs / 1000),
    });
  }

  return { name, tracks, sourceLabel: 'Imported from Spotify' };
}

/**
 * Split a single CSV line respecting quoted fields.
 */
export function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Find the index of a column in a CSV header row.
 * Accepts multiple possible header names.
 */
export function findCol(
  header: string[],
  ...candidates: string[]
): number {
  for (const candidate of candidates) {
    const idx = header.findIndex(
      (h) => h.trim().toLowerCase() === candidate.toLowerCase(),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}
