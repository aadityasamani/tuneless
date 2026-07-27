// ──────────────────────────────────────────────
// Tuneless — YouTube Title Scoring
// Scores raw YouTube titles to find the best match
// for a given search query.
// ──────────────────────────────────────────────

/**
 * Score a YouTube video title against the original search intent.
 * Higher = better match for playback.
 *
 * Bonus signals (additive):
 *   +10  "full audio" / "full song" — exactly what we want
 *   +9   "official audio" — official upload
 *   +8   "official video" / "official music video" — also official
 *   +7   "audio" in title
 *   +5   "lyrics" in title (user often wants this)
 *   +3   "with lyrics" / "lyric video"
 *   +2   exact title match (case-insensitive)
 *   +1   artist name appears in title
 *
 * Penalties (subtractive):
 *   -5   "cover" — not original
 *   -4   "remix", "remix" — derivative
 *   -3   "live" — live performance (usually worse audio)
 *   -3   "instrumental" — no vocals
 *   -3   "acoustic" — stripped version
 *   -3   "karaoke" — no vocals
 *   -2   "edited" / "short" / "version" — truncated or altered
 *   -2   "loop" / "1 hour" / "extended" — not standard length
 *   -2   "tiktok" / "speed up" / "sped up" — trend edits
 *   -2   title is very short (< 10 chars) — likely auto-generated
 *   -1   contains non-Latin characters heavily
 *   -1   numeric-only suffix mismatch (e.g. "part 2" when not expected)
 */
export function scoreTitle(title: string, query: string): number {
  const lower = title.toLowerCase();
  const qLower = query.toLowerCase();

  let score = 0;

  // ── Positive signals ────────────────────────
  // Exact full audio / full song
  if (/\bfull\s*(audio|song)\b/.test(lower)) score += 10;
  // Official audio
  else if (/\bofficial\s*audio\b/.test(lower)) score += 9;
  // Official video
  else if (/\bofficial\s*(video|music\s*video)\b/.test(lower)) score += 8;
  // "audio" alone
  else if (/\baudio\b/.test(lower)) score += 7;

  // Lyrics signals
  if (/\blyrics?\b/.test(lower)) score += 5;
  else if (/\b(with\s+)?lyric\s*video\b/.test(lower)) score += 3;

  // Title match
  if (lower === qLower) score += 2;
  else if (lower.includes(qLower)) score += 1;

  // ── Penalties ───────────────────────────────
  if (/\bcover\b/.test(lower)) score -= 5;
  if (/\bremix\b/.test(lower)) score -= 4;
  if (/\blive\b/.test(lower)) score -= 3;
  if (/\binstrumental\b/.test(lower)) score -= 3;
  if (/\bacoustic\b/.test(lower)) score -= 3;
  if (/\bkaraoke\b/.test(lower)) score -= 3;
  if (/\b(edited|short|short\s*version)\b/.test(lower)) score -= 2;
  if (/\b(loop|1\s*hour|extended)\b/.test(lower)) score -= 2;
  if (/\b(tiktok|speed\s*up|sped\s*up)\b/.test(lower)) score -= 2;

  // Very short titles
  if (title.length < 10) score -= 2;

  return score;
}

/**
 * Pick the best matching video from an array of candidates.
 * Returns the item with the highest score, or the first item if none.
 */
export function pickBestMatch<T extends { title: string }>(
  candidates: T[],
  query: string,
): T | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestScore = scoreTitle(best.title, query);

  for (let i = 1; i < candidates.length; i++) {
    const s = scoreTitle(candidates[i].title, query);
    if (s > bestScore) {
      bestScore = s;
      best = candidates[i];
    }
  }

  return best;
}
