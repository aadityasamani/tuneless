const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execFile } = require('child_process');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const STREAM_PORT = 18762;
const YTDLP_PATH = app?.isPackaged
  ? path.join(process.resourcesPath, 'yt-dlp.exe')
  : path.join(__dirname, 'yt-dlp.exe');

// ── Stream URL cache (10-min TTL) ─────────────────────────────────────
// Avoids re-running yt-dlp for the same videoId + format pair
const streamCache = new Map();
const STREAM_CACHE_TTL = 10 * 60 * 1000;
function getCached(key) { const e = streamCache.get(key); if (e && Date.now() < e.expiry) return e.url; streamCache.delete(key); return null; }
function setCache(key, url) { streamCache.set(key, { url, expiry: Date.now() + STREAM_CACHE_TTL }); }

let mainWindow;
let streamServer;

// ── Local HTTP proxy ───────────────────────────────────────────────────
// Uses yt-dlp to extract audio stream URLs. yt-dlp is the gold standard for
// YouTube extraction — actively maintained, handles all encryption changes.
// Supports ?format=fallback to request a different format tier / CDN node.

function startStreamServer() {
  streamServer = http.createServer(async (req, res) => {
    const match = req.url.match(/^\/stream\/([a-zA-Z0-9_-]+)(?:\?format=(fallback))?$/);
    if (!match) { res.writeHead(404); res.end(); return; }

    const videoId = match[1];
    const useFallback = match[2] === 'fallback';
    const cacheKey = `${videoId}:${useFallback ? 'fallback' : 'primary'}`;
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // Step 1: Get the audio stream URL from yt-dlp (cached 10 min)
      let streamUrl = getCached(cacheKey);
      if (!streamUrl) {
        streamUrl = await getStreamUrl(videoId, useFallback ? 'fallback' : 'primary');
        if (streamUrl) setCache(cacheKey, streamUrl);
      }
      if (!streamUrl) {
        res.writeHead(502); res.end('No stream found');
        return;
      }

      // Step 2: Proxy the stream — forward YouTube's actual content type and headers.
      // IMPORTANT: Do NOT forward Content-Length. YouTube's reported size can
      // correspond to a partial segment (~3:36), which truncates playback in <audio>.
      // Omitting it lets the browser use chunked encoding and compute true duration.
      const range = req.headers.range;
      const opts = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
        },
      };
      if (range) opts.headers['Range'] = range;

      const audioReq = https.get(streamUrl, opts, (audioRes) => {
        const code = audioRes.statusCode || 200;
        // Forward the actual content type from YouTube (correct per-format)
        if (audioRes.headers['content-type']) {
          res.setHeader('Content-Type', audioRes.headers['content-type']);
        }
        // Forward Content-Range for seek support (206 responses)
        if (audioRes.headers['content-range']) {
          res.setHeader('Content-Range', audioRes.headers['content-range']);
        }
        // Forward Accept-Ranges so <audio> knows it can seek
        if (audioRes.headers['accept-ranges']) {
          res.setHeader('Accept-Ranges', audioRes.headers['accept-ranges']);
        } else {
          res.setHeader('Accept-Ranges', 'bytes');
        }
        res.writeHead(code);
        audioRes.pipe(res);
      });

      audioReq.on('error', (err) => {
        console.error('[stream] fetch error:', err.message);
        if (!res.headersSent) { res.writeHead(502); res.end('Fetch failed'); }
      });
    } catch (err) {
      console.error('[stream] error:', err.message);
      if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
    }
  });

  streamServer.listen(STREAM_PORT, '127.0.0.1', () => {
    console.log(`[stream] server on port ${STREAM_PORT} (yt-dlp backend)`);
  });
  streamServer.on('error', (err) => {
    console.error('[stream] server error:', err.message);
    if (err.code === 'EADDRINUSE') {
      setTimeout(() => { streamServer.close(); streamServer.listen(STREAM_PORT, '127.0.0.1'); }, 1000);
    }
  });
}

// ── yt-dlp stream URL extraction ──────────────────────────────────────
// mode 'primary'  → best M4A (AAC) — universally supported by HTML5 audio
// mode 'fallback' → best audio excluding Opus, likely a different CDN node
function getStreamUrl(videoId, mode = 'primary') {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Primary: best AAC audio in MP4 (universal HTML5 audio support on Windows).
    // Opus/WebM explicitly excluded — it stalls on Windows HTML5 audio.
    // Fallback: same exclusion but different format ordering so yt-dlp
    // returns a different CDN URL (often a different stream token / node).
    const formatArg = mode === 'primary'
      ? 'bestaudio[ext=m4a]/bestaudio[acodec!=opus]/bestaudio'
      : 'bestaudio[acodec!=opus]/bestaudio[ext=m4a]/bestaudio';

    const args = [
      '-f', formatArg,
      '--get-url',
      '--no-warnings',
      '--no-call-home',
      '--extractor-retries', '3',
      '--reconnect',
      '--reconnect-streamed',
      '--retry-sleep', '2',
      url,
    ];

    execFile(YTDLP_PATH, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err || !stdout?.trim()) {
        console.error(`[yt-dlp] ${mode} failed:`, err?.message);
        // Last resort: any audio format (including Opus — may not play but we try)
        const lastResortArgs = [
          '-f', 'bestaudio',
          '--get-url',
          '--no-warnings',
          '--no-call-home',
          '--reconnect',
          '--reconnect-streamed',
          '--retry-sleep', '2',
          url,
        ];
        execFile(YTDLP_PATH, lastResortArgs, { timeout: 30000 }, (err2, stdout2) => {
          if (err2 || !stdout2?.trim()) {
            console.error('[yt-dlp] last-resort also failed:', err2?.message);
            reject(new Error('yt-dlp failed'));
          } else {
            resolve(stdout2.trim());
          }
        });
      } else {
        resolve(stdout.trim());
      }
    });
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

  mainWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
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
  try {
    startStreamServer();
  } catch (e) {
    console.error('[startup] stream server failed:', e.message);
  }
  createWindow();
});
app.on('window-all-closed', () => {});
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
app.on('before-quit', () => {
  app.isQuitting = true;
  if (streamServer) streamServer.close();
});

// ── IPC: Stream + search + resolve ──────────────────────────────────���──
ipcMain.handle('play:stream', async (event, { videoId }) => {
  const base = `http://127.0.0.1:${STREAM_PORT}/stream/${videoId}`;
  return {
    primary: base,
    fallback: base + '?format=fallback',
  };
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
