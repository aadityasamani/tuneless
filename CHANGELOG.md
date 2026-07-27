# Changelog

All notable changes to Tuneless will be documented here.

## [2.0.3] — 2026-07-27

### Fixed
- **Seamless format fallback**: When a song stalls mid-playback, the app now
  switches to an alternate audio format at the exact seek position instead of
  skipping to the next track. No audible gap, no interruption.
- **3s stall detection**: Reduced from 8s to 3s — buffering issues are caught
  and resolved before you notice them.
- **Decode error recovery**: If the primary audio format (M4A) fails to decode,
  the app falls back to an alternate format before skipping.
- **Accept-Ranges header**: Forwarded from YouTube so `<audio>` properly
  supports seeking — fixes songs getting stuck at a playback position.

### Added
- **Stream URL caching**: yt-dlp is now called at most once per 10 minutes per
  song per format. Subsequent plays are instant.
- **Dual-format extraction**: Primary (M4A/AAC) and fallback URLs are both
  fetched upfront, allowing rapid format switching on failure.

## [2.0.2] — 2026-07-26

### Changed
- Disabled autoplay by default to prevent unwanted background data usage.
- Improved recommendation engine with better artist similarity scoring.

### Fixed
- Audio stall handling — retries with a fresh stream URL when buffering hangs.

## [2.0.1] — 2026-07-26

### Added
- Discover tab with algorithmic recommendations from your own library.
- Autoplay toggle — automatically fills queue when it ends.
- Recently played tracking across sessions.

### Changed
- Full-screen player with queue drawer UI.

## [2.0.0] — 2026-07-26

### Added
- Crossfade support (0–10s, configurable in Settings).
- Playlist filtering within playlist detail view.
- Keyboard shortcuts (Space, ←, →, ���K, F).

### Changed
- Redesigned UI with Inter font, consistent spacing, and dark theme.
- Session persistence — queue survives app restarts (24h window).

## [1.0.0] — 2026-07-23

### Added
- Initial release as a monorepo (core, desktop, mobile packages).
- YouTube search via Data API v3 with smart result scoring.
- Audio playback via yt-dlp through a local HTTP proxy.
- Spotify playlist import (Exportify CSV).
- Smart shuffle (Fisher-Yates + same-artist spreading).
- Like/unlike songs with auto-generated Liked Songs playlist.
- Library management (create playlists, import CSV).
- Play next / Add to queue.
- Multi-key router for YouTube API keys.
- Mobile package with React Native port (Android).
