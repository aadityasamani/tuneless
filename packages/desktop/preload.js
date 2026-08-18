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

  // Spotify playlist import
  importSpotifyPlaylist: (clientId, clientSecret, playlistUrl) =>
    ipcRenderer.invoke('spotify:import-playlist', { clientId, clientSecret, playlistUrl }),

  // Password recovery callback
  onRecovery: (callback) =>
    ipcRenderer.on('auth:recovery', (event, data) => callback(data)),

  // Media key handlers
  onMediaPlayPause: (callback) => ipcRenderer.on('media:play-pause', () => callback()),
  onMediaNext: (callback) => ipcRenderer.on('media:next', () => callback()),
  onMediaPrev: (callback) => ipcRenderer.on('media:prev', () => callback()),
  onMediaStop: (callback) => ipcRenderer.on('media:stop', () => callback()),
});
