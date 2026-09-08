const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tuneless', {
  searchYoutube: (query, apiKey) =>
    ipcRenderer.invoke('search:youtube', { query, apiKey }),
  resolveTrack: (trackName, artist, apiKey) =>
    ipcRenderer.invoke('resolve:track', { trackName, artist, apiKey }),
  playStream: (videoId) =>
    ipcRenderer.invoke('play:stream', { videoId }),
  preloadStream: (videoId) =>
    ipcRenderer.invoke('preload:stream', { videoId }),

  // Diagnostics
  ytdlpVersion: () => ipcRenderer.invoke('ytdlp:version'),
  ytdlpTest: (videoId) => ipcRenderer.invoke('ytdlp:test', { videoId }),
  cacheStatus: () => ipcRenderer.invoke('cache:status'),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),

  // Cookies (YouTube bot-check bypass)
  cookiesStatus: () => ipcRenderer.invoke('cookies:status'),
  cookiesImport: () => ipcRenderer.invoke('cookies:import'),
  cookiesRemove: () => ipcRenderer.invoke('cookies:remove'),

  // Spotify API for recommendations
  spotifyToken: (clientId, clientSecret) =>
    ipcRenderer.invoke('spotify:token', { clientId, clientSecret }),
  spotifyRecommendations: (clientId, clientSecret, genres, trackQueries) =>
    ipcRenderer.invoke('spotify:recommendations', { clientId, clientSecret, genres, trackQueries }),
  spotifySearch: (query, clientId, clientSecret) =>
    ipcRenderer.invoke('spotify:search', { query, clientId, clientSecret }),
  spotifyGenres: (clientId, clientSecret) =>
    ipcRenderer.invoke('spotify:genres', { clientId, clientSecret }),

  // Google OAuth (Supabase)
  googleAuth: (supabaseUrl, redirectUrl) =>
    ipcRenderer.invoke('auth:google', { supabaseUrl, redirectUrl }),
  onGoogleAuthResult: (callback) =>
    ipcRenderer.on('auth:google-result', (event, data) => callback(data)),

  // Password recovery callback
  onRecovery: (callback) =>
    ipcRenderer.on('auth:recovery', (event, data) => callback(data)),

  // Media controls. Global-shortcut events are retained only as a fallback
  // when Chromium Media Session is unavailable in the renderer.
  mediaSessionActive: () => ipcRenderer.send('media-session:active'),
  onMediaPlayPause: (callback) => ipcRenderer.on('media:play-pause', () => callback()),
  onMediaNext: (callback) => ipcRenderer.on('media:next', () => callback()),
  onMediaPrev: (callback) => ipcRenderer.on('media:prev', () => callback()),
  onMediaStop: (callback) => ipcRenderer.on('media:stop', () => callback()),

  // Customizable global hotkey (works even when the window is hidden in tray)
  registerHotkey: (accelerator) => ipcRenderer.invoke('hotkey:register', { accelerator }),
  unregisterHotkey: () => ipcRenderer.invoke('hotkey:unregister'),
  onHotkeyTrigger: (callback) => ipcRenderer.on('hotkey:trigger', () => callback()),

  // Auto-start at system boot
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', { enabled }),

  // Quick Launcher Overlay communication
  onOverlayRequestState: (callback) => ipcRenderer.on('overlay:request-state', () => callback()),
  sendOverlayState: (state) => ipcRenderer.send('overlay:send-state', state),
  onOverlayPlayPlaylist: (callback) => ipcRenderer.on('overlay:play-playlist', (event, data) => callback(data)),

  // Permanent Offline Music
  downloadTrackOffline: (track) => ipcRenderer.invoke('offline:download', track),
  deleteTrackOffline: (videoId) => ipcRenderer.invoke('offline:delete', { videoId }),
  getOfflineTracks: () => ipcRenderer.invoke('offline:list'),
  isOfflineTrack: (videoId) => ipcRenderer.invoke('offline:check', { videoId }),
});

