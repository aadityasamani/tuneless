const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tuneless', {
  searchYoutube: (query, apiKey) =>
    ipcRenderer.invoke('search:youtube', { query, apiKey }),
  resolveTrack: (trackName, artist, apiKey) =>
    ipcRenderer.invoke('resolve:track', { trackName, artist, apiKey }),
  playStream: (videoId) =>
    ipcRenderer.invoke('play:stream', { videoId }),

  // Diagnostics
  ytdlpVersion: () => ipcRenderer.invoke('ytdlp:version'),
  ytdlpTest: (videoId) => ipcRenderer.invoke('ytdlp:test', { videoId }),

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
});
