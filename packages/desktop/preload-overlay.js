const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onState: (callback) => {
    ipcRenderer.on('overlay:state', (event, data) => callback(data));
  },
  playPlaylist: (data) => {
    ipcRenderer.send('overlay:play-playlist', data);
  },
  togglePlay: () => {
    ipcRenderer.send('overlay:toggle-play');
  },
  nextTrack: () => {
    ipcRenderer.send('overlay:next-track');
  },
  prevTrack: () => {
    ipcRenderer.send('overlay:prev-track');
  },
  close: () => {
    ipcRenderer.send('overlay:close');
  },
  openFullApp: () => {
    ipcRenderer.send('overlay:open-full-app');
  },
});
