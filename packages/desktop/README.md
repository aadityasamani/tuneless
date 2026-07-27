# @tuneless/desktop — Electron App

A full-featured Windows desktop music streaming app built with Electron. Uses YouTube as its audio backend via yt-dlp.

## Architecture

```
desktop/
├── main.js          ← Electron main process: IPC, yt-dlp stream proxy, window management
���── preload.js       ← Bridge: exposes safe IPC API to renderer
├── renderer/
│   ├��─ index.html   ← Black & white UI shell
│   ��── app.js       ← Full app logic (search, queue, player, library, settings)
│   └── keyRouter.js ← Browser-side multi-key YouTube API router
├── assets/          ← Logo files (SVG + PNG)
├── scripts/         ← Utility scripts (icon generation)
├── dist/            ← Built installer(s)
└── yt-dlp.exe       ← Audio extraction binary (downloaded at install time)
```

## Features

- **YouTube search** via Data API v3 with smart result scoring
- **Native audio playback** via yt-dlp stream extraction → local proxy → `<audio>` element
- **Spotify playlist import** via Exportify CSV
- **Smart shuffle** — Fisher-Yates with same-artist spreading
- **Liked Songs** auto-generated playlist
- **Create/edit playlists** from scratch
- **Queue management** — play next, add to queue, clear
- **Crossfade** (0–10 seconds, default 3s)
- **Algorithmic recommendations** from your own library
- **Full-screen player** with queue drawer
- **Session persistence** — queue survives restarts
- **Multi-key YouTube API router** — auto failover when quota runs out
- **Keyboard shortcuts** — Space, ←, →, ⌘K, F, etc.

## Audio Pipeline

```
User taps play
  → main.js spawns yt-dlp to extract stream URL
  → Local HTTP proxy serves the stream (avoids CORS)
  → HTML <audio> element plays it
  → Zero CORS issues, native-quality playback
```

## Build

```bash
cd packages/desktop
npm install
npm run dist
# → packages/desktop/dist/Tuneless-Setup-1.0.0.exe
```

## Usage

1. Download and run `Tuneless-Setup-1.0.0.exe`
2. Open app → **Settings** → paste your YouTube Data API v3 key
3. Search and play any song

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process — window, IPC handlers, yt-dlp bridge, stream proxy |
| `preload.js` | Context bridge — exposes `api.search()`, `api.resolve()`, `api.play()` etc. |
| `renderer/app.js` | All UI logic — vanilla JS, no framework |
| `renderer/index.html` | UI shell with black & white theme |
| `renderer/keyRouter.js` | Multi-key YouTube API router (quota tracking, failover) |
