export function formatDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h = +m[1] || 0, mn = +m[2] || 0, s = +m[3] || 0;
  return h ? `${h}:${String(mn).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${mn}:${String(s).padStart(2, '0')}`;
}

export function formatSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = Math.floor(totalSeconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function truncate(str: string, maxLen: number): string {
  return str?.length > maxLen ? str.slice(0, maxLen - 1) + '...' : str || '';
}

export function escapeHtml(str: string): string {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
