# Tuneless 🎵

**Ad-free music streaming — YouTube powered, native everywhere.**

Tuneless is a cross-platform music streaming app that uses YouTube as its audio backend. Import your Spotify playlists, search for any song, and enjoy native background playback with proper media controls — no ads, no subscriptions, no browser needed.

Built as a **monorepo** with shared core logic across desktop and mobile.

---

## Architecture

```
tuneless/
├── packages/
│   ├── core/        ← Shared logic (scoring, shuffle, types, key router)
│   ├── desktop/     ← Electron app (Windows) — ✅ Production ready
│   └── mobile/      ← React Native (Android) — ✅ Ported, needs compile
├── ARCHITECTURE.md  ← Detailed architecture & auth plan
└── package.json     ← Workspaces root
```

## Packages

### 🖥️ Desktop (`packages/desktop/`)

A full-featured Windows desktop app built with Electron.

**Features:**
- 🔍 YouTube search via Data API v3 with smart result scoring
- ▶️ Native audio playback via yt-dlp (handles YouTube encryption)
- 📚 Spotify playlist import (Exportify CSV)
- 🔀 Smart shuffle (Fisher-Yates + same-artist spreading)
- ❤️ Like/unlike songs with auto-generated Liked Songs playlist
- 📝 Create playlists from scratch
- ➕ Play next / Add to queue
- 🔄 Crossfade (0-10 seconds, default 3s)
- 📊 Algorithmic recommendations from your own library
- 📱 Full-screen player with queue drawer
- 💾 Session persistence (remembers queue across restarts)
- 🎨 Minimal black & white design
- ⌨️ Keyboard shortcuts (Space, ←, →, ⌘K, F)

**How audio works:**
```
User taps play → ytdl extracts stream URL → local proxy server
→ audio element plays → zero CORS issues
```

**Build installer:**
```bash
cd packages/desktop
npm install
npm run dist
# → packages/desktop/dist/Tuneless-Setup-1.0.0.exe
```

### 📱 Mobile (`packages/mobile/`)

An Android app built with React Native.

**Same features as desktop** (all logic ported to Zustand stores):
- YouTube search + playback via native Kotlin module (NewPipe Extractor)
- All playlist/queue/likes/recommendations/crossfade features
- Native Android background audio via react-native-track-player
- MediaSession notification controls

**Build:**
```bash
cd packages/mobile
npm install
npx react-native run-android
```

### 📦 Core (`packages/core/`)

Pure TypeScript shared between desktop and mobile:
- `utils/scoring.ts` — YouTube title scoring algorithm
- `utils/shuffle.ts` — Fisher-Yates + same-artist spread
- `utils/formatting.ts` — Duration formatting, escaping
- `types.ts` — All shared TypeScript types
- `services/keyRouter.ts` — Multi-key adaptive routing

---

## Getting Started

### Prerequisites

- **Desktop:** Windows (the installer is a `.exe`)
- **Mobile:** [Android Studio](https://developer.android.com/studio), Node.js 22+
- A **YouTube Data API v3 key** (free)

### Desktop (quick start)

1. Download `Tuneless-Setup-1.0.0.exe`
2. Run the installer
3. Open app → **Settings** → paste your API key
4. Search and play any song

### Mobile (from source)

```bash
git clone https://github.com/aadityasamani/tuneless.git
cd tuneless
cd packages/mobile
npm install
npx react-native run-android
```

### Getting a YouTube API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable **YouTube Data API v3**
3. Go to **Credentials** → **Create API Key**
4. Paste into the app's Settings tab

### Importing Spotify Playlists

1. Go to [exportify.net](https://exportify.net) on desktop
2. Log in with Spotify (read-only, open source)
3. Click **Export** next to any playlist → CSV downloads
4. Open Tuneless → **Library** → tap the import box → pick the CSV

---

## Key Features Explained

### Recommendation Engine
Pure algorithmic — no external APIs. Analyzes your library:
- Maps every artist to genres using a 500+ keyword database
- Builds an artist similarity graph from playlist co-occurrence
- Finds tracks you haven't replayed from similar artists
- Falls back to genre-matched and random discovery

### Multi-Key Router
Add multiple YouTube API keys. When quota runs out:
1. Automatically rotates to the next available key
2. Tracks per-key quota usage
3. Marks exhausted keys to avoid repeated failures
4. Daily quota reset

### Session Persistence
Queue and current track are saved every change and restored within 24 hours.

---

## Screens

| Desktop | Mobile |
|---------|--------|
| Search — search YouTube, play next, add to queue | Same |
| Library — playlists, liked songs, import, create | Same |
| Discover — recently played, recommendations | Same |
| Full Player — controls, seek, queue, like | Same |
| Queue — up next, clear | Same |
| Settings — API key, crossfade, shortcuts | Same |

---

## Tech Stack

| Layer | Desktop | Mobile |
|-------|---------|--------|
| Framework | Electron | React Native CLI |
| Audio | yt-dlp (CLI) | NewPipe Extractor (Kotlin) |
| Player | HTML `<audio>` | react-native-track-player |
| State | Vanilla JS | Zustand |
| Persistence | localStorage | AsyncStorage |
| UI | HTML + CSS + Inter font | RN components + Inter font |
| Icons | SVG + PNG | PNG |
| Installer | NSIS (electron-builder) | APK (Android Studio) |

## License

MIT
