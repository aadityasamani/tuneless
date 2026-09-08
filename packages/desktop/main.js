const { app, BrowserWindow, ipcMain, dialog, globalShortcut, protocol, net, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

// Register custom protocol and Windows app identity BEFORE app is ready.
app.setAsDefaultProtocolClient('tuneless');
if (process.platform === 'win32') app.setAppUserModelId('com.tuneless.desktop');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const STREAM_PORT = 18762;
const YTDLP_PATH = app?.isPackaged
  ? path.join(process.resourcesPath, 'yt-dlp.exe')
  : path.join(__dirname, 'yt-dlp.exe');

// Optional cookies.txt that unlocks YouTube extraction when the bot-check
// blocks unauthenticated yt-dlp. Placed in the app's userData folder.
let COOKIES_PATH = null;
try {
  COOKIES_PATH = path.join(app.getPath('userData'), 'cookies.txt');
  if (!require('fs').existsSync(COOKIES_PATH)) COOKIES_PATH = null;
} catch { COOKIES_PATH = null; }

// ── Local HTTP proxy ───────────────────────────────────────────────
// yt-dlp downloads full audio to a temp file, then the proxy serves it.
// This avoids the ~3:36 truncation caused by YouTube CDN closing the
// connection after the first DASH segment.

// Temporary audio files from yt-dlp pipe mode.
// The <audio> element can't handle YouTube DASH streams directly (truncated
// at first segment ~3:36). Solution: yt-dlp downloads the FULL file at
// ~740KB/s, we save it to a temp file, and serve a file:// URL to the
// <audio> element — zero truncation, zero buffering issues.
const TEMP_DIR = path.join(app?.getPath('temp') || '/tmp', 'tuneless-audio');
try { require('fs').mkdirSync(TEMP_DIR, { recursive: true }); } catch {}
function getTempPath(videoId, format = 'primary') {
  // Preserve the v2.0.7 primary-cache filename so existing complete downloads
  // remain playable without another yt-dlp request. Only fallback needs a
  // distinct cache file.
  return path.join(TEMP_DIR, format === 'fallback' ? `${videoId}.fallback.m4a` : `${videoId}.m4a`);
}

// ── Permanent Offline Music Directory ──────────────────────────────────
const OFFLINE_DIR = path.join(app?.getPath('userData') || app?.getPath('temp') || '/tmp', 'offline-music');
try { require('fs').mkdirSync(OFFLINE_DIR, { recursive: true }); } catch {}
const OFFLINE_INDEX_PATH = path.join(OFFLINE_DIR, 'offline-index.json');

function loadOfflineIndex() {
  try {
    if (fs.existsSync(OFFLINE_INDEX_PATH)) {
      const data = JSON.parse(fs.readFileSync(OFFLINE_INDEX_PATH, 'utf-8'));
      return Array.isArray(data) ? data : [];
    }
  } catch {}
  return [];
}

function saveOfflineIndex(list) {
  try {
    fs.writeFileSync(OFFLINE_INDEX_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[offline] could not save index:', e.message);
  }
}

function getOfflinePath(videoId) {
  return path.join(OFFLINE_DIR, `${videoId}.m4a`);
}


function serveAudioFile(req, res, filePath) {
  const { size } = fs.statSync(filePath);
  const headers = {
    'Content-Type': 'audio/mp4',
    'Accept-Ranges': 'bytes',
  };
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    res.end();
    return;
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength === 0) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }

  if (start >= size || start > end) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': end - start + 1,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(filePath, { start, end }).pipe(res);
}

let mainWindow;
let streamServer;
let rendererMediaSessionActive = false;
const mediaShortcutActions = [
  ['MediaPlayPause', 'media:play-pause'],
  ['MediaNextTrack', 'media:next'],
  ['MediaPreviousTrack', 'media:prev'],
  ['MediaStop', 'media:stop'],
];

function registerMediaShortcuts() {
  for (const [accelerator, channel] of mediaShortcutActions) {
    const registered = globalShortcut.register(accelerator, () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
    });
    if (!registered) console.warn(`[media] could not register ${accelerator}`);
  }
}

function unregisterMediaShortcuts() {
  for (const [accelerator] of mediaShortcutActions) globalShortcut.unregister(accelerator);
}

// ── System tray + customizable global hotkey ────────────────────────────
// Closing the window hides Tuneless to the tray so the global hotkey keeps
// working. Quit from the tray menu (or Ctrl+Q) to fully exit.
let tray = null;
let isQuitting = false;
let customHotkey = null; // currently registered accelerator string

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('Tuneless');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Tuneless', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => sendToRenderer('media:play-pause') },
    { label: 'Next Track', click: () => sendToRenderer('media:next') },
    { label: 'Previous Track', click: () => sendToRenderer('media:prev') },
    { type: 'separator' },
    { label: 'Quit Tuneless', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
    else showMainWindow();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

let overlayWindow = null;

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;
  overlayWindow = new BrowserWindow({
    width: 580,
    height: 490,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  overlayWindow.on('blur', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  });
}

function showOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    overlayWindow.once('ready-to-show', () => {
      syncAndShowOverlay();
    });
  } else {
    syncAndShowOverlay();
  }
}

function syncAndShowOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.center();
  overlayWindow.show();
  overlayWindow.focus();

  // If mainWindow doesn't exist yet, create it in the background
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('overlay:request-state');
    });
  } else {
    mainWindow.webContents.send('overlay:request-state');
  }
}

function registerCustomHotkey(accelerator) {
  // Unregister previous custom hotkey
  if (customHotkey) {
    try { globalShortcut.unregister(customHotkey); } catch {}
    customHotkey = null;
  }
  if (!accelerator) return { ok: false, error: 'No hotkey set' };
  try {
    const registered = globalShortcut.register(accelerator, () => {
      // Toggle Quick Launcher Overlay
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.hide();
      } else {
        showOverlayWindow();
      }
    });
    if (registered) {
      customHotkey = accelerator;
      console.log(`[hotkey] registered: ${accelerator}`);
      return { ok: true };
    } else {
      return { ok: false, error: `Could not register "${accelerator}" — it may be in use by another app` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// IPC: renderer sends hotkey config on boot and when user changes it
ipcMain.handle('hotkey:register', async (event, { accelerator }) => {
  return registerCustomHotkey(accelerator);
});

ipcMain.handle('hotkey:unregister', async () => {
  if (customHotkey) {
    try { globalShortcut.unregister(customHotkey); } catch {}
    customHotkey = null;
  }
  return { ok: true };
});

// IPC: Overlay HUD relays
ipcMain.on('overlay:send-state', (event, state) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:state', state);
  }
});

ipcMain.on('overlay:play-playlist', (event, data) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:play-playlist', data);
  }
});

ipcMain.on('overlay:toggle-play', () => {
  sendToRenderer('media:play-pause');
});

ipcMain.on('overlay:next-track', () => {
  sendToRenderer('media:next');
});

ipcMain.on('overlay:prev-track', () => {
  sendToRenderer('media:prev');
});

ipcMain.on('overlay:close', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
});

ipcMain.on('overlay:open-full-app', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  showMainWindow();
});

// IPC: Auto-start on system boot
ipcMain.handle('autostart:get', async () => {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('autostart:set', async (event, { enabled }) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: true,
      args: ['--hidden'],
    });
    const updated = app.getLoginItemSettings();
    return { ok: true, enabled: updated.openAtLogin };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});


// Shared by foreground playback and background preloading. A track may only
// have one yt-dlp process writing its cache file at a time.
const activeDownloads = new Map();

// ── Local HTTP proxy ───────────────────────────────────────────────────
// Uses yt-dlp to extract audio stream URLs. yt-dlp is the gold standard for
// YouTube extraction — actively maintained, handles all encryption changes.
// Supports ?format=fallback to request a different format tier / CDN node.

function startStreamServer() {
  streamServer = http.createServer(async (req, res) => {
    const match = req.url.match(/^\/stream\/([a-zA-Z0-9_-]+)(?:\?([^#]*))?$/);
    if (!match) { res.writeHead(404); res.end(); return; }

    const videoId = match[1];
    const query = new URLSearchParams(match[2] || '');
    const useFallback = query.get('format') === 'fallback';
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.log(`[stream] request: /${videoId} ${useFallback ? '(fallback)' : '(primary)'}`);

    // ── Check for offline downloaded permanent file first ──
    const offlinePath = getOfflinePath(videoId);
    if (fs.existsSync(offlinePath)) {
      const stat = fs.statSync(offlinePath);
      if (stat.size > 0) {
        console.log(`[stream] serving offline downloaded file ${videoId} (${stat.size} bytes)`);
        serveAudioFile(req, res, offlinePath);
        return;
      }
    }

    // ── Check for cached temp file from a previous pipe download ──
    const tempPath = getTempPath(videoId, useFallback ? 'fallback' : 'primary');
    if (fs.existsSync(tempPath)) {
      const stat = fs.statSync(tempPath);
      if (stat.size > 0) {
        console.log(`[stream] serving cached file ${videoId} (${stat.size} bytes)`);
        serveAudioFile(req, res, tempPath);
        return;
      }
    }

    // ── Pipe mode: yt-dlp downloads full audio at ~740KB/s to temp file ──
    // Then serve the file to the audio element. This avoids the ~3:36
    // truncation caused by YouTube CDN closing the connection after the first
    // DASH segment when proxied through Node.js https.get (which is throttled
    // to ~32KB/s — slower than audio playback rate of ~44KB/s).
    try {
      const formatArg = useFallback
        ? 'bestaudio[acodec!=opus]/bestaudio[ext=m4a]/bestaudio'
        : 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio';
      const ytdlpArgs = [
        '-f', formatArg,
        '-o', tempPath,
        '--no-warnings',
        '--extractor-retries', '2',
      ];
      if (COOKIES_PATH) ytdlpArgs.push('--cookies', COOKIES_PATH);
      ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

      console.log(`[stream] downloading: yt-dlp ${videoId} → ${tempPath}`);
      const start = Date.now();

      await new Promise((resolve, reject) => {
        const proc = execFile(YTDLP_PATH, ytdlpArgs, { timeout: 120000 });
        let stderrBuf = '';

        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
        proc.stdout.on('data', () => {}); // consume stdout

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
            const size = fs.statSync(tempPath).size;
            console.log(`[stream] download complete: ${videoId} ${size} bytes in ${((Date.now()-start)/1000).toFixed(1)}s`);
            resolve();
          } else {
            const isBot = /sign in to confirm|not a bot|bot.?check/i.test(stderrBuf);
            if (isBot) reject(new Error('YouTube bot-check: set up cookies in Settings'));
            else reject(new Error('yt-dlp failed (exit ' + code + ')'));
          }
        });

        proc.on('error', (err) => { reject(err); });

        // If client disconnects, kill yt-dlp to stop unnecessary downloads
        req.on('close', () => { if (!proc.killed) proc.kill(); });
      });

      // Serve the complete, locally cached file after yt-dlp finishes.
      serveAudioFile(req, res, tempPath);

    } catch (err) {
      console.error('[stream] error:', err.message);
      // Clean up partial temp file
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      if (!res.headersSent) {
        const status = /bot-check/i.test(err.message) ? 502 : 502;
        res.writeHead(status); res.end(err.message);
      }
    }
  });

  streamServer.listen(STREAM_PORT, '127.0.0.1', () => {
    console.log(`[stream] server on port ${STREAM_PORT} (yt-dlp file cache)`);
  });
  streamServer.on('error', (err) => {
    console.error('[stream] server error:', err.message);
    if (err.code === 'EADDRINUSE') {
      setTimeout(() => { streamServer.close(); streamServer.listen(STREAM_PORT, '127.0.0.1'); }, 1000);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960, height: 680, minWidth: 680, minHeight: 480,
    title: 'Tuneless', backgroundColor: '#000000',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window only when fully rendered — prevents blank/white flash (unless started hidden)
  const isHiddenLaunch = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
  let shown = false;
  mainWindow.once('ready-to-show', () => {
    if (!shown && !isHiddenLaunch) { shown = true; mainWindow.show(); }
  });
  // Fallback: if page doesn't render in 8s, show anyway (unless hidden launch)
  setTimeout(() => {
    if (!shown && !isHiddenLaunch && mainWindow && !mainWindow.isDestroyed()) {
      shown = true;
      mainWindow.show();
    }
  }, 8000);

  // Log renderer errors to help debug
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[renderer]', message);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[renderer] load failed:', errorCode, errorDescription);
    mainWindow.show(); // Force show so user sees the error
  });
  mainWindow.webContents.on('crashed', () => {
    console.error('[renderer] crashed');
    mainWindow.show();
  });

  // Intercept Supabase password recovery / OAuth redirect on main window
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isRecovery = (url.startsWith('http://localhost') || url.startsWith('tuneless://'))
      && url.includes('access_token=');
    if (isRecovery) {
      e.preventDefault();
      // Extract tokens from the URL fragment and send to renderer
      try {
        const parsed = new URL(url);
        const hash = parsed.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type = params.get('type');
        if (accessToken) {
          mainWindow.webContents.send('auth:recovery', {
            access_token: accessToken,
            refresh_token: refreshToken,
            type: type,
          });
        }
      } catch (err) {
        console.error('[main] failed to parse recovery URL:', err);
      }
      // Navigate back to the app
      mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
  });

  // Closing the window hides it to the system tray so the global hotkey and
  // playback keep working. Quit from the tray menu to fully exit.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // Ensure the stream server is torn down on the way out.
    if (streamServer) streamServer.close();
  });
}

// ── Single instance lock ─────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Extract deep link URL from command line (Windows sends tuneless:// URLs here)
    const deepLink = commandLine.find(arg => arg.startsWith('tuneless://'));
    if (deepLink && mainWindow) {
      handleDeepLink(deepLink);
    }
    showMainWindow();
  });
}

// Handle deep link (custom protocol) URLs
function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');
    if (accessToken && mainWindow) {
      mainWindow.webContents.send('auth:recovery', {
        access_token: accessToken,
        refresh_token: refreshToken,
        type: type,
      });
    }
  } catch (e) {
    console.error('[deep-link] failed to parse:', url, e);
  }
}

// Also handle deep link on macOS/Linux (open-url event)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('tuneless://')) {
    handleDeepLink(url);
  }
});

// Disable GPU acceleration to prevent "not responding" after install
// (GPU cache creation fails on fresh installs causing renderer hang)
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

app.on('ready', () => {
  // Use global shortcuts only until the renderer confirms that Chromium Media
  // Session is available. Registering both paths makes one headset press race
  // two independent play/pause handlers.
  registerMediaShortcuts();
  createTray();
  createOverlayWindow();
  try {
    startStreamServer();
  } catch (e) {
    console.error('[startup] stream server failed:', e.message);
  }
  // Delay window creation slightly to let system settle after install
  setTimeout(() => createWindow(), 500);
});
// Window is hidden to tray on close, so don't quit when all windows are closed.
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
app.on('activate', () => { showMainWindow(); });
app.on('before-quit', () => {
  isQuitting = true;
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try { overlayWindow.destroy(); } catch {}
  }
  if (streamServer) streamServer.close();
});

// Chromium's Media Session is the authoritative controller for Bluetooth
// headsets, lock-screen controls, and Windows media controls. Once it is live,
// stop consuming the same physical keys through Electron's globalShortcut API.
ipcMain.on('media-session:active', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || rendererMediaSessionActive) return;
  rendererMediaSessionActive = true;
  unregisterMediaShortcuts();
  console.log('[media] using renderer Media Session controls');
});

// ── IPC: Diagnostics ─────────────────────────────────────────────
ipcMain.handle('ytdlp:test', async (event, { videoId }) => {
  const results = { success: false, bytes: 0, time: 0, error: null };
  const vid = videoId || 'dQw4w9WgXcQ';
  const testPath = getTempPath('_test_' + vid);
  try {
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const args = [
        '-f', 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio',
        '-o', testPath,
        '--no-warnings',
        '--extractor-retries', '2',
      ];
      if (COOKIES_PATH) args.push('--cookies', COOKIES_PATH);
      args.push(`https://www.youtube.com/watch?v=${vid}`);
      const proc = execFile(YTDLP_PATH, args, { timeout: 60000 });
      let stderrBuf = '';
      proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(testPath) && fs.statSync(testPath).size > 0) {
          resolve();
        } else {
          const isBot = /sign in to confirm|not a bot|bot.?check/i.test(stderrBuf);
          reject(new Error(isBot ? 'Bot-check blocked' : 'yt-dlp exit ' + code));
        }
      });
      proc.on('error', reject);
    });
    const stat = fs.statSync(testPath);
    results.success = true;
    results.bytes = stat.size;
    results.time = ((Date.now() - start) / 1000).toFixed(1);
  } catch (e) {
    results.error = e.message;
  }
  try { if (fs.existsSync(testPath)) fs.unlinkSync(testPath); } catch {}
  return results;
});

ipcMain.handle('ytdlp:version', async () => {
  try {
    const out = await new Promise((res, rej) => {
      execFile(YTDLP_PATH, ['--version'], { timeout: 10000 }, (e, stdout) => e ? rej(e) : res(stdout.trim()));
    });
    return out;
  } catch (e) { return 'ERROR: ' + e.message; }
});

ipcMain.handle('cache:status', async () => {
  try {
    const files = fs.readdirSync(TEMP_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.m4a'));
    const bytes = files.reduce((total, entry) => total + fs.statSync(path.join(TEMP_DIR, entry.name)).size, 0);
    return { files: files.length, bytes };
  } catch (e) { return { files: 0, bytes: 0, error: e.message }; }
});

ipcMain.handle('cache:clear', async () => {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
});

// ── IPC: Cookies for YouTube bot-check bypass ─────────────────────
ipcMain.handle('cookies:status', async () => {
  const p = path.join(app.getPath('userData'), 'cookies.txt');
  return { present: fs.existsSync(p), path: p };
});

ipcMain.handle('cookies:import', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select cookies.txt (exported from your browser)',
    properties: ['openFile'],
    filters: [{ name: 'Netscape cookies', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, message: 'Cancelled' };
  try {
    const src = result.filePaths[0];
    const dest = path.join(app.getPath('userData'), 'cookies.txt');
    const data = fs.readFileSync(src, 'utf8');
    // Basic sanity: Netscape cookie format lines
    const validLines = data.split('\n').filter(l => !l.startsWith('#') && l.trim()).length;
    if (validLines < 1) throw new Error('File looks empty or not in Netscape format');
    fs.writeFileSync(dest, data);
    COOKIES_PATH = dest;
    // Clear cached audio files so next play re-extracts WITH cookies
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch {}
    return { ok: true, message: 'Cookies saved. Streams now use them.' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('cookies:remove', async () => {
  const p = path.join(app.getPath('userData'), 'cookies.txt');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  COOKIES_PATH = null;
  return { ok: true };
});

// ── IPC: Google OAuth (Supabase) ───────────────────────────────────────
ipcMain.handle('auth:google', async (event, { supabaseUrl, redirectUrl }) => {
  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
      width: 500, height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      title: 'Sign in with Google',
      parent: mainWindow,
      modal: false,
      autoHideMenuBar: true,
    });

    // Google OAuth via Supabase
    const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
    authWindow.loadURL(authUrl);

    // Listen for navigation to our custom protocol callback
    authWindow.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith('tuneless://')) {
        e.preventDefault();
        try {
          const parsed = new URL(url);
          const hash = parsed.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken && refreshToken) {
            // Get user info from Supabase
            https.get(`${supabaseUrl}/auth/v1/user`, {
              headers: { Authorization: `Bearer ${accessToken}`, apikey: '' },
            }, (res) => {
              let data = '';
              res.on('data', (c) => data += c);
              res.on('end', () => {
                try {
                  const user = JSON.parse(data);
                  mainWindow.webContents.send('auth:google-result', {
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    user,
                  });
                } catch {
                  mainWindow.webContents.send('auth:google-result', {
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    user: null,
                  });
                }
                authWindow.close();
                resolve({ ok: true });
              });
            }).on('error', () => {
              mainWindow.webContents.send('auth:google-result', {
                access_token: accessToken,
                refresh_token: refreshToken,
                user: null,
              });
              authWindow.close();
              resolve({ ok: true });
            });
          } else {
            authWindow.close();
            resolve({ ok: false, error: 'No tokens in callback' });
          }
        } catch (e) {
          authWindow.close();
          resolve({ ok: false, error: e.message });
        }
      }
    });

    // Also handle will-redirect (some OAuth flows use redirect instead of navigate)
    authWindow.webContents.on('will-redirect', (e, url) => {
      if (url.startsWith('tuneless://')) {
        e.preventDefault();
        // Same handling as will-navigate
        try {
          const parsed = new URL(url);
          const hash = parsed.hash.substring(1);
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            mainWindow.webContents.send('auth:google-result', {
              access_token: accessToken,
              refresh_token: refreshToken,
              user: null,
            });
          }
        } catch {}
        authWindow.close();
        resolve({ ok: true });
      }
    });

    // Handle window closed without auth
    authWindow.on('closed', () => {
      resolve({ ok: false, error: 'Window closed' });
    });
  });
});

// ── IPC: Stream + search + resolve ───────────────────────────────
async function downloadPrimaryAudio(videoId, reason = 'play') {
  const offlinePath = getOfflinePath(videoId);
  if (fs.existsSync(offlinePath) && fs.statSync(offlinePath).size > 0) return { cached: true, offline: true };

  const tempPath = getTempPath(videoId, 'primary');
  if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) return { cached: true };

  const existing = activeDownloads.get(videoId);
  if (existing) return existing;

  const task = new Promise((resolve, reject) => {
    const ytdlpArgs = [
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio',
      '-o', tempPath,
      '--no-warnings',
      '--extractor-retries', '2',
    ];
    if (COOKIES_PATH) ytdlpArgs.push('--cookies', COOKIES_PATH);
    ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);
    console.log(`[stream:${reason}] downloading ${videoId}`);
    const proc = execFile(YTDLP_PATH, ytdlpArgs, { timeout: 120000 });
    let stderrBuf = '';
    proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
        const size = fs.statSync(tempPath).size;
        console.log(`[stream:${reason}] downloaded ${videoId}: ${size} bytes`);
        resolve({ cached: false, bytes: size });
      } else {
        const isBot = /sign in to confirm|not a bot|bot.?check/i.test(stderrBuf);
        reject(new Error(isBot ? 'YouTube bot-check: set up cookies in Settings' : 'yt-dlp failed (exit ' + code + ')'));
      }
    });
    proc.on('error', reject);
  });

  activeDownloads.set(videoId, task);
  try {
    return await task;
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}

ipcMain.handle('play:stream', async (event, { videoId }) => {
  const base = `http://127.0.0.1:${STREAM_PORT}/stream/${videoId}`;
  const fallback = `${base}?format=fallback`;
  try {
    await downloadPrimaryAudio(videoId, 'play');
    return { primary: base, fallback };
  } catch (e) {
    console.error('[play:stream] failed:', e.message);
    return { error: e.message || 'Could not get audio stream' };
  }
});

ipcMain.handle('preload:stream', async (event, { videoId }) => {
  try {
    const result = await downloadPrimaryAudio(videoId, 'preload');
    return { ok: true, ...result };
  } catch (e) {
    console.warn('[preload:stream] failed:', videoId, e.message);
    return { ok: false, error: e.message || 'Could not preload audio' };
  }
});

// ── IPC: Permanent Offline Music ─────────────────────────────────
ipcMain.handle('offline:check', async (event, { videoId }) => {
  if (!videoId) return false;
  const p = getOfflinePath(videoId);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
});

ipcMain.handle('offline:list', async () => {
  const index = loadOfflineIndex();
  const valid = index.filter(item => {
    const p = getOfflinePath(item.videoId || item.id);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  });
  if (valid.length !== index.length) {
    saveOfflineIndex(valid);
  }
  return valid;
});

ipcMain.handle('offline:delete', async (event, { videoId }) => {
  if (!videoId) return { ok: false };
  const p = getOfflinePath(videoId);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
  const index = loadOfflineIndex();
  const filtered = index.filter(i => (i.videoId || i.id) !== videoId);
  saveOfflineIndex(filtered);
  return { ok: true };
});

ipcMain.handle('offline:download', async (event, track) => {
  const videoId = track.videoId || track.id || track.ytId;
  if (!videoId) return { ok: false, error: 'No videoId provided' };

  const destPath = getOfflinePath(videoId);
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return { ok: true, cached: true };
  }

  // Check if it already exists in temp cache first — instant copy!
  const tempPrimary = getTempPath(videoId, 'primary');
  if (fs.existsSync(tempPrimary) && fs.statSync(tempPrimary).size > 0) {
    try {
      fs.copyFileSync(tempPrimary, destPath);
      const index = loadOfflineIndex();
      if (!index.some(i => (i.videoId || i.id) === videoId)) {
        index.push({
          videoId,
          title: track.title || track.name || 'Unknown',
          artist: track.artist || 'Unknown',
          thumb: track.thumb || '',
          duration: track.duration || '—',
          savedAt: Date.now(),
        });
        saveOfflineIndex(index);
      }
      return { ok: true, copiedFromCache: true };
    } catch (e) {
      console.warn('[offline] copy failed, will download directly:', e.message);
    }
  }

  // Otherwise download via yt-dlp directly to offline permanent path
  try {
    const ytdlpArgs = [
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio',
      '-o', destPath,
      '--no-warnings',
      '--extractor-retries', '2',
    ];
    if (COOKIES_PATH) ytdlpArgs.push('--cookies', COOKIES_PATH);
    ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

    await new Promise((resolve, reject) => {
      const proc = execFile(YTDLP_PATH, ytdlpArgs, { timeout: 180000 });
      let stderrBuf = '';
      proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
          resolve();
        } else {
          reject(new Error(stderrBuf || 'yt-dlp failed (exit ' + code + ')'));
        }
      });
      proc.on('error', reject);
    });

    const index = loadOfflineIndex();
    if (!index.some(i => (i.videoId || i.id) === videoId)) {
      index.push({
        videoId,
        title: track.title || track.name || 'Unknown',
        artist: track.artist || 'Unknown',
        thumb: track.thumb || '',
        duration: track.duration || '—',
        savedAt: Date.now(),
      });
      saveOfflineIndex(index);
    }
    return { ok: true };
  } catch (err) {
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
    return { ok: false, error: err.message };
  }
});


ipcMain.handle('search:youtube', async (event, { query, apiKey }) => {
  if (!apiKey) throw new Error('No API key');
  const d = await fetchJson(`${YOUTUBE_API_BASE}/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(query + ' official audio')}&key=${apiKey}`);
  if (!d.items?.length) return [];
  const ids = d.items.map(i => i.id.videoId).join(',');
  const dd = await fetchJson(`${YOUTUBE_API_BASE}/videos?part=contentDetails&id=${ids}&key=${apiKey}`);
  const dur = {}; (dd.items || []).forEach(v => { dur[v.id] = fmt(v.contentDetails.duration); });
  return d.items.map(i => ({
    id: i.id.videoId, title: i.snippet.title, artist: i.snippet.channelTitle,
    thumb: i.snippet.thumbnails.medium?.url || '', duration: dur[i.id.videoId] || '—',
  }));
});

ipcMain.handle('resolve:track', async (event, { trackName, artist, apiKey }) => {
  if (!apiKey) return null;
  const d = await fetchJson(`${YOUTUBE_API_BASE}/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(trackName + ' ' + artist + ' full audio song')}&key=${apiKey}`);
  if (!d.items?.length) return null;
  let best = null, bs = -999;
  for (const i of d.items) { const s = sc(i.snippet.title); if (s > bs) { bs = s; best = i; } }
  return best?.id?.videoId || null;
});

// ── Helpers ───────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Tuneless/1.0', 'Accept': 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { const json = JSON.parse(d); if (json.error) reject(new Error(json.error.message || 'API error')); else resolve(json); }
        catch { reject(new Error('Invalid API response')); }
      });
    }).on('error', reject);
  });
}

function fmt(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '—';
  const h = +m[1]||0, mn = +m[2]||0, s = +m[3]||0;
  return h ? h+':'+String(mn).padStart(2,'0')+':'+String(s).padStart(2,'0') : mn+':'+String(s).padStart(2,'0');
}

function sc(t) {
  const s = t.toLowerCase(); let n = 0;
  if (/\b(full\s*audio|audio\s*song)\b/.test(s)) n += 10;
  else if (/\bofficial\s*audio\b/.test(s)) n += 9;
  else if (/\bofficial\b/.test(s)) n += 3;
  if (/\blyrics?\b/.test(s)) n += 5;
  if (/\b(covers?|remix|mashup)\b/.test(s)) n -= 5;
  if (/\blive\b/.test(s)) n -= 3;
  return n;
}

// ── SPOTIFY RECOMMENDATIONS ──────────────────────────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken(clientId, clientSecret) {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;
  if (!clientId || !clientSecret) return null;

  const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');
  const data = await new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const req = https.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
      },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad token response')); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (data.access_token) {
    _spotifyToken = data.access_token;
    _spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _spotifyToken;
  }
  return null;
}

async function searchSpotifyTrack(query, token) {
  const d = await fetchJsonSpotify(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=3`, token);
  if (!d?.tracks?.items?.length) return null;
  const t = d.tracks.items[0];
  return {
    id: t.id, name: t.name, artist: t.artists.map(a => a.name).join(', '),
    album: t.album.name, image: t.album.images?.[0]?.url || '',
    genres: t.artists?.[0]?.id ? await getArtistGenres(t.artists[0].id, token) : [],
  };
}

async function getArtistGenres(artistId, token) {
  try {
    const d = await fetchJsonSpotify(`https://api.spotify.com/v1/artists/${artistId}`, token);
    return d?.genres || [];
  } catch { return []; }
}

async function getSpotifyRecommendations(seedGenres, seedTracks, token, limit = 15) {
  const params = new URLSearchParams();
  if (seedGenres?.length) params.set('seed_genres', seedGenres.slice(0, 5).join(','));
  if (seedTracks?.length) params.set('seed_tracks', seedTracks.slice(0, 5).join(','));
  params.set('limit', Math.min(limit, 30));
  params.set('market', 'IN');

  const d = await fetchJsonSpotify(`https://api.spotify.com/v1/recommendations?${params.toString()}`, token);
  if (!d?.tracks?.length) return [];

  return d.tracks.map(t => ({
    id: t.id, name: t.name, artist: t.artists.map(a => a.name).join(', '),
    previewUrl: t.preview_url, externalUrl: t.external_urls?.spotify,
    image: t.album?.images?.[0]?.url || '',
    popularity: t.popularity || 0,
  }));
}

async function fetchJsonSpotify(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
    }).on('error', reject);
  });
}

// ── IPC: Spotify recommendations ──────────────────────────────────────
ipcMain.handle('spotify:token', async (event, { clientId, clientSecret }) => {
  const token = await getSpotifyToken(clientId, clientSecret);
  return token ? 'ok' : null;
});

ipcMain.handle('spotify:recommendations', async (event, { clientId, clientSecret, genres, trackQueries }) => {
  const token = await getSpotifyToken(clientId, clientSecret);
  if (!token) return { error: 'Spotify not configured' };

  // First try genre-based recommendations
  let recs = [];
  if (genres?.length) {
    recs = await getSpotifyRecommendations(genres, [], token, 15);
  }

  // If not enough, try track-based
  if (recs.length < 10 && trackQueries?.length) {
    // Resolve track queries to Spotify IDs
    const spotifyIds = [];
    for (const q of trackQueries.slice(0, 3)) {
      try {
        const result = await searchSpotifyTrack(q, token);
        if (result?.id) spotifyIds.push(result.id);
      } catch {}
    }
    if (spotifyIds.length) {
      const moreRecs = await getSpotifyRecommendations([], spotifyIds, token, 15);
      const seen = new Set(recs.map(r => r.id));
      for (const r of moreRecs) { if (!seen.has(r.id)) { recs.push(r); seen.add(r.id); } }
    }
  }

  return recs;
});

ipcMain.handle('spotify:search', async (event, { query, clientId, clientSecret }) => {
  const token = await getSpotifyToken(clientId, clientSecret);
  if (!token) return [];
  const d = await fetchJsonSpotify(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`, token);
  return (d?.tracks?.items || []).map(t => ({
    id: t.id, name: t.name, artist: t.artists.map(a => a.name).join(', '),
    image: t.album?.images?.[0]?.url || '', popularity: t.popularity || 0,
  }));
});

ipcMain.handle('spotify:genres', async (event, { clientId, clientSecret }) => {
  const token = await getSpotifyToken(clientId, clientSecret);
  if (!token) return [];
  const d = await fetchJsonSpotify('https://api.spotify.com/v1/recommendations/available-genre-seeds', token);
  return d?.genres || [];
});
