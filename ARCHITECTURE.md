# Tuneless — Architecture & Auth Plan

## Current Architecture

One repo, three packages, shared core.

```
tuneless/
  package.json              Workspaces: core, desktop, mobile
  .gitignore
  ARCHITECTURE.md

packages/core/              Shared logic (no UI deps)
  package.json              @tuneless/core
  src/
    index.ts                Re-exports everything
    types.ts                All shared types
    utils/
      scoring.ts            YouTube title scoring
      shuffle.ts            Fisher-Yates + same-artist
      formatting.ts         Duration, escape, wait
    services/
      keyRouter.ts          Multi-key adaptive routing

packages/desktop/           Electron app  READY
  package.json              @tuneless/desktop
  main.js                   IPC, stream proxy, yt-dlp
  preload.js                Bridge
  scripts/render-icon.js
  assets/icon.svg+png       Logo files
  yt-dlp.exe                Audio extraction
  renderer/
    index.html              Black & white UI
    app.js                  Full app logic
    keyRouter.js            Browser key router
  dist/
    Tuneless-Setup-1.0.0.exe  INSTALLER BUILT

packages/mobile/            React Native  PORTS DONE
  package.json              @tuneless/mobile
  App.tsx, index.js         Entry points
  android/                  Android project
  babel/metro/tsconfig      Configs
  src/
    stores/                 5 stores, fully featured
      playerStore.ts        queue, crossfade, session
      playlistStore.ts      CRUD, createPlaylist
      settingsStore.ts      API key, crossfade
      likesStore.ts         Like/unlike songs
      searchStore.ts
    services/
      youtubeApi.ts
      playlistParser.ts
      trackResolver.ts
      nativeExtractor.ts
      playerSetup.ts
      PlaybackService.ts
      recommendations.ts    Full engine (genre, artist graph)
    components/             7 RN components
    screens/                7 screens, all ported
      SearchScreen          play next + add to queue
      LibraryScreen         liked songs + create playlist
      PlaylistDetailScreen  likes support
      FullPlayerScreen      shuffle, repeat, like, queue
      QueueScreen
      SettingsScreen        crossfade + multi-key
      DiscoverScreen        recommendations UI  NEW
    navigation/
      RootNavigator         4 tabs + modals
    hooks/
    theme/                  Colors, typography, spacing
    utils/
    types/
```

## Auth + Smart API Key Routing

### Problem
Users need a YouTube Data API key. Daily quota (~10k units). When quota runs out, playback breaks.

### Solution — Multi-Key Vault with Adaptive Routing

```
User adds multiple API keys
  Key Vault
    Key 1: AIza...  (primary)
    Key 2: AIza...  (backup)
    ...
  Adaptive Router
    1. Pick active key with lowest quota usage
    2. Try request
    3. If 403/429 -> mark exhausted, route to next
    4. If all exhausted -> show warning
```

### Key Manager (keyRouter.ts)
- Add/remove/toggle keys
- Auto-picks best key by lowest quota usage
- Marks failed keys, routes to next
- Reset daily counters

### Auth Flow (Future)
- Phase 1: Local multi-key (done)
- Phase 2: User accounts + cloud sync of keys
- Phase 3: Community key pool

## Tasks Remaining

### Desktop (what's left)
- [ ] Integrate keyRouter into search/resolve calls
- [ ] Smart retry with next key on quota error

### Mobile (what's left)
- [ ] npm install + compile check
- [ ] Test npx react-native run-android
- [ ] Fix any compilation issues

### General
- [ ] Push monorepo to GitHub, replace old repos
