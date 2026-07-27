// ──────────────────────────────────────────────
// Tuneless — Formatting Utilities
// ──────────────────────────────────────────────

/**
 * Format an ISO 8601 duration string (e.g. PT3M45S) into
 * a human-readable mm:ss or h:mm:ss string.
 */
export function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format a duration in seconds into mm:ss or h:mm:ss.
 */
export function formatSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0:00';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format milliseconds to mm:ss or h:mm:ss.
 */
export function formatMs(ms: number): string {
  return formatSeconds(Math.floor(ms / 1000));
}

/**
 * Truncate a string to maxLen, appending "..." if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Escape HTML entities in a string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Wait / sleep for a given number of milliseconds.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
