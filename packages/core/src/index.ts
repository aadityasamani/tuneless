// ── @tuneless/core — shared logic ──────────────────────────────────
// Pure functions and types shared across desktop and mobile.

export { scoreTitle, pickBestMatch } from './utils/scoring';
export { buildShuffleOrder, spreadAdjacentSameArtist } from './utils/shuffle';
export { formatDuration, formatSeconds, truncate, escapeHtml, wait } from './utils/formatting';
export { keyRouter } from './services/keyRouter';
export type { ApiKeyEntry } from './services/keyRouter';

export type { Track, PlaylistTrack, Playlist, SearchResult, RepeatMode, PlayerState, Settings, RecommendedTrack, SessionData } from './types';
