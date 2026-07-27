// ──────────────────────────────────────────────
// Tuneless — Fisher-Yates Shuffle + Same-Artist Spreading
// ──────────────────────────────────────────────

/**
 * Fisher-Yates (Knuth) shuffle — in-place, O(n), unbiased.
 */
export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Spread adjacent same-artist tracks as far apart as possible.
 * Operates on an already-shuffled array.
 *
 * Algorithm:
 * 1. Group tracks by artist.
 * 2. Place each group's items by spreading them across the array
 *    at evenly-spaced positions.
 */
export function spreadAdjacentSameArtist<T extends { artist: string }>(
  arr: T[],
): T[] {
  if (arr.length <= 2) return arr;

  // 1. Group by artist (case-insensitive)
  const groups = new Map<string, T[]>();
  for (const item of arr) {
    const key = item.artist.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  // 2. Sort groups by size (largest first) for better spreading
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  // 3. Create empty slots
  const result: (T | null)[] = new Array(arr.length).fill(null);

  // 4. Spread each group
  for (const [, items] of sortedGroups) {
    const step = arr.length / items.length;
    let offset = Math.floor(step / 2);

    for (const item of items) {
      // Find the nearest empty slot starting from offset
      while (offset < result.length && result[offset] !== null) {
        offset++;
      }
      if (offset < result.length) {
        result[offset] = item;
      }
      offset += step;
    }
  }

  // 5. Fill remaining slots (shouldn't happen if counts match)
  return result.map((r, i) => r ?? arr[i]);
}

/**
 * Build a shuffled order from a track array.
 * Shuffles with Fisher-Yates then spreads same-artist tracks.
 */
export function buildShuffleOrder<T extends { artist: string }>(
  tracks: T[],
): number[] {
  const indexed = tracks.map((t, i) => ({ ...t, _origIndex: i }));
  const shuffled = fisherYatesShuffle(indexed);
  const spread = spreadAdjacentSameArtist(shuffled);
  return spread.map((t) => t._origIndex);
}
