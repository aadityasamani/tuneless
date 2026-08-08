const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

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
function getTempPath(videoId) { return path.join(TEMP_DIR, `${videoId}.m4a`); }

let mainWindow;
let streamServer;

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

    // ── Check for cached temp file from a previous pipe download ──
    const tempPath = getTempPath(videoId);
    if (fs.existsSync(tempPath)) {
      const stat = fs.statSync(tempPath);
      if (stat.size > 0) {
        console.log(`[stream] serving cached file ${videoId} (${stat.size} bytes)`);
        res.writeHead(200, {
          'Content-Type': 'audio/mp4',
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(tempPath).pipe(res);
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
        : 'bestaudio[ext=m4a][abr>128]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio';
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

      // Serve the complete file
      const stat = fs.statSync(tempPath);
      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(tempPath).pipe(res);

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

  // Show window when ready, with a fallback timeout
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Safety timeout — if page doesn't render in 10s, force show anyway
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); } }, 10000);

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
    if (url.startsWith('http://localhost') && url.includes('access_token=')) {
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

  // Closing the window quits the app — no hidden background process.
  mainWindow.on('close', () => {
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('ready', () => {
  // Register global media key shortcuts (for keyboards/headsets that don't use MediaSession)
  globalShortcut.register('MediaPlayPause', () => { if (mainWindow) mainWindow.webContents.send('media:play-pause'); });
  globalShortcut.register('MediaNextTrack', () => { if (mainWindow) mainWindow.webContents.send('media:next'); });
  globalShortcut.register('MediaPreviousTrack', () => { if (mainWindow) mainWindow.webContents.send('media:prev'); });
  globalShortcut.register('MediaStop', () => { if (mainWindow) mainWindow.webContents.send('media:stop'); });
  try {
    startStreamServer();
  } catch (e) {
    console.error('[startup] stream server failed:', e.message);
  }
  createWindow();
});
app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (streamServer) streamServer.close();
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

// ── IPC: Spotify Playlist Import ────────────────────────────────────────
ipcMain.handle('spotify:import-playlist', async (event, { clientId, clientSecret, playlistUrl }) => {
  try {
    // Extract playlist ID from URL
    const match = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match) return { error: 'Invalid Spotify playlist URL' };
    const playlistId = match[1];

    // Get access token
    const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const tokenData = await new Promise((resolve, reject) => {
      const body = 'grant_type=client_credentials';
      const req = https.request('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-urlencoded', 'Content-Length': body.length },
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad token response')); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (!tokenData.access_token) return { error: 'Spotify auth failed' };

    // Fetch playlist info
    const plData = await new Promise((resolve, reject) => {
      https.get(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`, {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad playlist response')); } });
      }).on('error', reject);
    });

    // Fetch all tracks (paginated, up to 500)
    const tracks = [];
    let offset = 0;
    const limit = 100;
    while (offset < Math.min(plData.tracks.total, 500)) {
      const pageData = await new Promise((resolve, reject) => {
        https.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}&fields=items(track(name,artists,album,duration_ms))`, {
          headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
        }, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad tracks response')); } });
        }).on('error', reject);
      });
      for (const item of (pageData.items || [])) {
        const t = item.track;
        if (!t) continue;
        tracks.push({
          name: t.name,
          artist: t.artists.map(a => a.name).join(', '),
          ytId: null,
        });
      }
      offset += limit;
    }

    return { name: plData.name, trackCount: tracks.length, tracks };
  } catch (e) {
    return { error: e.message || 'Import failed' };
  }
});

// ── IPC: Stream + search + resolve ───────────────────────────────
ipcMain.handle('play:stream', async (event, { videoId }) => {
  const base = `http://127.0.0.1:${STREAM_PORT}/stream/${videoId}`;
  console.log('[play:stream]', videoId);

  // If the temp file already exists from a previous play, return immediately
  // (no yt-dlp wait — the proxy will serve the cached file in ~0ms).
  const tempPath = getTempPath(videoId);
  if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
    return { primary: base, fallback: base };
  }

  // For new songs: run yt-dlp to validate extraction works (bot-check detection)
  // AND download the full audio in one pass. The proxy serves the file
  // once the download completes (~4-6s for a 3:30 song at 740KB/s).
  try {
    const formatArg = 'bestaudio[ext=m4a][abr>128]/bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio';
    const ytdlpArgs = [
      '-f', formatArg,
      '-o', tempPath,
      '--no-warnings',
      '--extractor-retries', '2',
    ];
    if (COOKIES_PATH) ytdlpArgs.push('--cookies', COOKIES_PATH);
    ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

    await new Promise((resolve, reject) => {
      const proc = execFile(YTDLP_PATH, ytdlpArgs, { timeout: 120000 });
      let stderrBuf = '';
      proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
          const size = fs.statSync(tempPath).size;
          console.log(`[play:stream] downloaded ${videoId}: ${size} bytes`);
          resolve();
        } else {
          const isBot = /sign in to confirm|not a bot|bot.?check/i.test(stderrBuf);
          if (isBot) reject(new Error('YouTube bot-check: set up cookies in Settings'));
          else reject(new Error('yt-dlp failed (exit ' + code + ')'));
        }
      });
      proc.on('error', reject);
    });

    return { primary: base, fallback: base };
  } catch (e) {
    console.error('[play:stream] failed:', e.message);
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    return { error: e.message || 'Could not get audio stream' };
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
