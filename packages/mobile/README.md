# @tuneless/mobile — React Native App

An Android music streaming app built with React Native. Uses YouTube as its audio backend via a native Kotlin module (NewPipe Extractor) with Piped API fallback.

## Architecture

```
mobile/
├── App.tsx                     ← Root component: NavigationContainer + gesture root
├── index.js                    ← RN entry point
├── android/
│   └── app/src/main/java/com/tuneless/
│       ├── MainActivity.kt
│       ├── MainApplication.kt
│       └── youTubeextractor/
│           ├── YouTubeExtractorModule.kt    ← Native module: extractAudioUrl(videoId)
│           ├── YouTubeExtractorPackage.kt   ← Package registration
│           ├── NewPipeDownloader.kt         ← HTTP client for NewPipe
│           └─�� StreamFetcher.kt             ← NewPipe logic + Piped API fallback
├── src/
│   ├── screens/                ← 7 screens (Search, Library, PlaylistDetail, FullPlayer, Queue, Discover, Settings)
│   ├── components/             ← 7 shared components (MiniPlayer, TrackCard, ProgressSlider, etc.)
│   ├── stores/                 ← 5 Zustand stores (player, playlist, search, settings, likes)
│   ├── services/               ← API, extraction, parsing, recommendations, player setup
��   ├── navigation/             ← RootNavigator — 4 tabs + modals
│   ├── theme/                  ← Colors, typography, spacing
│   ├── hooks/                  ← Shared hooks (useProgressPoll)
│   ├── utils/                  ← Scoring, shuffle, formatting (ported from @tuneless/core)
│   └── types/                  ← TypeScript type definitions
```

## Features

- **YouTube search** via Data API v3 with smart result scoring
- **Native Android audio playback** via react-native-track-player (background service + MediaSession)
- **YouTube stream extraction** via native Kotlin module (NewPipe Extractor + Piped API fallback)
- **Spotify playlist import** via Exportify CSV (same format as desktop)
- **Smart shuffle** — Fisher-Yates with same-artist spreading
- **Liked Songs** auto-generated playlist
- **Create/edit playlists** from scratch
- **Queue management** �� play next, add to queue, clear
- **Crossfade** (0–10 seconds, default 3s)
- **Algorithmic recommendations** from your own library
- **Full-screen player** with seek, queue, and controls
- **Notification controls** — play/pause/next/prev on lockscreen and notification shade
- **Background playback** — music continues when app is backgrounded
- **Session persistence** — queue survives restart (24h window)

## Audio Pipeline

```
User taps a song
  → Resolve YouTube video ID (Data API v3)
  → Native Kotlin module: extractAudioUrl(videoId)
    → Try NewPipe Extractor first (fetches page, parses audio streams)
    → Fallback to Piped API (pipedapi.kavin.rocks)
  → Return audio stream URL to JS
  → Feed URL to react-native-track-player
  → RNTP handles playback, background, MediaSession natively
```

## Build

```bash
cd packages/mobile
npm install
npx react-native run-android
```

## Prerequisites

- [Android Studio](https://developer.android.com/studio)
- Node.js 22+
- A **YouTube Data API v3 key** (free)

## Project Status

The mobile app is fully ported from the desktop version and ready to compile. Key differences from desktop:

| Aspect | Mobile |
|--------|--------|
| **Framework** | React Native (Zustand stores) |
| **Audio** | NewPipe Extractor (Kotlin native module) |
| **Player** | react-native-track-player |
| **Persistence** | AsyncStorage |
| **UI** | RN components + Inter font |

## Screens

| Screen | Description |
|--------|-------------|
| **Search** | Search YouTube, browse results, tap to play |
| **Library** | Playlists list, liked songs, import CSV, create playlist |
| **Discover** | Recently played + algorithmic recommendations |
| **Full Player** | Now-playing with seek, controls, queue, like |
| **Queue** | Upcoming tracks, clear queue |
| **Settings** | API key config, crossfade, about |
