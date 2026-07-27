export function scoreTitle(title: string, query: string): number {
  const lower = title.toLowerCase();
  const qLower = query.toLowerCase();
  let score = 0;
  if (/\bfull\s*(audio|song)\b/.test(lower)) score += 10;
  else if (/\bofficial\s*audio\b/.test(lower)) score += 9;
  else if (/\bofficial\s*(video|music\s*video)\b/.test(lower)) score += 8;
  else if (/\baudio\b/.test(lower)) score += 7;
  if (/\blyrics?\b/.test(lower)) score += 5;
  else if (/\b(with\s+)?lyric\s*video\b/.test(lower)) score += 3;
  if (lower === qLower) score += 2;
  else if (lower.includes(qLower)) score += 1;
  if (/\bcover\b/.test(lower)) score -= 5;
  if (/\bremix\b/.test(lower)) score -= 4;
  if (/\blive\b/.test(lower)) score -= 3;
  if (/\binstrumental\b/.test(lower)) score -= 3;
  if (/\bacoustic\b/.test(lower)) score -= 3;
  if (/\bkaraoke\b/.test(lower)) score -= 3;
  if (/\b(edited|short|short\s*version)\b/.test(lower)) score -= 2;
  if (/\b(loop|1\s*hour|extended)\b/.test(lower)) score -= 2;
  if (/\b(tiktok|speed\s*up|sped\s*up)\b/.test(lower)) score -= 2;
  if (title.length < 10) score -= 2;
  return score;
}

export function pickBestMatch<T extends { title: string }>(candidates: T[], query: string): T | undefined {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  let best = candidates[0], bestScore = scoreTitle(best.title, query);
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreTitle(candidates[i].title, query);
    if (s > bestScore) { bestScore = s; best = candidates[i]; }
  }
  return best;
}
