# Changelog

All notable changes to Tuneless will be documented here.

## [2.2.0] — 2026-09-08

### Added
- **Global Hotkey Quick Launcher Overlay (Spotlight / Raycast HUD)**: Press `Alt+Space` (configurable) anytime to summon a sleek, frameless floating overlay. Hit `Enter` to instantly shuffle Liked Songs, or use `1`–`9` / arrow keys to shuffle any playlist without opening the full app. Includes live mini-controls and auto-dismisses on blur or `Escape`.
- **System Tray & Windows Auto-Startup**: Closing the window hides Tuneless to the system tray so background playback and global hotkeys remain active. Added a "Launch on system startup" toggle in Settings to start Tuneless minimized in the tray on boot.
- **Permanent Offline Music Playback**: Download playlists directly to local storage (`%APPDATA%/tuneless/offline-music/`) with visual `✓ Offline` badges and instant, 0s latency playback with zero internet required.
- **Synced Lyrics View**: Real-time synchronized scrolling lyrics in the full player powered by LRCLIB, with interactive click-to-seek support.
- **Audio Equalizer & Bass Boost**: 5-band parametric equalizer (60Hz, 250Hz, 1kHz, 4kHz, 12kHz) with custom sliders, presets, and a dedicated 🔥 Bass Boost (+8dB low-shelf) toggle.
- **Playlist Management**: Added drag-and-drop track reordering in playlists and a quick-remove `×` hover button for tracks.


### Fixed
- **New Playlist button does nothing**: Electron does not support the native browser
  `prompt()` function — it silently returns `null`, so the playlist creation code
  exits without doing anything. Replaced all `prompt()` calls with a custom HTML
  modal that works inside Electron. Also fixed "Add to Playlist" which had the same
  issue and now shows a proper dropdown instead of a text prompt.

## [2.0.6] — 2026-08-06

### Fixed
- **3:36 truncation — songs now play to the end**: Node.js `https.get` was throttled
  to 32KB/s by YouTube's CDN while audio plays at 44KB/s. Buffer drained faster
  than it filled, cutting off around 3:36. Fix: yt-dlp downloads the full audio
  file to a temp directory at 740KB/s, proxy serves the complete file.

## [2.0.5] — 2026-07-27

### Added
- **YouTube cookies support**: When YouTube blocks playback ("Sign in to confirm you're not a bot"),
  you can now import a `cookies.txt` from Settings → YouTube Cookies. The app auto-uses it for all
  extraction. This is the reliable fix for YouTube's anti-bot blocking.
- **Fast, clear playback errors**: `play:stream` now pre-warms the stream cache and surfaces YouTube
  bot-check / extraction failures as a clear toast + jump to Settings, instead of a silent
  "Format error" from the audio element.

### Fixed
- **Proxy accepted cache-buster query strings**: `?format=fallback&v=...` now matches; previously any
  extra query param made the proxy return 404, breaking the fallback path.
- **Initial-load stall timer**: yt-dlp extraction (5–15s) no longer triggers the 3s stall logic.
  Stall detection is now 15s during initial load, 3s for mid-playback stalls.
- **Close actually quits the app**: removed the close-to-tray behavior that left a hidden process
  playing audio and holding the stream port.
- **Volume/mute desync**: crossfade no longer restores stale volume; clicking the speaker toggles mute.

## [2.0.4] — 2026-07-27

### Fixed
- **yt-dlp option compatibility**: Removed `--reconnect` and `--reconnect-streamed`
  flags which were removed in yt-dlp 2026.07.04. Every yt-dlp call was failing with
  `no such option: --reconnect`, preventing all playback. Songs now play again.

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
