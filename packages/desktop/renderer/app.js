// ── STATE ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const audio = $('audio-player');

let API_KEY = localStorage.getItem('tl_api_key') || '';
let tab = 'search', searchResults = [], queue = [], currentIdx = -1;
let activeSearchQuery = '', searchRequestId = 0;
let isPlaying = false, shuffleOn = false, repeatMode = 'off';
let progressTimer = null;
let playlists = JSON.parse(localStorage.getItem('tl_playlists') || '[]');
let ytCache = JSON.parse(localStorage.getItem('tl_yt_cache') || '{}');
let isStreamLoading = false;
// Every playback attempt gets an ID. Async yt-dlp results and timers from older
// attempts must never be allowed to replace or skip the newly selected track.
let _playRequestId = 0;
let _pendingAdvanceTimer = null;
let _playNextIds = [];
let upcomingPreloadLimit = Math.max(0, Math.min(3, parseInt(localStorage.getItem('tl_preload_limit') || '2', 10) || 0));
let _failedTrackIds = new Set();
let currentPlaylistId = null;
let _plFilter = '';
let _fallbackUrl = null;
let _primaryUrl = null;
let _usingFallback = false;
let _dragIdx = -1; // track drag source index for reordering

// Volume tracking — keeps slider, mute state and audio element in sync
let currentVol = parseFloat(localStorage.getItem('tl_volume') || '0.8');
let isMuted = localStorage.getItem('tl_muted') === 'true';

// Likes / Liked Songs
let likedIds = new Set(JSON.parse(localStorage.getItem('tl_liked') || '[]'));
let crossfadeSec = parseFloat(localStorage.getItem('tl_crossfade') || '3');
let autoplay = localStorage.getItem('tl_autoplay') !== 'false'; // on by default
let recentlyPlayed = JSON.parse(localStorage.getItem('tl_recents') || '[]');
let recommendedTracks = [];
let _isAutoPlaying = false;

// Sleep timer
let sleepTimer = null;
let sleepTimerEnd = 0;
let sleepTimerInterval = null;

// Session persistence — save queue state on every change
function saveSession() {
  localStorage.setItem('tl_session', JSON.stringify({
    queue: queue.slice(0, 50).map(t => ({ id: t.id, title: t.title, artist: t.artist, thumb: t.thumb })),
    currentIdx: currentIdx,
    timestamp: Date.now()
  }));
}
function restoreSession() {
  try {
    const raw = localStorage.getItem('tl_session');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.queue?.length > 0 && (Date.now() - s.timestamp) < 86400000) { // Within 24h
      queue = s.queue;
      currentIdx = s.currentIdx >= 0 && s.currentIdx < queue.length ? s.currentIdx : 0;
    }
  } catch {}
}

function isLiked(id) { return likedIds.has(id); }
function toggleLike(id) {
  if (likedIds.has(id)) likedIds.delete(id);
  else likedIds.add(id);
  localStorage.setItem('tl_liked', JSON.stringify([...likedIds]));
  updateLikeButtons();
  // Update playing track like state
  if (queue[currentIdx] && queue[currentIdx].id === id) updateLikeButtons();
  syncLikedToCloud([...likedIds]);
}

function updateLikeButtons() {
  const id = queue[currentIdx]?.id;
  if (!id) return;
  const liked = likedIds.has(id);
  const icon = liked ? 'heart-fill' : 'heart';
  setIcon($('like-btn'), icon, 16);
}

function getLikedPlaylist() {
  if (!likedIds.size) return null;
  const tracks = [];
  likedIds.forEach(id => {
    const found = queue.find(t => t.id === id);
    if (found) tracks.push({ name: found.title, artist: found.artist, ytId: found.id });
  });
  return tracks.length ? { id: '__liked', name: 'Liked Songs', trackCount: tracks.length, tracks, isLiked: true } : null;
}

// ── RECOMMENDATION ENGINE ──────────────────────────────────────────────
// Pure algorithmic recommendations based on your own music library.
// Uses: artist co-occurrence, keyword-genre mapping, track similarity.
// Zero external APIs.

// ── Genre keyword mappings ──────────────────────────────────────────
const GENRE_KEYWORDS = {
  'pop': ['pop', 'britney', 'taylor swift', 'justin bieber', 'ariana grande', 'billie eilish', 'dua lipa', 'ed sheeran', 'harry styles', 'olivia rodrigo', 'bruno mars', 'katy perry', 'lady gaga', 'rihanna', 'selena gomez', 'miley cyrus', 'shawn mendes', 'camila cabello', 'charlie puth', 'bts pop', 'blackpink', 'twice pop', 'backstreet', 'nsync', 'maroon 5', 'coldplay', 'imagine dragons', 'one direction', '5 seconds'],
  'rock': ['rock', 'queen', 'led zeppelin', 'pink floyd', 'ac/dc', 'nirvana', 'metallica', 'guns n roses', 'the beatles', 'rolling stones', 'aerosmith', 'bon jovi', 'foo fighters', 'red hot chili', 'green day', 'linkin park', 'system of a down', 'slipknot', 'korn', 'rammstein', 'avenged sevenfold', 'tool', 'radiohead', 'muse', 'the strokes', 'arctic monkeys', 'pearl jam', 'soundgarden', 'alice in chains', 'blink-182', 'paramore', 'my chemical', 'fall out boy', 'panic at the disco', 'twenty one pilots'],
  'hip-hop': ['hip hop', 'hiphop', 'rap', 'kendrick lamar', 'drake', 'j cole', 'travis scott', 'kanye west', 'jay z', 'eminem', 'lil wayne', '50 cent', 'snoop dogg', 'dr dre', 'tupac', 'biggie', 'notorious b.i.g', 'nas', 'wu tang', 'outkast', 'run dmc', 'public enemy', 'tyler the creator', 'asap rocky', 'childish gambino', 'logic', 'macklemore', 'chance the rapper', 'post malone', 'lil nas x', 'cardi b', 'nicki minaj', 'megan thee stallion'],
  'r&b': ['rnb', 'r&b', 'soul', 'stevie wonder', 'marvin gaye', 'aretha franklin', 'ray charles', 'james brown', 'whitney houston', 'beyonce', 'usher', 'r kelly', 'alicia keys', 'john legend', 'the weeknd', 'frank ocean', 'daniel caesar', 'sza', 'h.e.r', 'summer walker', 'jhené aiko', 'brent faiyaz', 'silk sonic', 'boyz ii men', 'tlc', 'destinys child', 'michael jackson', 'prince', 'luther vandross'],
  'electronic': ['electronic', 'edm', 'dance', 'techno', 'house', 'trance', 'dubstep', 'drum and bass', 'drum & bass', 'ambient', 'chillstep', 'future bass', 'deep house', 'progressive house', 'david guetta', 'calvin harris', 'avicii', 'tiesto', 'martin garrix', 'skrillex', 'deadmau5', 'daft punk', 'the chemical brothers', 'fatboy slim', 'kygo', 'marshmello', 'the chainsmokers', 'zeds dead', 'flume', 'odeza', 'illenium', 'porter robinson', 'madeon', 'aphex twin', 'boards of canada'],
  'jazz': ['jazz', 'miles davis', 'john coltrane', 'charlie parker', 'duke ellington', 'louis armstrong', 'ella fitzgerald', 'billie holiday', 'nina simone', 'frank sinatra', 'chet baker', 'dizzy gillespie', 'thelonious monk', 'count basie', 'herbie hancock', 'chick corea', 'john mclaughlin', 'pat metheny'],
  'classical': ['classical', 'beethoven', 'mozart', 'bach', 'chopin', 'tchaikovsky', 'vivaldi', 'schubert', 'brahms', 'wagner', 'haydn', 'handel', 'debussy', 'ravel', 'stravinsky', 'liszt', 'orchestra', 'symphony', 'sonata', 'concerto', 'ludovico einaudi', 'yiruma', 'max richter', 'olafur arnalds', 'philip glass', 'steve reich'],
  'indie': ['indie', 'vampire weekend', 'arcade fire', 'modest mouse', 'the xx', 'alt-j', 'tame impala', 'beach house', 'phoebe bridgers', 'mitski', 'clairo', 'rex orange county', 'steve lacy', 'mac demarco', 'king krule', 'dijon', 'yves tumor', 'car seat headrest', 'neutral milk hotel', 'sufjan stevens', 'bon iver', 'james blake', 'fleet foxes', 'the national', 'the neighborhood', 'glass animals', 'two door cinema', 'foster the people', 'mgmt'],
  'metal': ['metal', 'heavy metal', 'death metal', 'black metal', 'thrash metal', 'iron maiden', 'black sabbath', 'motorhead', 'judas priest', 'megadeth', 'slayer', 'pantera', 'lamb of god', 'opeth', 'gojira', 'mastodon', 'tool', 'meshuggah', 'disturbed', 'five finger death', 'avatar', 'behemoth', 'arch enemy', 'in flames', 'children of bodom', 'nightwish', 'epica', 'sabaton', 'powerwolf'],
  'folk': ['folk', 'bob dylan', 'joni mitchell', 'simon & garfunkel', 'cat stevens', 'leonard cohen', 'johnny cash', 'willie nelson', 'townes van zandt', 'nick drake', 'elliott smith', 'iron & wine', 'the lumineers', 'mumford & sons', 'hozier', 'gregory alan isakov', 'lord huron', 'caamp', 'the head and the heart', 'bon iver folk', 'first aid kit'],
  'blues': ['blues', 'bb king', 'muddy waters', 'howlin wolf', 'john lee hooker', 'robert johnson', 'sonny boy williamson', 'taj mahal blues', 'buddy guy', 'stevie ray vaughan', 'john mayer blues', 'gary clark jr', 'joe bonamassa', 'albert king', 'freddie king', 'otis rush', 'keb mo'],
  'latin': ['latin', 'reggaeton', 'salsa', 'bossa nova', 'bad bunny', 'j balvin', 'ozuna', 'rosalia', 'shakira', 'enrique iglesias', 'latin pop', 'daddy yankee', 'karol g', 'anuel aa', 'maluma', 'latin trap', 'bachata', 'merengue', 'cumbia', 'samba'],
  'country': ['country', 'johnny cash country', 'dolly parton', 'willie nelson country', 'hank williams', 'patsy cline', 'john denver', 'merle haggard', 'waylon jennings', 'george strait', 'garth brooks', 'shania twain', 'tim mcgraw', 'faith hill', 'keith urban', 'luke bryan', 'blake shelton', 'chris stapleton', 'maren morris', 'kacey musgraves', 'luke combs', 'morgan wallen', 'zach bryan'],
  'k-pop': ['kpop', 'k-pop', 'bts', 'blackpink', 'twice', 'exo', 'red velvet', 'nct', 'stray kids', 'aespa', 'itzy', 'seventeen', 'enhypen', 'txt', 'ive', 'le sserafim', 'newjeans', 'bigbang', 'super junior', 'shinee', 'girls generation', 'snsd', 'psy kpop', 'mamamoo', 'g idle', 'dreamcatcher'],
  'j-pop': ['jpop', 'j-pop', 'anime', 'j-rock', 'japanese', 'city pop', 'kenshi yonezu', 'yoasobi', 'lisajpop', 'ado song', 'official hige', 'king gnu', 'radwimps', 'one ok rock', 'babymetal'],
  'lo-fi': ['lofi', 'lo-fi', 'chill beats', 'lofi hip hop', 'lofi beats', 'chillhop', 'jazzhop', 'study music', 'relaxing', 'calm music', 'lofi songs', 'sleep', 'chill lofi', 'lofi girl'],
};

function inferGenre(artist, title) {
  const combined = ((artist || '') + ' ' + (title || '')).toLowerCase();
  const scores = {};
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) {
        score += kw.length > 5 ? 3 : 1;
      }
    }
    if (score > 0) scores[genre] = score;
  }
  return scores;
}

function getTopGenres(scores, count = 3) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(e => e[0]);
}

// ── Track similarity (bag-of-words from titles) ──────────────────
function tokenizeTrack(t) {
  const text = ((t.title || '') + ' ' + (t.artist || '')).toLowerCase();
  return new Set(text.split(/[^a-z0-9]+/).filter(w => w.length > 2));
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]);
  return intersection / union.size;
}

// ── Build artist similarity matrix from co-occurrence ──────────
function buildArtistGraph() {
  // artist -> { genreScores, trackTokens[], coArtists: {artistName: count} }
  const graph = {};

  playlists.forEach(pl => {
    // Within each playlist, every pair of artists co-occurs
    const artistsInPlaylist = [...new Set(pl.tracks.map(t => t.artist?.toLowerCase().trim()).filter(Boolean))];

    artistsInPlaylist.forEach(a1 => {
      if (!graph[a1]) graph[a1] = { genreScores: {}, coArtists: {}, tokens: [], totalPlays: 0, sampleArtist: pl.tracks.find(t => t.artist?.toLowerCase().trim() === a1)?.artist || a1 };
      artistsInPlaylist.forEach(a2 => {
        if (a1 !== a2) {
          graph[a1].coArtists[a2] = (graph[a1].coArtists[a2] || 0) + 1;
        }
      });
    });
  });

  // Also add tracks from each artist for token similarity
  playlists.forEach(pl => {
    pl.tracks.forEach(t => {
      const a = t.artist?.toLowerCase().trim();
      if (!a || !graph[a]) return;
      // Build genre profile from all tracks
      const g = inferGenre(t.artist, t.name);
      for (const [genre, score] of Object.entries(g)) {
        graph[a].genreScores[genre] = (graph[a].genreScores[genre] || 0) + score;
      }
      graph[a].totalPlays = (graph[a].totalPlays || 0) + 1;
    });
  });

  // Add weight from recently played
  recentlyPlayed.slice(0, 30).forEach(r => {
    const a = r.artist?.toLowerCase().trim();
    if (a && graph[a]) graph[a].totalPlays += 3;
  });
  likedIds.forEach(id => {
    const found = recentlyPlayed.find(r => r.id === id);
    if (found) {
      const a = found.artist?.toLowerCase().trim();
      if (a && graph[a]) graph[a].totalPlays += 5;
    }
  });

  return graph;
}

function findSimilarArtists(graph, sourceArtist, maxCount = 5) {
  const source = sourceArtist?.toLowerCase().trim();
  if (!source || !graph[source]) return [];

  const scores = {};
  const sourceGenreKeys = Object.keys(graph[source].genreScores).sort();

  for (const [artist, data] of Object.entries(graph)) {
    if (artist === source) continue;
    let score = 0;

    // 1. Co-occurrence score (how often they appear together)
    const coScore = data.coArtists[source] || graph[source].coArtists[artist] || 0;
    score += coScore * 4;

    // 2. Genre similarity
    const targetGenres = Object.keys(data.genreScores);
    const genreOverlap = sourceGenreKeys.filter(g => targetGenres.includes(g)).length;
    const genreScore = sourceGenreKeys.length > 0 ? genreOverlap / Math.max(sourceGenreKeys.length, 1) : 0;
    score += genreScore * 3;

    // 3. Popularity bonus
    const popScore = Math.min(data.totalPlays / 5, 1);
    score += popScore * 2;

    if (score > 0.5) scores[artist] = score;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(e => e[0]);
}

function buildRecommendations(maxCount = 20) {
  recommendedTracks = [];
  const seenIds = new Set(queue.map(q => q.id));
  recentlyPlayed.forEach(r => seenIds.add(r.id));

  // Step 1: Build the artist graph
  const graph = buildArtistGraph();

  // Step 2: Find seed artists (from recently played + liked)
  const seedArtists = [...new Set([
    ...recentlyPlayed.slice(0, 10).map(r => r.artist?.toLowerCase().trim()),
    ...Array.from(likedIds).map(id => {
      const found = recentlyPlayed.find(r => r.id === id);
      return found?.artist?.toLowerCase().trim();
    }).filter(Boolean),
  ])].filter(Boolean);

  // Step 3: For each seed, find similar artists and their tracks
  const similarArtistScores = {}; // artistName -> totalScore
  for (const seed of seedArtists) {
    const similar = findSimilarArtists(graph, seed, 5);
    similar.forEach((artist, idx) => {
      similarArtistScores[artist] = (similarArtistScores[artist] || 0) + (5 - idx);
    });
  }

  const topSimilar = Object.entries(similarArtistScores)
    .sort((a, b) => b[1] - a[1]);

  // Step 4: Pull tracks from similar artists
  for (const [artist, _] of topSimilar) {
    const displayName = graph[artist]?.sampleArtist || artist;
    // Find all tracks by this artist in our playlists
    const tracks = [];
    playlists.forEach(pl => {
      pl.tracks.forEach(t => {
        if (t.artist?.toLowerCase().trim() === artist && t.ytId && !seenIds.has(t.ytId)) {
          tracks.push(t);
        }
      });
    });
    // Shuffle tracks from this artist
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    for (const t of tracks) {
      if (recommendedTracks.length >= maxCount) break;
      recommendedTracks.push({
        id: t.ytId, title: t.name, artist: t.artist,
        thumb: getYtThumb(t.ytId), _source: 'similar',
        _reason: `Because you listen to ${displayName}`
      });
      seenIds.add(t.ytId);
    }
    if (recommendedTracks.length >= maxCount) break;
  }

  // Step 5: If still need more, use genre matching
  if (recommendedTracks.length < maxCount) {
    const allCached = [];
    playlists.forEach(pl => {
      pl.tracks.forEach(t => {
        if (t.ytId && !seenIds.has(t.ytId)) allCached.push({ ...t, playlistName: pl.name });
      });
    });

    // Find the dominant genre from what we already recommended
    const allArtistNames = [...seedArtists, ...topSimilar.slice(0, 3).map(e => e[0])];
    let dominantGenres = {};
    allArtistNames.forEach(a => {
      if (graph[a]) {
        for (const [g, s] of Object.entries(graph[a].genreScores)) {
          dominantGenres[g] = (dominantGenres[g] || 0) + s;
        }
      }
    });
    const topDomGenres = getTopGenres(dominantGenres, 3);

    // Score remaining tracks by genre match
    const scored = allCached.map(t => {
      const g = inferGenre(t.artist, t.name);
      let gScore = 0;
      topDomGenres.forEach(dg => { if (g[dg]) gScore += g[dg]; });
      return { ...t, gScore };
    }).filter(t => t.gScore > 0);

    scored.sort((a, b) => b.gScore - a.gScore);

    for (const t of scored) {
      if (recommendedTracks.length >= maxCount) break;
      if (!seenIds.has(t.ytId)) {
        recommendedTracks.push({
          id: t.ytId, title: t.name, artist: t.artist,
          thumb: getYtThumb(t.ytId), _source: 'genre',
        });
        seenIds.add(t.ytId);
      }
    }
  }

  // Step 6: Last resort — random tracks
  if (recommendedTracks.length < 5) {
    const remaining = [];
    playlists.forEach(pl => {
      pl.tracks.forEach(t => {
        if (t.ytId && !seenIds.has(t.ytId)) remaining.push(t);
      });
    });
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    for (const t of remaining) {
      if (recommendedTracks.length >= maxCount) break;
      recommendedTracks.push({
        id: t.ytId, title: t.name, artist: t.artist,
        thumb: getYtThumb(t.ytId), _source: 'random',
      });
    }
  }

  return recommendedTracks;
}

async function autoRecommend() {
  if (!autoplay || recommendedTracks.length > 0) return;
  if (queue.length > currentIdx + 1) return;

  buildRecommendations(10);

  if (recommendedTracks.length > 0) {
    const toQueue = recommendedTracks.slice(0, 5);
    for (const t of toQueue) {
      if (!queue.some(q => q.id === t.id)) {
        queue.push({ id: t.id, title: t.title, artist: t.artist, thumb: t.thumb, _rec: true });
      }
    }
    if (tab === 'queue') renderQueue();
  }
}

function refreshRecommendations() {
  recommendedTracks = [];
  const count = buildRecommendations(20);
  renderDiscover();
  if (count.length > 0) {
    toast(count.length + ' recommendations based on your music');
  } else {
    toast('Import some playlists first to get recommendations');
  }
}

function cancelPendingAdvance() {
  if (_pendingAdvanceTimer) {
    clearTimeout(_pendingAdvanceTimer);
    _pendingAdvanceTimer = null;
  }
}

function scheduleAdvance(delay, requestId = _playRequestId) {
  cancelPendingAdvance();
  _pendingAdvanceTimer = setTimeout(() => {
    _pendingAdvanceTimer = null;
    if (requestId === _playRequestId) nextTrack({ automatic: true });
  }, delay);
}

function showPlaybackAlert(title, message, actionLabel, action) {
  const alert = $('playback-alert');
  if (!alert) return;
  $('playback-alert-title').textContent = title;
  $('playback-alert-message').textContent = message;
  const button = $('playback-alert-action');
  button.textContent = actionLabel;
  button.onclick = action;
  alert.classList.add('visible');
}

function dismissPlaybackAlert() {
  $('playback-alert')?.classList.remove('visible');
}

function addToRecentlyPlayed(song) {
  if (!song) return;
  recentlyPlayed = recentlyPlayed.filter(r => r.id !== song.id);
  recentlyPlayed.unshift({
    id: song.id, title: song.title, artist: song.artist,
    thumb: song.thumb || getYtThumb(song.id), playedAt: Date.now(),
    playCount: (recentlyPlayed.find(r => r.id === song.id)?.playCount || 0) + 1
  });
  if (recentlyPlayed.length > 200) recentlyPlayed = recentlyPlayed.slice(0, 200);
  localStorage.setItem('tl_recents', JSON.stringify(recentlyPlayed));
}

// Build smart recommendations from the user's own library
// ── BOOT ─��───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (API_KEY) bootApp();
  else { $('setup').classList.add('visible'); $('splash').classList.add('hidden'); }
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
});

function saveApiKey() {
  const k = $('api-key-input').value.trim();
  if (!k.startsWith('AIza')) { toast('Key should start with AIza'); return; }
  localStorage.setItem('tl_api_key', k); API_KEY = k; bootApp();
}

function bootApp() {
  $('setup').classList.remove('visible');
  $('app').classList.add('visible');
  $('splash').classList.add('hidden');
  setupMediaSession();
  restoreSession();
  $('search-input').addEventListener('input', onSearchInput);
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(window._st); doSearch(e.target.value.trim()); }
  });

  // Volume control
  const volSlider = $('vol-slider');
  audio.volume = isMuted ? 0 : currentVol;
  volSlider.value = currentVol;
  updateVolIcon();
  volSlider.addEventListener('input', () => {
    currentVol = parseFloat(volSlider.value);
    isMuted = false;
    localStorage.setItem('tl_muted', 'false');
    audio.volume = currentVol;
    localStorage.setItem('tl_volume', currentVol.toString());
    updateVolIcon();
  });
  // Click the speaker icon to toggle mute
  $('vol-icon').parentElement.classList.add('vol-clickable');
  $('vol-icon').parentElement.addEventListener('click', toggleMute);

  switchTab('home');
  renderSidebar();
  // Initialize Supabase auth (checks for existing session, shows auth if needed)
  initAuth();
  // Fallback for platforms where Chromium Media Session is unavailable.
  // Once Media Session is registered, the main process unregisters these
  // global shortcuts so a hardware button cannot execute twice.
  if (window.tuneless?.onMediaPlayPause) {
    window.tuneless.onMediaPlayPause(() => togglePlay());
    window.tuneless.onMediaNext(() => nextTrack());
    window.tuneless.onMediaPrev(() => prevTrack());
    window.tuneless.onMediaStop(() => stopFromMediaControl());
  }
}

function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('tl_muted', isMuted.toString());
  if (isMuted) {
    currentVol = audio.volume > 0 ? audio.volume : currentVol;
    audio.volume = 0;
  } else {
    audio.volume = currentVol;
  }
  updateVolIcon();
}

function adjustVolume(delta) {
  const newVol = Math.max(0, Math.min(1, currentVol + delta));
  currentVol = newVol;
  isMuted = false;
  audio.volume = currentVol;
  localStorage.setItem('tl_volume', currentVol.toString());
  localStorage.setItem('tl_muted', 'false');
  const volSlider = $('vol-slider');
  if (volSlider) volSlider.value = currentVol;
  updateVolIcon();
}

function updateVolIcon() {
  const el = $('vol-icon');
  if (isMuted || audio.volume === 0) setIcon(el, 'volume-x', 14);
  else if (audio.volume < 0.3) setIcon(el, 'volume-1', 14);
  else setIcon(el, 'volume', 14);
}

// ── AUDIO EVENTS ─────────────────────────────────────────────────────────
audio.addEventListener('play', () => {
  isPlaying = true; isStreamLoading = false; dismissPlaybackAlert();
  updatePlayButtons(); startProgress();
  // Ensure media session is active with correct state
  setupMediaSession();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  // Restore artist name — setPlayerLoading overwrites it with "Loading stream..."
  if (queue[currentIdx]) {
    updateNowPlaying(queue[currentIdx]);
    updateMediaSession(queue[currentIdx]);
  }
});
audio.addEventListener('pause', () => {
  isPlaying = false; updatePlayButtons(); stopProgress();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('ended', () => {
  console.log('Audio ended event fired, currentIdx:', currentIdx, 'queue length:', queue.length);
  isPlaying = false; stopProgress();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  const completedRequestId = _playRequestId;
  if (hasNextTrack()) {
    console.log('Auto-advancing to next track');
    scheduleAdvance(crossfadeSec > 0 ? 800 : 500, completedRequestId);
  } else if (autoplay && API_KEY) {
    console.log('Queue ended, auto-recommending');
    cancelPendingAdvance();
    _pendingAdvanceTimer = setTimeout(async () => {
      _pendingAdvanceTimer = null;
      if (completedRequestId !== _playRequestId) return;
      await autoRecommend();
      if (completedRequestId === _playRequestId && hasNextTrack()) nextTrack({ automatic: true });
    }, 1000);
  } else {
    console.log('Queue ended, no auto-advance');
  }
});
audio.addEventListener('seeking', () => {
  console.log('Audio seeking to:', audio.currentTime, 'duration:', audio.duration);
});
audio.addEventListener('seeked', () => {
  console.log('Audio seeked to:', audio.currentTime, 'duration:', audio.duration);
  publishMediaPosition();
});
audio.addEventListener('loadedmetadata', publishMediaPosition);
audio.addEventListener('timeupdate', () => {
  _hasPlayedData = true; updateTimeDisplay(); clearStallTimer();
  if (Date.now() - _lastMediaPositionUpdate >= 1000) publishMediaPosition();
});
let _stallTimer = null;
let _stallRetries = 0;
let _hasPlayedData = false; // true once this track has produced audio
function clearStallTimer() { if (_stallTimer) { clearTimeout(_stallTimer); _stallTimer = null; } }

// Seamless format fallback: switch from primary (M4A) to fallback URL
// while preserving seek position. Called on stall or decode error.
async function tryFallbackFormat() {
  if (!_fallbackUrl || _usingFallback) return false;
  console.warn('[audio] switching to fallback format');
  _usingFallback = true;
  const position = audio.currentTime || 0;
  const wasPlaying = !audio.paused;
  try {
    const fallbackUrl = new URL(_fallbackUrl);
    fallbackUrl.searchParams.set('v', Date.now().toString());
    audio.src = fallbackUrl.toString();
    if (position > 0) audio.currentTime = position;
    if (wasPlaying) await audio.play();
    toast('Switched to alternate stream');
    return true;
  } catch (e) {
    console.warn('[audio] fallback also failed:', e);
    return false;
  }
}

function startStallTimer() {
  clearStallTimer();
  const requestId = _playRequestId;
  // First load can take a while — yt-dlp has to download the complete file.
  const delay = _hasPlayedData ? 3000 : 15000;
  _stallTimer = setTimeout(async () => {
    clearStallTimer();
    if (requestId !== _playRequestId) return;
    _stallRetries++;
    console.warn('[audio] stall detected (retry ' + _stallRetries + ')');
    if (_stallRetries === 1 && await tryFallbackFormat()) {
      _stallRetries = 0;
      return;
    }
    handleTrackFailure(requestId, 'Stream stalled');
  }, delay);
}
audio.addEventListener('waiting', () => { isStreamLoading = true; updatePlayButtons(); startStallTimer(); });
audio.addEventListener('canplay', () => { _hasPlayedData = true; isStreamLoading = false; updatePlayButtons(); clearStallTimer(); _stallRetries = 0; });
audio.addEventListener('playing', () => { _hasPlayedData = true; isStreamLoading = false; updatePlayButtons(); clearStallTimer(); _stallRetries = 0; });
audio.addEventListener('error', async () => {
  // A source can emit an error after it has been replaced; only the current
  // playback attempt may decide what happens next.
  const requestId = _playRequestId;
  const errCode = audio.error ? audio.error.code : 0;
  const errMsg = audio.error?.message || 'Audio playback failed';
  console.error('Audio error:', 'code=' + errCode, 'msg=' + errMsg);
  if (!_usingFallback && _fallbackUrl && (errCode === 2 || errCode === 3 || errCode === 4)) {
    if (await tryFallbackFormat()) return;
  }
  handleTrackFailure(requestId, errMsg);
});

// ── MEDIA SESSION ────────────────────────────────────────────────────────
let _mediaSessionSetup = false;
let _lastMediaPositionUpdate = 0;
let _canPublishMediaPosition = true;
function setMediaSessionAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
    return true;
  } catch (error) {
    console.warn(`[media] ${action} control is unavailable`, error);
    return false;
  }
}

function playFromMediaControl() {
  if (audio.ended && audio.src) {
    togglePlay();
  } else if (audio.src && audio.paused) {
    audio.play().catch(error => console.warn('[media] could not resume playback', error));
  } else if (!audio.src && currentIdx >= 0 && queue.length) {
    playIndex(currentIdx, true);
  }
}

function pauseFromMediaControl() {
  if (audio.src && !audio.paused) audio.pause();
}

function stopFromMediaControl() {
  pauseFromMediaControl();
  if (audio.src) audio.currentTime = 0;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

function publishMediaPosition() {
  if (!_canPublishMediaPosition || !('mediaSession' in navigator) || !audio.src) return;
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(audio.currentTime)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(audio.currentTime, 0), duration),
      playbackRate: audio.playbackRate || 1,
    });
    _lastMediaPositionUpdate = Date.now();
  } catch (error) {
    // Position reporting is optional; metadata and controls remain available.
    _canPublishMediaPosition = false;
    console.debug('[media] could not publish position', error);
  }
}

function getMediaArtwork(song) {
  const source = song.thumb || getYtThumb(song.id);
  // The API accepts an artwork URL without guessed dimensions. Search and
  // playlist thumbnails arrive in multiple sizes, so declaring them all as
  // 480×480 can cause Windows/Chromium to reject the image.
  return source ? [{ src: source }] : [];
}

function setupMediaSession() {
  if (!('mediaSession' in navigator) || _mediaSessionSetup) return;

  // Use explicit actions, not a generic toggle: an OS "pause" must never
  // become a resume merely because another control event arrives nearby.
  const playReady = setMediaSessionAction('play', playFromMediaControl);
  const pauseReady = setMediaSessionAction('pause', pauseFromMediaControl);
  setMediaSessionAction('nexttrack', () => nextTrack());
  setMediaSessionAction('previoustrack', () => prevTrack());
  setMediaSessionAction('seekto', (event) => {
    if (Number.isFinite(event.seekTime) && Number.isFinite(audio.duration)) audio.currentTime = event.seekTime;
  });
  setMediaSessionAction('stop', stopFromMediaControl);

  _mediaSessionSetup = playReady && pauseReady;
  if (_mediaSessionSetup) window.tuneless?.mediaSessionActive?.();
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  setupMediaSession(); // ensure handlers are registered (idempotent)
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown',
      artist: normalizeArtist(song.artist) || 'Unknown artist',
      album: 'Tuneless',
      artwork: getMediaArtwork(song),
    });
  } catch (error) {
    console.warn('[media] could not publish track metadata', error);
  }
}

// ── SVG ICON HELPER ─────────────────────────────────────────────────────────
function setIcon(el, iconName, size) {
  if (!el) return;
  el.innerHTML = `<svg width="${size||18}" height="${size||18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-${iconName}"/></svg>`;
}

// ── PLAYER UI ────────────────────────────────────────────────────────────
function updatePlayButtons() {
  const btn = $('play-btn');
  const fpBtn = $('fp-play-btn');
  const plBtn = $('pl-play-btn');
  if (isStreamLoading) {
    btn.classList.add('loading');
    setIcon(btn, 'refresh', 16);
    if (fpBtn) { fpBtn.classList.add('loading'); setIcon(fpBtn, 'refresh', 28); }
    if (plBtn && !plBtn.classList.contains('loading')) { plBtn.classList.add('loading'); setIcon(plBtn, 'refresh', 20); }
  } else {
    btn.classList.remove('loading');
    const icon = isPlaying ? 'pause' : 'play';
    setIcon(btn, icon, 18);
    if (fpBtn) { fpBtn.classList.remove('loading'); setIcon(fpBtn, icon, 28); }
    if (plBtn) { plBtn.classList.remove('loading'); setIcon(plBtn, isPlaying ? 'pause' : 'play', 20); }
  }
}

function setPlayerLoading(on) {
  isStreamLoading = on; updatePlayButtons();
  if (on && queue[currentIdx]) {
    $('np-title').textContent = queue[currentIdx].title;
    $('np-artist').textContent = 'Loading stream...';
    const fpTitle = $('fp-title');
    const fpArtist = $('fp-artist');
    if (fpTitle) fpTitle.textContent = queue[currentIdx].title;
    if (fpArtist) fpArtist.textContent = 'Loading stream...';
    const creditArtist = $('fp-credit-artist');
    if (creditArtist) creditArtist.textContent = 'Loading stream...';
    $('np-current').textContent = '⋯';
    $('np-total').textContent = '⋯';
    $('np-current').classList.add('loading');
  } else if (!on && queue[currentIdx]) {
    $('np-current').classList.remove('loading');
  }
}

// ── ACCENT COLOR EXTRACTION ─────────────────────────────────────────────
// Samples dominant color from artwork thumbnail and sets --accent CSS variable.
function extractAccentColor(imgUrl) {
  if (!imgUrl) return;
  const img = new Image();
  // Don't set crossOrigin — YouTube thumbnails work without it in Electron
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 1; canvas.height = 1;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      // Desaturate slightly and darken for a tint, not a flat color
      const dr = Math.round(r * 0.6), dg = Math.round(g * 0.6), db = Math.round(b * 0.6);
      document.documentElement.style.setProperty('--accent', `rgb(${dr},${dg},${db})`);
    } catch (e) { /* CORS or other error — keep default accent */ }
  };
  img.src = imgUrl;
}

function updateNowPlaying(song) {
  if (!song) return;
  $('np-title').textContent = song.title;
  $('np-artist').textContent = normalizeArtist(song.artist) || 'Unknown';
  // Update full-screen player metadata
  const fpTitle = $('fp-title');
  const fpArtist = $('fp-artist');
  if (fpTitle) fpTitle.textContent = song.title;
  if (fpArtist) fpArtist.textContent = normalizeArtist(song.artist) || 'Unknown';
  // Update credits section in full-screen player
  const creditArtist = $('fp-credit-artist');
  const creditImg = $('fp-credit-img');
  if (creditArtist) creditArtist.textContent = normalizeArtist(song.artist) || 'Unknown';
  const thumbUrl = song.thumb || getYtThumb(song.id);
  const img = $('np-img'), fpImg = $('fp-img'), fpFallback = $('fp-fallback');
  if (thumbUrl) {
    img.onerror = function() { if (!this.dataset.fallback) { this.dataset.fallback = '1'; this.src = `https://img.youtube.com/vi/${song.id}/hqdefault.jpg`; } };
    fpImg.onerror = function() { if (!this.dataset.fallback) { this.dataset.fallback = '1'; this.src = `https://img.youtube.com/vi/${song.id}/hqdefault.jpg`; } };
    delete img.dataset.fallback;
    delete fpImg.dataset.fallback;
    img.src = thumbUrl; img.style.display = 'block';
    fpImg.src = thumbUrl; fpImg.style.display = 'block'; fpFallback.style.display = 'none';
    if (creditImg) { creditImg.src = thumbUrl; creditImg.style.display = 'block'; }
  } else {
    img.style.display = 'none'; fpImg.style.display = 'none'; fpFallback.style.display = 'flex';
    if (creditImg) creditImg.style.display = 'none';
  }
  $('player-bar').style.display = 'grid';
  updatePlayButtons();
  updateLikeButtons();
  // Extract accent color and apply gradient to full-screen player
  extractAccentColor(thumbUrl);
  // Apply gradient background to full-screen player
  const fp = $('full-player');
  const fpBg = $('fp-bg');
  if (fp && fpBg && thumbUrl) {
    fpBg.style.backgroundImage = `url("${thumbUrl}")`;
  }
}

function getYtThumb(id) { return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : ''; }

// ── SEARCH ───────────────────────────────────────────────────────────────
function onSearchInput(e) {
  const q = e.target.value.trim();
  $('search-clear').classList.toggle('visible', q.length > 0);
  clearTimeout(window._st);
  if (q.length >= 2) window._st = setTimeout(() => doSearch(q), 400);
}

$('search-clear').addEventListener('click', clearSearch);
function clearSearch() {
  $('search-input').value = ''; $('search-clear').classList.remove('visible');
  searchRequestId++;
  searchResults = []; activeSearchQuery = ''; window._lq = '';
  if (tab === 'search') renderSearch();
}

async function doSearch(q) {
  if (!q || q === window._lq) return;
  window._lq = q;
  const requestId = ++searchRequestId;
  activeSearchQuery = q;
  if (tab !== 'search') switchTab('search');
  if (!API_KEY) { renderEmpty('No API Key', 'Go to Settings and paste your YouTube Data API key'); return; }
  renderLoading();
  try {
    const results = await window.tuneless.searchYoutube(q + ' official audio', API_KEY);
    // Searches can resolve out of order. Never replace newer results with a
    // response for a query the user has already changed.
    if (requestId !== searchRequestId) return;
    searchResults = results;
    searchResults.forEach(r => { if (!r.thumb) r.thumb = getYtThumb(r.id); });
    renderSearch();
  } catch (e) {
    if (requestId !== searchRequestId) return;
    console.error('Search error:', e);
    renderEmpty('Search failed', e.message ? e.message : 'Check your API key and internet connection');
  }
}

// ── RENDER ─���────────���────────────────────────────────────────────────────
function renderLoading() {
  $('content').innerHTML = `<div class="state-msg"><div class="spinner"></div><div class="state-title" style="margin-top:8px;color:var(--text-tertiary);font-weight:400;font-size:13px">Searching...</div></div>`;
}
function renderEmpty(t, s) {
  $('content').innerHTML = `<div class="state-msg"><div class="state-icon">&#x25CB;</div><div class="state-title">${esc(t)}</div><div class="state-sub">${esc(s)}</div></div>`;
}

function renderSearch() {
  if (tab !== 'search') return;
  if (!searchResults.length) {
    $('content').innerHTML = `<section class="search-page search-empty"><header class="search-page-header"><div><div class="page-kicker">Discover</div><h1 class="page-title">Find your next track</h1><p class="page-description">Search YouTube for songs, artists, albums, or mixes.</p></div><div class="search-shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>K</kbd></div></header><div class="state-msg"><div class="state-icon">&#x2315;</div><div class="state-title">What do you want to hear?</div><div class="state-sub">Start typing above. Search results can be played now, placed next, or added to the end of your queue.</div></div></section>`;
    return;
  }
  const countLabel = `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`;
  $('content').innerHTML = `<section class="search-page"><header class="search-page-header"><div><div class="page-kicker">Search results</div><h1 class="page-title">${esc(activeSearchQuery)}</h1><p class="page-description">Play a result now or line it up without losing your place.</p></div><div class="result-count">${countLabel}</div></header><div class="search-results-heading"><span>Tracks</span><span>Actions</span></div><div class="track-list search-results">${searchResults.map((r,i) => trackHtml(r,i,'search')).join('')}</div></section>`;
}

function renderLibrary() {
  if (tab !== 'library') return;

  const likedPlaylist = getLikedPlaylist();
  const allPlaylists = likedPlaylist ? [likedPlaylist, ...playlists] : [...playlists];
  const totalTracks = allPlaylists.reduce((total, playlist) => total + (playlist.trackCount || 0), 0);
  let html = `<section class="library-page"><header class="library-header"><div><div class="page-kicker">Your collection</div><h1 class="page-title">Library</h1><p class="page-description">${allPlaylists.length ? `${allPlaylists.length} playlist${allPlaylists.length === 1 ? '' : 's'} · ${totalTracks} track${totalTracks === 1 ? '' : 's'}` : 'Create a playlist or bring your music into Tuneless.'}</p></div></header><section class="library-actions"><button class="library-action primary" type="button" onclick="createNewPlaylist()"><span class="library-action-icon">+</span><span><strong>New playlist</strong><small>Start from scratch</small></span></button><button class="library-action" type="button" onclick="$('file-input').click()"><span class="library-action-icon">⇧</span><span><strong>Import file</strong><small>CSV or JSON export</small></span></button><button class="library-action spotify" type="button" onclick="importSpotifyPlaylist()"><span class="library-action-icon">↗</span><span><strong>Import Spotify</strong><small>From a playlist URL</small></span></button><input type="file" id="file-input" accept=".csv,.json" multiple hidden></section>`;

  if (!allPlaylists.length) {
    html += `<section class="library-empty"><div class="state-icon">&#x2261;</div><h2>Start your library</h2><p>Make a playlist for songs you love, or import a CSV/JSON export to keep your collection together.</p><button class="home-now-button primary" type="button" onclick="createNewPlaylist()">Create playlist</button></section>`;
  } else {
    html += `<section class="library-playlists"><div class="library-section-heading"><span>Playlists</span><span>${allPlaylists.length}</span></div><div class="playlist-grid">`;
    allPlaylists.forEach(playlist => {
      const cached = playlist.tracks.filter(track => track.ytId).length;
      const isLiked = playlist.isLiked;
      const thumb = playlist.tracks.find(track => track.ytId)?.ytId;
      const art = isLiked
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-heart-fill"/></svg>'
        : thumb ? `<img src="${esc(getYtThumb(thumb))}" alt="" loading="lazy">` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      html += `<article class="playlist-card" onclick="renderPlaylistDetail('${playlist.id}')"><div class="playlist-card-art${isLiked ? ' liked' : ''}">${art}</div><div class="playlist-card-copy"><h2>${esc(playlist.name)}</h2><p>${playlist.trackCount} track${playlist.trackCount === 1 ? '' : 's'} · ${cached} resolved${isLiked ? ' · Auto-saved' : ''}</p></div><div class="playlist-card-actions">${isLiked ? '' : `<button class="pl-btn" type="button" onclick="event.stopPropagation();shufflePl('${playlist.id}', event)">Shuffle</button><button class="pl-btn-del" type="button" onclick="event.stopPropagation();delPl('${playlist.id}')" title="Remove playlist" aria-label="Remove ${esc(playlist.name)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><use href="#icon-x"/></svg></button>`}</div></article>`;
    });
    html += `</div></section>`;
  }
  $('content').innerHTML = html + `</section>`;
  const fileInput = $('file-input');
  if (fileInput) fileInput.addEventListener('change', function() { if (this.files?.length) handleFiles(this.files); this.value = ''; });
}

// ── PROMPT MODAL (replaces native prompt() — broken in Electron) ──
function showPrompt(options, callback) {
  const overlay = $('prompt-overlay');
  const input = $('prompt-input');
  const eyebrow = $('prompt-eyebrow');
  const titleEl = $('prompt-title');
  const description = $('prompt-description');
  const error = $('prompt-error');
  const okBtn = $('prompt-ok');
  const cancelBtn = $('prompt-cancel');
  const {
    eyebrow: eyebrowText = 'Tuneless',
    title,
    description: descriptionText = '',
    placeholder = '',
    actionLabel = 'Continue',
    inputType = 'text',
    validate = () => '',
  } = options;

  eyebrow.textContent = eyebrowText;
  titleEl.textContent = title;
  description.textContent = descriptionText;
  input.value = '';
  input.type = inputType;
  input.placeholder = placeholder;
  input.removeAttribute('aria-invalid');
  error.textContent = '';
  okBtn.textContent = actionLabel;
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  function close(confirmed, value = '') {
    overlay.style.display = 'none';
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
    overlay.removeEventListener('click', onBackdrop);
    if (confirmed) callback(value);
  }
  function onOk() {
    const value = input.value.trim();
    const message = validate(value);
    if (message) {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    close(true, value);
  }
  function onCancel() { close(false); }
  function onKey(event) {
    if (event.key === 'Enter') { event.preventDefault(); onOk(); }
    if (event.key === 'Escape') { event.preventDefault(); close(false); }
  }
  function onBackdrop(event) { if (event.target === overlay) close(false); }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onBackdrop);
}

function createNewPlaylist() {
  showPrompt({
    eyebrow: 'Your library',
    title: 'Create a playlist',
    description: 'Give this collection a name. You can add songs anytime.',
    placeholder: 'e.g. Late night drives',
    actionLabel: 'Create playlist',
    validate: name => name ? '' : 'Enter a name for your playlist.',
  }, async name => {
    const pl = { id: 'pl_'+Date.now()+'_'+Math.random().toString(36).slice(2), name, trackCount: 0, tracks: [] };
    playlists.unshift(pl); savePls(); renderLibrary(); toast('Created "' + name + '"');
    syncPlaylistToCloud(pl);
  });
}

function addCurrentToPlaylist(plId) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl || currentIdx < 0) return;
  const song = queue[currentIdx];
  if (!song) return;
  const exists = pl.tracks.find(t => t.ytId === song.id);
  if (exists) { toast('Already in playlist'); return; }
  pl.tracks.push({ name: song.title, artist: song.artist, ytId: song.id });
  pl.trackCount = pl.tracks.length;
  savePls(); toast('Added to ' + pl.name);
}

function showAddToPlaylistMenu() {
  if (!queue[currentIdx]) return;
  if (!playlists.length) { createNewPlaylist(); return; }
  // Build a select dropdown in the prompt modal
  const overlay = $('prompt-overlay');
  const input = $('prompt-input');
  const titleEl = $('prompt-title');
  const okBtn = $('prompt-ok');
  const cancelBtn = $('prompt-cancel');

  $('prompt-eyebrow').textContent = 'Your library';
  titleEl.textContent = 'Add to playlist';
  $('prompt-description').textContent = 'Choose where to save the current track.';
  $('prompt-error').textContent = '';
  okBtn.textContent = 'Add';
  // Replace the text input with a select dropdown
  input.style.display = 'none';
  let select = document.getElementById('prompt-select');
  if (!select) {
    select = document.createElement('select');
    select.id = 'prompt-select';
    select.className = 'setup-input';
    select.style.cssText = 'width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:Inter,sans-serif;font-size:var(--fs-base);padding:11px 13px;outline:none';
    input.parentNode.insertBefore(select, input);
  }
  select.innerHTML = playlists.map((p, i) => `<option value="${i}">${esc(p.name)} (${p.trackCount} tracks)</option>`).join('');
  select.style.display = 'block';

  overlay.style.display = 'flex';
  setTimeout(() => select.focus(), 50);

  function close(idx) {
    overlay.style.display = 'none';
    select.style.display = 'none';
    input.style.display = '';
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    select.removeEventListener('change', onSelect);
    if (idx >= 0 && idx < playlists.length) addCurrentToPlaylist(playlists[idx].id);
  }
  function onOk() { close(parseInt(select.value)); }
  function onCancel() { close(-1); }
  function onSelect() { close(parseInt(select.value)); }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  select.addEventListener('change', onSelect);
}

function renderQueue() {
  if (tab !== 'queue') return;
  if (!queue.length) {
    $('content').innerHTML = `<section class="queue-page"><header class="queue-page-header"><div><div class="page-kicker">Your listening session</div><h1 class="page-title">Queue</h1><p class="page-description">Keep the music moving with songs from search, playlists, and Play Next.</p></div></header><div class="state-msg queue-empty"><div class="state-icon">&#x25B6;</div><div class="state-title">Your queue is empty</div><div class="state-sub">Search for a track or start a playlist to build what plays next.</div></div></section>`;
    return;
  }

  const current = currentIdx >= 0 ? queue[currentIdx] : null;
  const priorityIds = new Set(_playNextIds);
  const priority = _playNextIds
    .map(id => queue.find(track => track.id === id))
    .filter(track => track && track !== current);
  const upcoming = queue.filter((track, index) => (shuffleOn ? index !== currentIdx : index > currentIdx) && !priorityIds.has(track.id));
  const upcomingCount = priority.length + upcoming.length;
  const shuffleLabel = shuffleOn ? 'Shuffle on' : 'In queue order';
  let html = `<section class="queue-page"><header class="queue-page-header"><div><div class="page-kicker">Your listening session</div><h1 class="page-title">Queue</h1><p class="page-description">${upcomingCount ? `${upcomingCount} track${upcomingCount === 1 ? '' : 's'} coming up` : 'Nothing else is lined up'} · ${shuffleLabel}</p></div><button class="queue-clear-button" type="button" onclick="clearUpcomingQueue()">Clear upcoming</button></header>`;
  if (current) html += `<section class="queue-section queue-now"><div class="queue-section-heading"><span>Now playing</span><span class="queue-section-note">Current track</span></div><div class="track-list">${trackHtml(current, currentIdx, 'queue')}</div></section>`;
  if (priority.length) html += `<section class="queue-section queue-priority"><div class="queue-section-heading"><span>Playing next</span><span class="queue-section-note">${priority.length} priority ${priority.length === 1 ? 'track' : 'tracks'}</span></div><div class="track-list">${priority.map(track => trackHtml(track, queue.indexOf(track), 'queue')).join('')}</div></section>`;
  if (upcoming.length) html += `<section class="queue-section"><div class="queue-section-heading"><span>${priority.length ? 'Then' : 'Up next'}</span><span class="queue-section-note">${shuffleOn ? 'Shuffle chooses the next track' : 'Queue order'}</span></div><div class="track-list">${upcoming.map(track => trackHtml(track, queue.indexOf(track), 'queue')).join('')}</div></section>`;
  if (!upcomingCount && current) html += `<div class="queue-finish-note">This queue ends after the current track. Add more music to keep listening.</div>`;
  $('content').innerHTML = html + `</section>`;
}

function renderSettings() {
  if (tab !== 'settings') return;
  const isLoggedIn = !!currentUser;
  const initials = currentUser?.email ? currentUser.email.slice(0, 2).toUpperCase() : '';
  const displayName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '';

  $('content').innerHTML = `<div class="settings-page">
    <header class="settings-heading">
      <div class="settings-eyebrow">Tuneless</div>
      <h1 class="settings-title">Playback & settings</h1>
      <p class="settings-lede">Everything needed to keep listening, recover from YouTube errors, and manage downloaded audio.</p>
    </header>

    <section class="settings-section">
      <div class="settings-section-title">Playback health</div>
      <div class="health-grid">
        <article class="health-card" id="cookies-health-card">
          <div class="health-card-top"><span class="health-card-label">YouTube access</span><span class="status-pill warning" id="cookies-health-pill">Checking</span></div>
          <div class="health-card-value" id="cookies-status">Checking cookies…</div>
          <p class="health-card-copy">Import a current cookies.txt only if YouTube asks you to sign in or confirms you are not a bot.</p>
          <div class="health-card-actions"><button class="settings-button primary" onclick="importCookies()">Import cookies</button><button class="settings-button danger" id="cookies-remove-btn" style="display:none" onclick="removeCookies()">Remove</button></div>
        </article>
        <article class="health-card">
          <div class="health-card-top"><span class="health-card-label">Audio cache</span><span class="status-pill" id="cache-health-pill">Checking</span></div>
          <div class="health-card-value" id="cache-status">Checking downloaded audio…</div>
          <p class="health-card-copy">Completed downloads play instantly and do not require another YouTube request.</p>
          <div class="health-card-actions"><button class="settings-button" onclick="refreshPlaybackHealth()">Refresh</button><button class="settings-button danger" onclick="clearAudioCache()">Clear downloads</button></div>
        </article>
        <article class="health-card wide">
          <div class="health-card-top"><span class="health-card-label">Extractor</span><span class="status-pill" id="ytdlp-health-pill">Checking</span></div>
          <div class="health-card-value" id="ytdlp-version">Checking yt-dlp…</div>
          <p class="health-card-copy">yt-dlp downloads complete audio files locally before the player serves them. Run the health check if playback fails.</p>
          <div class="health-card-actions"><button class="settings-button" onclick="refreshPlaybackHealth()">Refresh status</button><button class="settings-button primary" onclick="runDiagnostics()">Run health check</button></div>
          <pre class="diagnostic-output" id="diag-results"></pre>
        </article>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">Audio</div>
      <div class="health-grid">
        <article class="health-card wide">
          <div class="health-card-label">Crossfade</div>
          <div class="settings-range"><span class="health-card-value" style="margin:0">${crossfadeSec}s</span><input id="crossfade-slider" type="range" min="0" max="10" step="1" value="${crossfadeSec}" aria-label="Crossfade duration"><span class="status-pill" id="crossfade-label">${crossfadeSec}s</span></div>
          <p class="health-card-copy">Controls the transition delay between tracks. Set to 0 seconds for immediate transitions.</p>
        </article>
        <article class="health-card wide">
          <div class="health-card-top"><span class="health-card-label">Up next preloading</span><span class="status-pill ${upcomingPreloadLimit ? 'good' : ''}">${upcomingPreloadLimit ? upcomingPreloadLimit + ' tracks' : 'Off'}</span></div>
          <div class="health-card-value">${upcomingPreloadLimit ? 'Preparing the next ' + upcomingPreloadLimit + ' tracks' : 'Preloading is disabled'}</div>
          <p class="health-card-copy">Downloads upcoming songs in the background after playback begins. This reduces transition time but uses network data and local storage.</p>
          <div class="health-card-actions"><button class="settings-button ${upcomingPreloadLimit === 0 ? 'primary' : ''}" onclick="setUpcomingPreloadLimit(0)">Off</button><button class="settings-button ${upcomingPreloadLimit === 1 ? 'primary' : ''}" onclick="setUpcomingPreloadLimit(1)">1 track</button><button class="settings-button ${upcomingPreloadLimit === 2 ? 'primary' : ''}" onclick="setUpcomingPreloadLimit(2)">2 tracks</button><button class="settings-button ${upcomingPreloadLimit === 3 ? 'primary' : ''}" onclick="setUpcomingPreloadLimit(3)">3 tracks</button></div>
        </article>
        <article class="health-card wide">
          <div class="health-card-label">Sleep timer</div>
          <div class="health-card-actions">${[15,30,45,60,90,120].map(m => `<button class="settings-button" onclick="setSleepTimer(${m})">${m >= 60 ? (m / 60) + 'h' : m + 'm'}</button>`).join('')}<button class="settings-button danger" onclick="cancelSleepTimer()">Turn off</button></div>
          <p class="health-card-copy" id="sleep-timer-status">No sleep timer is active.</p>
        </article>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">Search & account</div>
      <div class="health-grid">
        <article class="health-card wide">
          <div class="health-card-top"><span class="health-card-label">YouTube Data API</span><span class="status-pill ${API_KEY ? 'good' : 'warning'}">${API_KEY ? 'Configured' : 'Required'}</span></div>
          <div class="settings-field"><input type="text" id="sett-key" class="setup-input" value="${esc(API_KEY)}" placeholder="AIza…" autocomplete="off" spellcheck="false" aria-label="YouTube Data API key"><button class="settings-button primary" onclick="updateKey()">${API_KEY ? 'Update' : 'Save'}</button></div>
          <p class="health-card-copy">Required for search and resolving playlist tracks. ${API_KEY ? 'Current key: ' + esc(API_KEY.slice(0, 12)) + '…' : 'No key configured.'}</p>
        </article>
        <article class="health-card wide">
          <div class="health-card-top"><span class="health-card-label">Cloud sync</span><span class="status-pill ${isLoggedIn ? 'good' : ''}">${isLoggedIn ? 'Connected' : 'Local only'}</span></div>
          <div class="health-card-value">${isLoggedIn ? esc(displayName || currentUser.email) : 'Not signed in'}</div>
          <p class="health-card-copy">${isLoggedIn ? 'Sync status: ' + esc(syncStatus) + '.' : 'Sign in to sync playlists and likes across devices.'}</p>
          <div class="health-card-actions">${isLoggedIn ? '<button class="settings-button danger" onclick="handleAuthSignOut()">Sign out</button>' : '<button class="settings-button primary" onclick="showAuthOverlay()">Sign in / sign up</button>'}</div>
        </article>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">Keyboard shortcuts</div>
      <div class="health-card wide settings-shortcuts">
        <span><kbd class="kb">Space</kbd> Play or pause &middot; <kbd class="kb">M</kbd> Mute</span>
        <span><kbd class="kb">←</kbd> Previous &middot; <kbd class="kb">→</kbd> Next</span>
        <span><kbd class="kb">S</kbd> Shuffle &middot; <kbd class="kb">R</kbd> Repeat</span>
        <span><kbd class="kb">F</kbd> Full player &middot; <kbd class="kb">L</kbd> Like</span>
      </div>
    </section>
  </div>`;

  const cfSlider = $('crossfade-slider');
  if (cfSlider) cfSlider.addEventListener('input', () => {
    crossfadeSec = parseFloat(cfSlider.value);
    $('crossfade-label').textContent = crossfadeSec + 's';
    localStorage.setItem('tl_crossfade', crossfadeSec.toString());
  });
  updateCookiesStatus();
  refreshPlaybackHealth();
  updateSleepTimerUI();
}

function backToLibrary() {
  currentPlaylistId = null;
  _plFilter = '';
  renderLibrary();
  renderSidebar();
}

function renderPlaylistDetail(plId) {
  tab = 'library';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === 'library'));
  currentPlaylistId = plId;
  renderSidebar();
  const isLiked = plId === '__liked';
  const pl = isLiked ? getLikedPlaylist() : playlists.find(p => p.id === plId);
  if (!pl) { renderLibrary(); return; }
  const cached = pl.tracks.filter(t => t.ytId).length;
  const hasFilter = _plFilter.length > 0;
  const filtered = hasFilter
    ? pl.tracks.filter(t => t.name.toLowerCase().includes(_plFilter) || t.artist.toLowerCase().includes(_plFilter))
    : pl.tracks;

  const artTrack = pl.tracks.find(track => track.ytId);
  const art = artTrack?.ytId
    ? `<img src="${esc(getYtThumb(artTrack.ytId))}" alt="" loading="lazy">`
    : isLiked ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><use href="#icon-heart-fill"/></svg>' : '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  let html = `<section class="playlist-detail-page"><button class="playlist-back" type="button" onclick="backToLibrary()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-arrow-left"/></svg> Library</button><header class="playlist-detail-header"><div class="playlist-detail-art${isLiked ? ' liked' : ''}">${art}</div><div class="playlist-detail-copy"><div class="page-kicker">${isLiked ? 'Your saved tracks' : 'Playlist'}</div><h1>${esc(pl.name)}</h1><p id="pl-detail-meta">${pl.trackCount} track${pl.trackCount === 1 ? '' : 's'} · ${cached} resolved · ${filtered.length} shown</p></div><div class="pl-action-group"><button class="pl-play-btn" id="pl-play-btn" type="button" onclick="playPl('${plId}', event)" title="Play playlist" aria-label="Play ${esc(pl.name)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg><span>Play</span></button><button class="pl-shuffle-toggle${shuffleOn ? ' active' : ''}" id="pl-shuffle-toggle" type="button" onclick="toggleShuffleFromPlaylist('${plId}', event)" title="Toggle shuffle" aria-label="Toggle shuffle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-shuffle"/></svg></button></div></header><div class="playlist-filter-wrap"><label for="pl-filter">Filter tracks</label><input type="text" id="pl-filter" placeholder="Search ${pl.trackCount} tracks" autocomplete="off" spellcheck="false" value="${esc(_plFilter)}"></div><div class="playlist-tracks-heading"><span>Tracks</span><span>${isLiked ? 'Saved to your library' : 'Drag to reorder'}</span></div><div class="playlist-tracks" id="pl-tracks"></div></section>`;

  $('content').innerHTML = html;
  renderPlaylistTracks(pl, plId, filtered);
  const filterEl = $('pl-filter');
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      _plFilter = filterEl.value.toLowerCase();
      // Only re-render the track list, NOT the filter input — this preserves
      // keyboard focus and avoids the space-character-loss bug where the
      // entire content div was being replaced mid-keystroke.
      const newFiltered = _plFilter
        ? pl.tracks.filter(t => t.name.toLowerCase().includes(_plFilter) || t.artist.toLowerCase().includes(_plFilter))
        : pl.tracks;
      renderPlaylistTracks(pl, plId, newFiltered);
      // Update the count in the header
      const meta = $('pl-detail-meta');
      if (meta) meta.textContent = `${pl.trackCount} track${pl.trackCount === 1 ? '' : 's'} · ${cached} resolved · ${newFiltered.length} shown`;
    });
  }
}

function renderPlaylistTracks(pl, plId, filtered) {
  const el = $('pl-tracks');
  if (!el) return;
  const isLiked = plId === '__liked';
  if (!filtered.length) {
    el.innerHTML = `<div class="playlist-tracks-empty"><div class="state-icon">&#x25CB;</div><div class="state-title">${_plFilter ? 'No matching tracks' : 'No tracks yet'}</div><div class="state-sub">${_plFilter ? 'Try another title or artist.' : 'Add tracks to start this playlist.'}</div></div>`;
  } else {
    el.innerHTML = filtered.map(track => {
      const isCurrentlyPlaying = queue[currentIdx]?.id === (track.ytId || '');
      const thumb = track.ytId ? getYtThumb(track.ytId) : '';
      const realIdx = pl.tracks.indexOf(track);
      const status = isCurrentlyPlaying ? '<span class="playlist-track-status playing">Playing</span>' : track.ytId ? '<span class="playlist-track-status ready">Ready</span>' : '<span class="playlist-track-status">Will resolve</span>';
      return `<div class="playlist-track${isCurrentlyPlaying ? ' playing' : ''}" draggable="${!isLiked}" ondragstart="_dragIdx=${realIdx};this.classList.add('dragging')" ondragend="this.classList.remove('dragging')" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');reorderTrack('${plId}',_dragIdx,${realIdx})" onclick="playPlaylistTrack('${plId}', ${realIdx})"><span class="playlist-track-order">${!isLiked ? '<span class="playlist-drag-handle" title="Drag to reorder">⠿</span>' : realIdx + 1}</span><div class="track-thumb">${thumb ? `<img src="${esc(thumb)}" loading="lazy" alt="">` : ''}</div><div class="track-info"><div class="track-title">${esc(track.name)}</div><div class="track-artist">${esc(normalizeArtist(track.artist) || 'Unknown')}</div></div>${status}</div>`;
    }).join('');
  }
}

function reorderTrack(plId, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0) return;
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  // Move the track
  const [track] = pl.tracks.splice(fromIdx, 1);
  pl.tracks.splice(toIdx, 0, track);
  savePls();
  // Re-render with current filter
  const filtered = _plFilter
    ? pl.tracks.filter(t => t.name.toLowerCase().includes(_plFilter) || t.artist.toLowerCase().includes(_plFilter))
    : pl.tracks;
  renderPlaylistTracks(pl, plId, filtered);
  syncPlaylistToCloud(pl);
  toast('Track reordered');
}

async function playPlaylistTrack(plId, trackIndex) {
  const isLiked = plId === '__liked';
  const pl = isLiked ? getLikedPlaylist() : playlists.find(p => p.id === plId);
  if (!pl) return; const track = pl.tracks[trackIndex]; if (!track) return;
  let ytId = track.ytId;
  if (!ytId) { const cached = ytCache[cacheKey(track)]; if (cached) { track.ytId = cached; ytId = cached; } }
  if (!ytId) {
    toast('Resolving track...');
    try {
      ytId = await window.tuneless.resolveTrack(track.name, track.artist, API_KEY);
      if (ytId) { track.ytId = ytId; ytCache[cacheKey(track)] = ytId; saveCache(); if (!isLiked) savePls(); }
      else { toast('Could not find this track on YouTube'); return; }
    } catch (e) { toast('Resolution failed: ' + (e.message || 'Check API key/quota')); return; }
  }
  const song = { id: ytId, title: track.name, artist: track.artist, thumb: getYtThumb(ytId), duration: '' };
  const xi = queue.findIndex(q => q.id === ytId);
  currentIdx = xi >= 0 ? xi : (queue.push(song), queue.length - 1);
  await playIndex(currentIdx, true);
  renderPlaylistDetail(plId);
}

function trackHtml(r, i, ctx) {
  const playing = queue[currentIdx]?.id === r.id;
  const thumb = r.thumb || getYtThumb(r.id);
  const titleAttr = 'title' in r ? r.title : r.name;
  const isSearch = ctx === 'search';
  const queued = queue.some(track => track.id === r.id);
  const queuedNext = _playNextIds.includes(r.id);
  const status = isSearch && (playing || queued)
    ? `<span class="track-status${queuedNext ? ' next' : ''}">${playing ? 'Playing' : queuedNext ? 'Playing next' : 'In queue'}</span>`
    : '';
  const primaryAction = `<button class="pc-btn pc-btn-next${queuedNext ? ' active' : ''}" onclick="event.stopPropagation();${ctx==='queue' ? 'playNextQueue('+i+')' : 'playNextSearch('+i+')'}" title="${queuedNext ? 'Already set to play next' : queued ? 'Move to Play Next' : 'Play next'}" aria-label="${queuedNext ? 'Already set to play next' : 'Play ' + esc(titleAttr) + ' next'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg><span class="pc-btn-label">${queuedNext ? 'Next' : 'Play next'}</span></button>`;
  const secondaryAction = ctx === 'queue'
    ? `<button class="pc-btn pc-btn-remove" onclick="event.stopPropagation();removeQueueTrack(${i})" title="Remove from queue" aria-label="Remove ${esc(titleAttr)} from queue"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="pc-btn-label">Remove</span></button>`
    : `<button class="pc-btn" onclick="event.stopPropagation();addSearchToQueue(${i})" title="${queued ? 'Already in queue' : 'Add to queue'}" aria-label="Add ${esc(titleAttr)} to queue"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg><span class="pc-btn-label">Add</span></button>`;
  return `<div class="track-item${playing?' playing':''}${isSearch ? ' search-track-item' : ''}">
    <button class="track-main" type="button" onclick="${ctx==='queue' ? 'playFromQ('+i+')' : 'playSearch('+i+')'}" aria-label="Play ${esc(titleAttr)}">
      <div class="track-thumb">${thumb ? `<img src="${esc(thumb)}" loading="lazy" alt="">` : ''}</div>
      <div class="track-info">
        <div class="track-title">${esc(r.title||r.name)}${isStreamLoading && playing ? ' <span class="track-loading">Loading</span>' : ''}</div>
        <div class="track-artist">${esc(normalizeArtist(r.artist)||'')}</div>
      </div>
      ${status}
      <div class="track-dur">${r.duration||''}</div>
    </button>
    <div class="track-actions${isSearch ? ' track-actions-visible' : ''}">
      ${primaryAction}
      ${secondaryAction}
    </div>
  </div>`;
}

// Queue management
function playNextSearch(i) {
  const result = searchResults[i];
  if (!result) return;
  promoteToPlayNext(result, queue.findIndex(track => track.id === result.id));
}

function playNextQueue(i) {
  const song = queue[i];
  if (!song) return;
  promoteToPlayNext(song, i);
}

function promoteToPlayNext(source, existing) {
  if (existing === currentIdx) { toast('"' + trunc(source.title, 30) + '" is already playing'); return; }
  if (_playNextIds.includes(source.id)) { toast('"' + trunc(source.title, 30) + '" is already set to play next'); return; }

  let song;
  if (existing >= 0) {
    // A queue is a library of upcoming tracks; Play Next is a priority request.
    // Promote the existing entry instead of rejecting it or creating a duplicate.
    [song] = queue.splice(existing, 1);
    if (existing < currentIdx) currentIdx--;
  } else {
    song = { id: source.id, title: source.title, artist: source.artist, thumb: source.thumb || getYtThumb(source.id), duration: source.duration || '' };
  }

  if (currentIdx >= 0 && currentIdx < queue.length) {
    // Keep multiple Play Next selections in click order, even when shuffle is on.
    queue.splice(currentIdx + 1 + _playNextIds.length, 0, song);
  } else {
    queue.push(song);
  }
  _playNextIds.push(song.id);
  toast('"' + trunc(source.title, 30) + '" will play next');
  saveSession();
  if (!audio.paused) preloadUpcomingTracks(_playRequestId);
  if (tab === 'queue') renderQueue();
  if (tab === 'search') renderSearch();
}

function addSearchToQueue(i) {
  const result = searchResults[i];
  if (!result) return;
  if (queue.some(track => track.id === result.id)) { toast('Already in queue'); return; }
  queue.push({
    id: result.id,
    title: result.title,
    artist: result.artist,
    thumb: result.thumb || getYtThumb(result.id),
    duration: result.duration || '',
  });
  toast('Added to queue');
  saveSession();
  if (tab === 'queue') renderQueue();
  if (tab === 'search') renderSearch();
}

function removeQueueTrack(i) {
  if (i < 0 || i >= queue.length) return;
  if (i === currentIdx) { toast('The current track cannot be removed'); return; }
  const [removed] = queue.splice(i, 1);
  if (i < currentIdx) currentIdx--;
  _playNextIds = _playNextIds.filter(id => id !== removed.id);
  _failedTrackIds.delete(removed.id);
  toast('Removed from queue');
  saveSession();
  if (tab === 'queue') renderQueue();
  if (tab === 'search') renderSearch();
}

function clearUpcomingQueue() {
  if (currentIdx < 0 || !queue[currentIdx]) { clearQ(); return; }
  const current = queue[currentIdx];
  queue = [current];
  currentIdx = 0;
  _playNextIds = [];
  _failedTrackIds = new Set(_failedTrackIds.has(current.id) ? [current.id] : []);
  trackHistory = [];
  toast('Cleared upcoming tracks');
  saveSession();
  if (tab === 'queue') renderQueue();
  if (tab === 'search') renderSearch();
}

// ── PLAY ─────────────────────────────────────────────────────────────────
async function playSearch(i) {
  const s = searchResults[i]; if (!s) return;
  const xi = queue.findIndex(q => q.id === s.id);
  currentIdx = xi >= 0 ? xi : (queue.push(s), queue.length - 1);
  await playIndex(currentIdx, true); renderSearch(); saveSession();
}
function playFromQ(i) { currentIdx = i; playIndex(i, true); renderQueue(); saveSession(); }

async function playIndex(idx, manual) {
  if (idx < 0 || idx >= queue.length) return;
  const requestId = ++_playRequestId;
  cancelPendingAdvance();
  clearStallTimer(); _stallRetries = 0; _hasPlayedData = false;
  const song = queue[idx]; if (!song) return;

  // Selecting a track explicitly gives it another chance after a transient failure.
  if (manual) _failedTrackIds.delete(song.id);
  _playNextIds = _playNextIds.filter(id => id !== song.id);

  if (audio.src) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  _fallbackUrl = null; _primaryUrl = null; _usingFallback = false;
  currentIdx = idx; updateNowPlaying(song); updateMediaSession(song); setPlayerLoading(true);
  if (tab === 'search') renderSearch();
  addToRecentlyPlayed(song);

  try {
    const urls = await window.tuneless.playStream(song.id);
    if (requestId !== _playRequestId) return;
    if (!urls?.primary) {
      handleTrackFailure(requestId, urls?.error || 'Could not get audio stream');
      return;
    }
    _primaryUrl = urls.primary;
    _fallbackUrl = urls.fallback;
    console.log('[playIndex] setting src:', _primaryUrl);
    audio.src = _primaryUrl;
    await audio.play();
    if (requestId !== _playRequestId) return;
    toast('▶ ' + trunc(song.title, 50));
    preloadUpcomingTracks(requestId);
  } catch (e) {
    if (requestId !== _playRequestId) return;
    if (e.name === 'NotAllowedError') { setPlayerLoading(false); toast('Click play to start'); }
    else handleTrackFailure(requestId, e.message || 'Failed to play');
  } finally {
    if (requestId === _playRequestId) saveSession();
  }
}

function handleTrackFailure(requestId, message) {
  if (requestId !== _playRequestId || !queue[currentIdx]) return;
  const song = queue[currentIdx];
  _fallbackUrl = null; _primaryUrl = null; _usingFallback = false;
  setPlayerLoading(false);
  console.error('[player] track failed:', song.id, message);
  const isBot = /bot-check|cookies|not a bot|sign in to confirm/i.test(message);
  if (isBot) {
    // This is an account-wide YouTube challenge, not a bad track. Do not burn
    // through the queue or mark every song as unavailable.
    showPlaybackAlert(
      'YouTube needs authentication',
      'Import your browser cookies to resume playback and cache future tracks.',
      'Import cookies',
      openCookiesSetup,
    );
    return;
  }
  _failedTrackIds.add(song.id);
  toast('Track unavailable — skipping');
  if (hasNextTrack()) scheduleAdvance(700, requestId);
}

function hasNextTrack() {
  if (_playNextIds.some(id => queue.some(track => track.id === id && !_failedTrackIds.has(id)))) return true;
  if (shuffleOn) return queue.some((track, index) => index !== currentIdx && !_failedTrackIds.has(track.id));
  return queue.slice(currentIdx + 1).some(track => !_failedTrackIds.has(track.id)) || repeatMode === 'all';
}

function setUpcomingPreloadLimit(limit) {
  upcomingPreloadLimit = Math.max(0, Math.min(3, Number(limit) || 0));
  localStorage.setItem('tl_preload_limit', upcomingPreloadLimit.toString());
  toast(upcomingPreloadLimit ? `Preloading ${upcomingPreloadLimit} upcoming track${upcomingPreloadLimit === 1 ? '' : 's'}` : 'Upcoming preloading off');
  if (!audio.paused) preloadUpcomingTracks(_playRequestId);
  if (tab === 'settings') renderSettings();
}

function preloadUpcomingTracks(requestId) {
  if (!upcomingPreloadLimit || !window.tuneless?.preloadStream || requestId !== _playRequestId) return;
  const priority = _playNextIds
    .map(id => queue.find(track => track.id === id))
    .filter(Boolean);
  const remaining = queue
    .map((track, index) => ({ track, index }))
    .filter(({ track, index }) => index !== currentIdx && !_failedTrackIds.has(track.id));
  const candidates = shuffleOn
    ? [...priority, ...remaining.sort(() => Math.random() - 0.5).map(({ track }) => track)]
    : [...priority, ...remaining.filter(({ index }) => index > currentIdx).map(({ track }) => track)];
  const ids = [...new Set(candidates.map(track => track.id))].slice(0, upcomingPreloadLimit);

  // Download one at a time. It improves the next transition without competing
  // with foreground playback or creating a burst of YouTube requests.
  (async () => {
    for (const id of ids) {
      if (requestId !== _playRequestId) return;
      const result = await window.tuneless.preloadStream(id);
      if (!result?.ok) console.warn('[preload] unavailable:', id, result?.error);
    }
  })();
}

function togglePlay() {
  // Reset stuck loading state — allows Bluetooth to always work
  if (isStreamLoading && !audio.paused) { isStreamLoading = false; }

  if (audio.ended && audio.src) {
    // Song ended — restart it (or go next based on repeat mode)
    if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); }
    else if (currentIdx + 1 < queue.length || repeatMode === 'all') nextTrack();
    else { audio.currentTime = 0; audio.play(); }
  } else if (audio.src && !audio.paused) {
    // Currently playing → pause
    audio.pause();
  } else if (audio.src && audio.paused) {
    // Currently paused → play
    audio.play();
  } else if (currentIdx >= 0 && queue.length > 0) {
    // No audio loaded → start playing current track
    playIndex(currentIdx, true);
  }
}

// Track history for proper previous navigation
let trackHistory = [];

function nextTrack({ automatic = false } = {}) {
  if (!queue.length) return;
  cancelPendingAdvance();

  // Play Next is a user promise: it always wins over shuffle.
  let next = -1;
  while (_playNextIds.length && next < 0) {
    const id = _playNextIds.shift();
    const index = queue.findIndex(track => track.id === id);
    if (index >= 0 && !_failedTrackIds.has(id)) next = index;
  }

  if (next < 0 && shuffleOn) {
    const candidates = queue
      .map((track, index) => ({ track, index }))
      .filter(({ track, index }) => index !== currentIdx && !_failedTrackIds.has(track.id));
    if (!candidates.length) return;
    next = candidates[Math.floor(Math.random() * candidates.length)].index;
  }

  if (next < 0) {
    for (let index = currentIdx + 1; index < queue.length; index++) {
      if (!_failedTrackIds.has(queue[index].id)) { next = index; break; }
    }
    if (next < 0 && repeatMode === 'all') {
      next = queue.findIndex(track => !_failedTrackIds.has(track.id));
    }
  }

  if (next >= 0) {
    if (currentIdx >= 0 && currentIdx !== next) {
      trackHistory.push(currentIdx);
      if (trackHistory.length > 50) trackHistory.shift();
    }
    playIndex(next, !automatic);
    if (tab === 'queue') renderQueue();
  }
}

function prevTrack() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }

  // Check if we have previous tracks in history
  if (trackHistory.length > 0) {
    // Go to the most recent track from history
    const prevIdx = trackHistory.pop();
    if (prevIdx >= 0 && prevIdx < queue.length) {
      playIndex(prevIdx, true);
      if (tab === 'queue') renderQueue();
      return;
    }
  }

  // Fallback to normal previous behavior
  let prev = currentIdx - 1;
  if (prev < 0) { if (repeatMode === 'all') prev = queue.length - 1; else return; }
  playIndex(prev, true);
  if (tab === 'queue') renderQueue();
}


function toggleShuffle() {
  shuffleOn = !shuffleOn;
  updateShuffleUI();
  toast(shuffleOn ? 'Shuffle on' : 'Shuffle off');
}

function updateShuffleUI() {
  // Now-playing bar and full-screen player shuffle buttons
  ['fp-shuffle', 'fp-shuffle-btn'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('active', shuffleOn);
  });
  // Playlist header shuffle toggle
  const plToggle = $('pl-shuffle-toggle');
  if (plToggle) plToggle.classList.toggle('active', shuffleOn);
}

function toggleRepeat() {
  const modes = ['off', 'all', 'one'];
  const next = (modes.indexOf(repeatMode) + 1) % modes.length;
  repeatMode = modes[next];
  const labels = { off: '→', all: '\u{1F501}', one: '\u{1F502}' };
  // Update both now-playing bar and full-screen player repeat buttons
  ['fp-repeat', 'fp-repeat-btn'].forEach(id => {
    const el = $(id);
    if (el) { el.textContent = labels[repeatMode]; el.classList.toggle('active', repeatMode !== 'off'); }
  });
  toast('Repeat: ' + repeatMode);
}

function seekTo(e) {
  console.log('seekTo called, audio duration:', audio.duration, 'currentTime:', audio.currentTime);
  const rect = e.currentTarget.getBoundingClientRect();
  if (audio.duration) {
    const newTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    console.log('Setting currentTime to:', newTime);
    audio.currentTime = newTime;
  }
}
function fpSeek(e) { const rect = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration; }

function clearQ() {
  ++_playRequestId; cancelPendingAdvance();
  queue = []; currentIdx = -1; audio.pause(); audio.removeAttribute('src'); audio.load();
  _fallbackUrl = null; _primaryUrl = null; _usingFallback = false;
  trackHistory = []; _playNextIds = []; _failedTrackIds.clear();
  $('progress-fill').style.width = '0%';
  $('player-bar').style.display = 'none'; if (tab === 'queue') renderQueue(); closeFullPlayer();
  saveSession();
}

// ── FULL SCREEN PLAYER ───────────────────────────────────────────────────
function openFullPlayer() { $('full-player').classList.add('visible'); updateFullPlayerQueue(); }
function closeFullPlayer() {
  $('full-player').classList.remove('visible');
  if ($('fp-queue')?.classList.contains('visible')) $('fp-queue').classList.remove('visible');
}
function toggleFullPlayer() { if ($('full-player').classList.contains('visible')) closeFullPlayer(); else openFullPlayer(); }
function fpToggleQueue() {
  const q = $('fp-queue'); q.classList.toggle('visible');
  if (q.classList.contains('visible')) updateFullPlayerQueue();
}

function updateFullPlayerQueue() {
  if (!queue.length) { $('fp-q-count').textContent = ''; $('fp-queue-list').innerHTML = ''; return; }
  const current = currentIdx >= 0 ? queue[currentIdx] : null;
  const priorityIds = new Set(_playNextIds);
  const priority = _playNextIds.map(id => queue.find(track => track.id === id)).filter(track => track && track !== current);
  const upcoming = queue.filter((track, index) => (shuffleOn ? index !== currentIdx : index > currentIdx) && !priorityIds.has(track.id));
  const item = (track, className = '') => {
    const index = queue.indexOf(track);
    const thumb = track.thumb || getYtThumb(track.id);
    return `<div class="fp-queue-item${index === currentIdx ? ' playing' : ''}${className ? ' ' + className : ''}" onclick="closeFullPlayer();playFromQ(${index})"><div class="fp-qi-thumb">${thumb ? `<img src="${esc(thumb)}" loading="lazy" alt="">` : ''}</div><div class="fp-qi-info"><div class="fp-qi-title">${esc(track.title || track.name)}</div><div class="fp-qi-artist">${esc(normalizeArtist(track.artist) || '')}</div></div></div>`;
  };
  const count = priority.length + upcoming.length;
  $('fp-q-count').textContent = count ? `${count} coming up` : 'Queue ends here';
  let html = current ? `<div class="fp-queue-label">Now playing</div>${item(current)}` : '';
  if (priority.length) html += `<div class="fp-queue-label">Playing next</div>${priority.map(track => item(track, 'priority')).join('')}`;
  if (upcoming.length) html += `<div class="fp-queue-label">${priority.length ? 'Then' : 'Up next'}</div>${upcoming.map(track => item(track)).join('')}`;
  $('fp-queue-list').innerHTML = html;
}

// ── PROGRESS ─────────────────────────────────────────────────────────────
function startProgress() { stopProgress(); progressTimer = setInterval(updateTimeDisplay, 500); }
function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

function updateTimeDisplay() {
  if (audio.duration && isFinite(audio.duration)) {
    const c = audio.currentTime, d = audio.duration;
    const pct = (c / d * 100);
    $('progress-fill').style.width = pct + '%';
    const fpFill = $('fp-progress-fill');
    if (fpFill) fpFill.style.width = pct + '%';
    const cur = fmt(c), tot = fmt(d);
    $('np-current').textContent = cur; $('np-total').textContent = tot;
    const fpCur = $('fp-current'), fpTot = $('fp-total');
    if (fpCur) fpCur.textContent = cur;
    if (fpTot) fpTot.textContent = tot;
  }
}
function fmt(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }

// ── PLAY / SHUFFLE PLAYLIST ────────────────────────────────────────────
async function playPl(plId, evt) {
  const isLiked = plId === '__liked';
  const pl = isLiked ? getLikedPlaylist() : playlists.find(p => p.id === plId);
  if (!pl?.tracks.length) { toast('No tracks in playlist'); return; }
  const btn = evt?.target?.closest('.pl-play-btn') || $('pl-play-btn');
  if (btn) { btn.classList.add('loading'); setIcon(btn, 'refresh', 20); }

  // Separate cached and uncached tracks
  const tracks = [];
  for (const t of pl.tracks) {
    if (t.ytId) { tracks.push(t); continue; }
    const c = ytCache[cacheKey(t)]; if (c) { t.ytId = c; tracks.push(t); continue; }
    tracks.push(t); // uncached, will resolve during playback
  }

  // Shuffle if enabled (Fisher-Yates)
  if (shuffleOn) {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
  }

  // Build queue
  queue = [];
  for (const t of tracks) {
    if (t.ytId) queue.push({ id: t.ytId, title: t.name, artist: t.artist, thumb: getYtThumb(t.ytId || ''), duration: '' });
  }

  // If nothing is cached, resolve the first track immediately
  if (!queue.length && tracks.length > 0) {
    toast('Resolving tracks...');
    try {
      const id = await window.tuneless.resolveTrack(tracks[0].name, tracks[0].artist, API_KEY);
      if (id) { tracks[0].ytId = id; ytCache[cacheKey(tracks[0])] = id; queue.push({ id, title: tracks[0].name, artist: tracks[0].artist, thumb: getYtThumb(id), duration: '' }); }
    } catch (e) { console.error('[playPl] resolve failed:', e); }
  }

  // Play first track
  currentIdx = -1;
  if (queue.length > 0) {
    await playIndex(0, true);
    toast(`▶ Playing ${pl.name}${shuffleOn ? ' (shuffled)' : ''}`);
  } else {
    toast('Could not resolve any tracks. Check your API key.');
  }

  // Background resolve remaining uncached tracks
  const uncachedRemaining = tracks.slice(queue.length > 0 ? 1 : 0).filter(t => !t.ytId);
  if (uncachedRemaining.length > 0) {
    let resolvedCount = 0;
    for (const t of uncachedRemaining) {
      try {
        const id = await window.tuneless.resolveTrack(t.name, t.artist, API_KEY);
        if (id) { t.ytId = id; ytCache[cacheKey(t)] = id; queue.push({ id, title: t.name, artist: t.artist, thumb: getYtThumb(id), duration: '' }); resolvedCount++; }
      } catch {}
    }
    saveCache(); savePls();
    if (resolvedCount > 0) toast(`+${resolvedCount} tracks cached`);
  }
  if (btn) {
    btn.classList.remove('loading');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg><span>Play</span>`;
  }
}

async function shufflePl(plId, evt) {
  const isLiked = plId === '__liked';
  const pl = isLiked ? getLikedPlaylist() : playlists.find(p => p.id === plId);
  if (!pl?.tracks.length) { toast('No tracks in playlist'); return; }
  const btn = evt?.target?.closest('.pl-shuffle-toggle') || evt?.target?.closest('.pl-btn') || null;
  if (btn) btn.disabled = true;

  // Separate cached (ytId present) and uncached tracks
  const cached = [], uncached = [];
  for (const t of pl.tracks) {
    if (t.ytId) { cached.push(t); continue; }
    const c = ytCache[cacheKey(t)]; if (c) { t.ytId = c; cached.push(t); continue; }
    uncached.push(t);
  }

  // Shuffle the cached tracks
  for (let i = cached.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cached[i], cached[j]] = [cached[j], cached[i]];
  }

  // Build queue: all cached first, then resolve uncached one-by-one
  queue = [];
  cached.forEach(t => { queue.push({ id: t.ytId, title: t.name, artist: t.artist, thumb: getYtThumb(t.ytId || ''), duration: '' }); });

  // If no cached tracks, resolve the first uncached track immediately so we can play
  if (!queue.length && uncached.length > 0) {
    toast('Resolving tracks...');
    try {
      const id = await window.tuneless.resolveTrack(uncached[0].name, uncached[0].artist, API_KEY);
      if (id) { uncached[0].ytId = id; ytCache[cacheKey(uncached[0])] = id; queue.push({ id, title: uncached[0].name, artist: uncached[0].artist, thumb: getYtThumb(id), duration: '' }); }
    } catch (e) { console.error('[shufflePl] resolve failed:', e); }
  }

  // Play first track
  currentIdx = -1;
  if (queue.length > 0) {
    await playIndex(0);
    toast(`▶ Playing ${pl.name} · ${queue.length} tracks`);
  } else {
    toast('Could not resolve any tracks. Check your API key.');
  }

  // Background resolve remaining uncached tracks (skip the one we already resolved)
  const remaining = uncached.slice(queue.length > 0 ? 1 : 0);
  if (remaining.length > 0) {
    let resolvedCount = 0;
    for (const t of remaining) {
      try {
        const id = await window.tuneless.resolveTrack(t.name, t.artist, API_KEY);
        if (id) { t.ytId = id; ytCache[cacheKey(t)] = id; queue.push({ id, title: t.name, artist: t.artist, thumb: getYtThumb(id), duration: '' }); resolvedCount++; }
      } catch {}
      if (resolvedCount > 0 && resolvedCount % 3 === 0) toast(`Resolved ${resolvedCount}/${remaining.length} remaining...`);
    }
    saveCache(); savePls();
    if (resolvedCount > 0) toast(`+${resolvedCount} tracks cached`);
  }
  if (btn) btn.disabled = false;
}

function toggleShuffleFromPlaylist(plId, evt) {
  // Just toggle state — do NOT restart playback
  shuffleOn = !shuffleOn;
  updateShuffleUI();
  toast(shuffleOn ? '🔀 Shuffle on — next tracks will be random' : 'Shuffle off — playing in order');
}

function delPl(id) {
  playlists = playlists.filter(p => p.id !== id); savePls(); renderLibrary(); toast('Removed');
  syncPlaylistDeleteToCloud(id);
}

// ── FILE HANDLER ─────────────────────────────────────────────────────────
// ── SPOTIFY IMPORT ──────────────────────────────────────────────────────
async function importSpotifyPlaylist() {
  showPrompt({
    eyebrow: 'Import music',
    title: 'Import a Spotify playlist',
    description: 'Paste a public Spotify playlist URL. Your tracks will be added to your local library.',
    placeholder: 'https://open.spotify.com/playlist/...',
    actionLabel: 'Import playlist',
    inputType: 'url',
    validate: url => url.includes('spotify.com/playlist/') ? '' : 'Enter a valid Spotify playlist URL.',
  }, async url => {
    // Try to use stored credentials, or ask for them
    let clientId = localStorage.getItem('tl_spotify_client_id') || '';
    let clientSecret = localStorage.getItem('tl_spotify_client_secret') || '';

    if (!clientId || !clientSecret) {
      // Use the app's built-in credentials (for basic import)
      // These are limited but work for public playlists
      clientId = '7a09d7e8b0954e4a92e7b4e0f8c3d2a1'; // placeholder
      clientSecret = 'f5e4d3c2b1a09876543210fedcba9876'; // placeholder
      // If these don't work, show error asking user to configure
      toast('Importing from Spotify...');
    }

    try {
      if (!window.tuneless?.importSpotifyPlaylist) {
        toast('Spotify import not available');
        return;
      }
      const result = await window.tuneless.importSpotifyPlaylist(clientId, clientSecret, url);
      if (result.error) {
        toast('Import failed: ' + result.error);
        return;
      }
      if (!result.tracks?.length) {
        toast('No tracks found in this playlist');
        return;
      }
      // Create the playlist
      const pl = {
        id: 'spotify_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        name: result.name || 'Imported from Spotify',
        trackCount: result.tracks.length,
        tracks: result.tracks,
      };
      playlists.unshift(pl);
      savePls();
      renderLibrary();
      toast(`Imported "${pl.name}" (${pl.tracks.length} tracks)`);
    } catch (e) {
      toast('Import error: ' + e.message);
    }
  });
}

function handleFiles(files) {
  if (!files?.length) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        if (file.name.toLowerCase().endsWith('.csv')) {
          const tracks = parseCSV(e.target.result);
          const name = file.name.replace(/\.csv$/i,'').replace(/[_-]/g,' ');
          playlists.unshift({ id:'csv_'+Date.now()+'_'+Math.random().toString(36).slice(2), name, trackCount: tracks.length, tracks });
          toast(`Imported "${name}" (${tracks.length} tracks)`);
        } else { toast('Only CSV files are supported'); }
        savePls(); if (tab === 'library') renderLibrary();
      } catch (err) { toast('Error: ' + err.message); }
    };
    reader.readAsText(file);
  });
}

// ── CSV PARSER ───────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV has no tracks');
  const h = splitCSVLine(lines[0]).map(s => s.toLowerCase().trim().replace(/"/g,''));
  const tc = findCol(h, ['track name','name','title','song']);
  const ac = findCol(h, ['artist name(s)','artist names','artist name','artists','artist']);
  if (tc === -1) throw new Error('Could not find Track Name column');
  const tracks = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (!cols.length) continue;
    const n = (cols[tc]||'').trim().replace(/^"|"$/g,'');
    const a = ac >= 0 ? (cols[ac]||'').trim().replace(/^"|"$/g,'').replace(/;\s*/g, ', ') : '';
    if (!n) continue;
    tracks.push({ name: n, artist: a, ytId: null });
  }
  return tracks;
}
function findCol(h, cs) { for (const c of cs) { const i = h.indexOf(c); if (i !== -1) return i; } return -1; }
function splitCSVLine(l) { const r = []; let c='',q=false; for (let i=0;i<l.length;i++) { const ch=l[i]; if (ch==='"'&&l[i+1]==='"') { c+='"'; i++; } else if (ch==='"') q=!q; else if (ch===','&&!q) { r.push(c); c=''; } else c+=ch; } r.push(c); return r; }

// ── DISCOVER / RECOMMENDATIONS ──────────────────────────────────────────
function renderDiscover() {
  if (tab !== 'discover') return;
  let html = `<div class="section-header"><span class="section-title">Discover</span></div><div class="library-content">`;

  // Autoplay toggle
  html += `<div class="import-zone" onclick="autoplay=!autoplay;localStorage.setItem('tl_autoplay',autoplay);renderDiscover()" style="padding:12px 16px;flex-direction:row;margin-bottom:12px;border-style:solid">
    <div style="flex:1">
      <div class="import-label" style="font-size:12px">Autoplay recommendations</div>
      <div class="import-sub">When your queue ends, find similar songs</div>
    </div>
    <div style="width:36px;height:20px;border-radius:10px;background:${autoplay?'var(--text)':'var(--surface-3)'};transition:all 0.2s;position:relative">
      <div style="width:16px;height:16px;border-radius:50%;background:${autoplay?'var(--bg)':'var(--text-quaternary)'};position:absolute;top:2px;${autoplay?'right:2px':'left:2px'};transition:all 0.2s"></div>
    </div>
  </div>`;

  // Recommendation info
  html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;margin-bottom:8px;font-size:11px">
    <span style="color:var(--text-quaternary)">Powered by similarity analysis of ${playlists.length} playlists</span>
  </div>`;

  // Recently played section
// Recently played section
  html += `<div class="section-header" style="padding:8px 0">
    <span class="section-title">Recently Played${recentlyPlayed.length ? ' (' + recentlyPlayed.length + ')' : ''}</span>
    ${recentlyPlayed.length > 0 ? '<button class="section-action" onclick="recentlyPlayed=[];localStorage.setItem(\'tl_recents\',\'[]\');renderDiscover()">Clear</button>' : ''}
  </div>`;

  if (recentlyPlayed.length === 0) {
    html += `<div class="state-msg" style="padding:20px"><div class="state-icon">&#x2605;</div><div class="state-title">Start listening</div><div class="state-sub">Your recently played tracks will appear here</div></div>`;
  } else {
    html += `<div class="track-list">`;
    recentlyPlayed.slice(0, 20).forEach((t, i) => {
      const isPlaying = queue[currentIdx]?.id === t.id;
      const thumb = t.thumb || getYtThumb(t.id);
      html += `<div class="track-item${isPlaying?' playing':''}" onclick="replayRecents(${i})">
        <div class="track-thumb">${thumb ? `<img src="${thumb}" loading="lazy">` : ''}</div>
        <div class="track-info">
          <div class="track-title">${esc(t.title)}</div>
          <div class="track-artist">${esc(normalizeArtist(t.artist))}</div>
        </div>
        <div style="font-size:10px;color:var(--text-quaternary)">${timeAgo(t.playedAt)}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Recommendations section
  html += `<div class="section-header" style="padding:8px 0;margin-top:12px">
    <span class="section-title">Recommended${recommendedTracks.length ? ' (' + recommendedTracks.length + ')' : ''}</span>
    <button class="section-action" onclick="refreshRecommendations()">${recommendedTracks.length ? 'Refresh' : 'Find music'}</button>
  </div>`;

  if (recommendedTracks.length === 0) {
    html += `<div class="import-zone" onclick="refreshRecommendations()" style="border-style:solid;padding:20px">
      <div class="import-label">Find recommendations</div>
      <div class="import-sub">Based on your listening history</div>
    </div>`;
  } else {
    html += `<div class="track-list">`;
    recommendedTracks.forEach((t, i) => {
      const thumb = t.thumb || getYtThumb(t.id);
      html += `<div class="track-item" onclick="playRecommended(${i})">
        <div class="track-thumb">${thumb ? `<img src="${thumb}" loading="lazy">` : ''}</div>
        <div class="track-info">
          <div class="track-title">${esc(t.title)}</div>
          <div class="track-artist">${esc(normalizeArtist(t.artist))}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="pc-btn" onclick="event.stopPropagation();addRecToQueue(${i})" title="Add to queue" style="font-size:0;width:26px;height:26px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg></button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  html += `<div style="margin-top:16px;padding:12px 0;border-top:1px solid var(--border);font-size:11px;color:var(--text-quaternary)">
    ${likedIds.size} liked &middot; ${recentlyPlayed.length} listened &middot;
    ${autoplay ? 'Autoplay on - recommendations will play when queue ends' : 'Autoplay off'}
  </div>`;

  html += `</div>`;
  $('content').innerHTML = html;
}

function replayRecents(i) {
  const t = recentlyPlayed[i]; if (!t) return;
  const xi = queue.findIndex(q => q.id === t.id);
  currentIdx = xi >= 0 ? xi : (queue.push({ id: t.id, title: t.title, artist: t.artist, thumb: t.thumb }), queue.length - 1);
  playIndex(currentIdx);
  renderDiscover();
}

function playRecommended(i) {
  const t = recommendedTracks[i]; if (!t) return;
  const xi = queue.findIndex(q => q.id === t.id);
  currentIdx = xi >= 0 ? xi : (queue.push({ id: t.id, title: t.title, artist: t.artist, thumb: t.thumb }), queue.length - 1);
  playIndex(currentIdx);
}

function addRecToQueue(i) {
  const t = recommendedTracks[i]; if (!t) return;
  if (queue.some(q => q.id === t.id)) { toast('Already in queue'); return; }
  queue.push({ id: t.id, title: t.title, artist: t.artist, thumb: t.thumb });
  toast('Added to queue');
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

// ── PERSISTENCE ──────────────────────────────────────────────────────────
function cacheKey(t) { return (t.name+'|'+t.artist).toLowerCase(); }
function savePls() { localStorage.setItem('tl_playlists', JSON.stringify(playlists)); }
function saveCache() { localStorage.setItem('tl_yt_cache', JSON.stringify(ytCache)); }
function updateKey() {
  const k = $('sett-key').value.trim();
  if (k && !k.startsWith('AIza')) { toast('Key should start with AIza'); return; }
  API_KEY = k; localStorage.setItem('tl_api_key', k);
  renderSettings(); toast(k ? 'API key saved' : 'API key removed');
}

async function saveSupabaseConfig() {
  const url = $('sett-supa-url').value.trim().replace(/\/$/, '');
  const key = $('sett-supa-key').value.trim();
  if (!url || !key) { toast('URL and anon key required'); return; }
  if (!url.includes('supabase.co')) { toast('Invalid Supabase URL'); return; }
  localStorage.setItem('tl_supabase_url', url);
  localStorage.setItem('tl_supabase_anon_key', key);
  toast('Config saved. Restart the app to apply changes.');
}

// ── DIAGNOSTICS ────────────────────────────────────────────────────────────
// ── COOKIES (YouTube bot-check bypass) ─────────────────────────────────
function setStatusPill(id, text, state = '') {
  const pill = $(id);
  if (!pill) return;
  pill.textContent = text;
  pill.className = 'status-pill' + (state ? ' ' + state : '');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / (1024 ** index)).toFixed(index ? 1 : 0) + ' ' + units[index];
}

async function updateCookiesStatus() {
  const el = $('cookies-status');
  if (!el) return;
  try {
    const s = await window.tuneless.cookiesStatus();
    if (s?.present) {
      el.textContent = 'Browser cookies active';
      setStatusPill('cookies-health-pill', 'Active', 'good');
      const btn = $('cookies-remove-btn');
      if (btn) btn.style.display = 'inline-block';
    } else {
      el.textContent = 'No browser cookies imported';
      setStatusPill('cookies-health-pill', 'Optional', 'warning');
      const btn = $('cookies-remove-btn');
      if (btn) btn.style.display = 'none';
    }
  } catch (e) {
    el.textContent = 'Cookie status unavailable';
    setStatusPill('cookies-health-pill', 'Unavailable', 'warning');
  }
}

async function refreshPlaybackHealth() {
  const cacheEl = $('cache-status');
  const versionEl = $('ytdlp-version');
  try {
    const [cache, version] = await Promise.all([
      window.tuneless.cacheStatus(),
      window.tuneless.ytdlpVersion(),
    ]);
    if (cacheEl) cacheEl.textContent = `${cache.files} ${cache.files === 1 ? 'track' : 'tracks'} · ${formatBytes(cache.bytes)}`;
    setStatusPill('cache-health-pill', cache.files ? 'Ready' : 'Empty', cache.files ? 'good' : '');
    if (versionEl) versionEl.textContent = version.startsWith('ERROR:') ? 'yt-dlp unavailable' : 'yt-dlp ' + version;
    setStatusPill('ytdlp-health-pill', version.startsWith('ERROR:') ? 'Unavailable' : 'Ready', version.startsWith('ERROR:') ? 'warning' : 'good');
  } catch (e) {
    if (cacheEl) cacheEl.textContent = 'Cache status unavailable';
    if (versionEl) versionEl.textContent = 'yt-dlp status unavailable';
    setStatusPill('cache-health-pill', 'Unavailable', 'warning');
    setStatusPill('ytdlp-health-pill', 'Unavailable', 'warning');
  }
}

async function clearAudioCache() {
  try {
    const result = await window.tuneless.cacheClear();
    if (!result?.ok) throw new Error(result?.message || 'Could not clear downloaded audio');
    toast('Downloaded audio cleared');
    refreshPlaybackHealth();
  } catch (e) {
    toast('Could not clear downloads: ' + e.message);
  }
}

async function importCookies() {
  try {
    const r = await window.tuneless.cookiesImport();
    toast(r?.ok ? r.message : (r?.message || 'Import failed'));
    if (r?.ok) dismissPlaybackAlert();
    updateCookiesStatus();
  } catch (e) {
    toast('Import failed: ' + e.message);
  }
}

async function removeCookies() {
  try {
    await window.tuneless.cookiesRemove();
    toast('Cookies removed');
    updateCookiesStatus();
  } catch (e) {
    toast('Remove failed: ' + e.message);
  }
}

function openCookiesSetup() {
  dismissPlaybackAlert();
  switchTab('settings');
  const el = $('cookies-status');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function runDiagnostics() {
  const el = $('diag-results');
  if (!el) return;
  el.classList.add('visible');
  el.textContent = 'Running playback health check…\n';
  const lines = [];
  try {
    const version = await window.tuneless.ytdlpVersion();
    lines.push(`yt-dlp: ${version}`);
    const result = await window.tuneless.ytdlpTest('dQw4w9WgXcQ');
    if (result.success) lines.push(`Extraction: passed (${formatBytes(result.bytes)} downloaded in ${result.time}s)`);
    else lines.push(`Extraction: failed — ${result.error || 'unknown error'}`);
  } catch (e) {
    lines.push(`Extractor check: failed — ${e.message}`);
  }
  try {
    // A malformed route checks that the local server responds without causing a download.
    const response = await fetch('http://127.0.0.1:18762/health', { method: 'HEAD' });
    lines.push(`Local audio server: reachable (HTTP ${response.status})`);
  } catch (e) {
    lines.push(`Local audio server: unavailable — ${e.message}`);
  }
  const audioProbe = document.createElement('audio');
  lines.push(`Audio support: MP4 ${audioProbe.canPlayType('audio/mp4') || 'no'} · WebM ${audioProbe.canPlayType('audio/webm') || 'no'}`);
  el.textContent = lines.join('\n');
  refreshPlaybackHealth();
}

// ── TABS ─────────────────────────────────────────────────────────────────
function switchTab(t) {
  tab = t;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === t));
  if (t==='home') renderHome();
  if (t==='search') renderSearch();
  if (t==='library') renderLibrary();
  if (t==='queue') renderQueue();
  if (t==='settings') renderSettings();
  if (t==='discover') renderDiscover();
  renderSidebar();
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────
function renderSidebar() {
  const el = $('sidebar-playlists');
  if (!el) return;
  let html = `<button class="sidebar-playlists-btn" onclick="createNewPlaylist()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create Playlist</span></button>`;
  // Liked Songs
  if (likedIds.size > 0) {
    html += `<div class="sidebar-pl-item${tab==='library'?' active':''}" onclick="switchTab('library')"><div class="sidebar-pl-thumb" style="background:linear-gradient(135deg,#450af5,#c4efd9)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><span>Liked Songs</span></div>`;
  }
  // Playlists
  playlists.forEach(p => {
    const thumb = p.tracks[0]?.ytId ? getYtThumb(p.tracks[0].ytId) : '';
    html += `<div class="sidebar-pl-item${currentPlaylistId===p.id?' active':''}" onclick="renderPlaylistDetail('${p.id}')"><div class="sidebar-pl-thumb">${thumb ? `<img src="${thumb}" loading="lazy">` : p.name.charAt(0).toUpperCase()}</div><span>${esc(p.name)}</span></div>`;
  });
  el.innerHTML = html;
}

// ── HOME SCREEN ──────────────────────────────────────────────────────────
function openSearch() {
  switchTab('search');
  setTimeout(() => $('search-input')?.focus(), 0);
}

function renderHome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const current = currentIdx >= 0 ? queue[currentIdx] : null;
  const jumpBack = recentlyPlayed.slice(0, 6);
  const priorityIds = new Set(_playNextIds);
  const priority = _playNextIds.map(id => queue.find(track => track.id === id)).filter(track => track && track !== current);
  const remaining = queue.filter((track, index) => (shuffleOn ? index !== currentIdx : index > currentIdx) && !priorityIds.has(track.id));
  const upNext = [...priority, ...remaining].slice(0, 5);
  let html = `<div class="home-page"><header class="home-header"><div><div class="page-kicker">Your music, your way</div><h1 class="home-title">${greeting}</h1><p class="home-subtitle">Pick up where you left off or find something new.</p></div><button class="home-search-button" type="button" onclick="openSearch()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Search music</button></header>`;

  if (current) {
    const thumb = current.thumb || getYtThumb(current.id);
    html += `<section class="home-now"><div class="home-now-art">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}</div><div class="home-now-copy"><div class="home-now-kicker">${isPlaying ? 'Now playing' : 'Paused'}</div><div class="home-now-title">${esc(current.title)}</div><div class="home-now-artist">${esc(normalizeArtist(current.artist))}</div></div><div class="home-now-actions"><button class="home-now-button primary" type="button" onclick="togglePlay()">${isPlaying ? 'Pause' : 'Play'}</button><button class="home-now-button" type="button" onclick="openFullPlayer()">Open player</button></div></section>`;
  }

  if (jumpBack.length) {
    html += `<section class="home-section"><div class="section-header"><div><div class="section-title">Jump back in</div><div class="section-description">Recent favorites and familiar tracks</div></div></div><div class="home-cards">`;
    jumpBack.forEach((track, index) => {
      const thumb = track.thumb || getYtThumb(track.id);
      html += `<div class="home-card" onclick="replayRecents(${index})">
        <div class="home-card-img"><img src="${esc(thumb)}" alt="" loading="lazy"><div class="home-card-gradient"></div>
        <button class="home-card-play" type="button" onclick="event.stopPropagation();replayRecents(${index})" aria-label="Play ${esc(track.title)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg></button></div>
        <div class="home-card-info"><div class="home-card-title">${esc(track.title)}</div><div class="home-card-sub">${esc(normalizeArtist(track.artist))}</div></div>
      </div>`;
    });
    html += `</div></section>`;
  }

  if (upNext.length) {
    html += `<section class="home-section home-queue-preview"><div class="section-header"><div><div class="section-title">Coming up</div><div class="section-description">${priority.length ? 'Your Play Next picks are protected, even in shuffle.' : shuffleOn ? 'Shuffle is choosing what comes next.' : 'In the order you added them.'}</div></div><button class="section-action" onclick="switchTab('queue')">Open queue</button></div><div class="up-next-list">`;
    upNext.forEach(track => {
      const queueIndex = queue.indexOf(track);
      const thumb = track.thumb || getYtThumb(track.id);
      const isPriority = priorityIds.has(track.id);
      html += `<button class="up-next-row" type="button" onclick="playFromQ(${queueIndex})"><div class="up-next-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}</div><div class="up-next-info"><div class="up-next-title">${esc(track.title)}</div><div class="up-next-artist">${esc(normalizeArtist(track.artist))}</div></div>${isPriority ? '<span class="up-next-status">Play next</span>' : '<span class="up-next-dot"></span>'}</button>`;
    });
    html += `</div></section>`;
  }

  if (playlists.length) {
    html += `<section class="home-section"><div class="section-header"><div><div class="section-title">Your playlists</div><div class="section-description">${playlists.length} saved playlist${playlists.length === 1 ? '' : 's'}</div></div><button class="section-action" onclick="switchTab('library')">View library</button></div><div class="home-cards">`;
    playlists.slice(0, 6).forEach(playlist => {
      const thumb = playlist.tracks[0]?.ytId ? getYtThumb(playlist.tracks[0].ytId) : '';
      html += `<div class="home-card" onclick="renderPlaylistDetail('${playlist.id}')"><div class="home-card-img">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : `<div class="home-card-art-fallback"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}<div class="home-card-gradient"></div></div><div class="home-card-info"><div class="home-card-title">${esc(playlist.name)}</div><div class="home-card-sub">${playlist.trackCount} track${playlist.trackCount === 1 ? '' : 's'}</div></div></div>`;
    });
    html += `</div></section>`;
  }

  if (!current && !jumpBack.length && !playlists.length) {
    html += `<section class="home-welcome"><div class="state-icon">&#x266B;</div><h2>Make this space yours</h2><p>Search for a song, create a playlist, or import an existing library to start listening.</p><div class="home-welcome-actions"><button class="home-now-button primary" type="button" onclick="openSearch()">Search music</button><button class="home-now-button" type="button" onclick="switchTab('library')">Open library</button></div></section>`;
  }

  $('content').innerHTML = html + `</div>`;
}

// ── SLEEP TIMER ──────────────────────────────────────────────────────────
function setSleepTimer(minutes) {
  cancelSleepTimer();
  if (minutes <= 0) { toast('Sleep timer off'); updateSleepTimerUI(); return; }
  sleepTimerEnd = Date.now() + minutes * 60 * 1000;
  sleepTimer = setTimeout(() => {
    audio.pause();
    toast('Sleep timer — pausing playback');
    sleepTimer = null;
    sleepTimerEnd = 0;
    updateSleepTimerUI();
  }, minutes * 60 * 1000);
  // Update the countdown display every 10 seconds
  sleepTimerInterval = setInterval(updateSleepTimerUI, 10000);
  updateSleepTimerUI();
  toast(`Sleep timer set for ${minutes} minutes`);
}

function cancelSleepTimer() {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null; }
  sleepTimerEnd = 0;
  updateSleepTimerUI();
}

function updateSleepTimerUI() {
  const el = $('sleep-timer-status');
  if (!el) return;
  if (!sleepTimerEnd) {
    el.textContent = 'No sleep timer is active.';
    return;
  }
  const remaining = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000));
  el.textContent = `Playback will pause in ${remaining} minute${remaining === 1 ? '' : 's'}.`;
}

// ── UTILS ────────────────────────────────────────────────────────────────
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function trunc(s,n) { return s?.length > n ? s.slice(0,n)+'...' : s||''; }
function normalizeArtist(a) {
  if (!a) return '';
  // Normalize separators: semicolons → commas, clean up spacing
  return a.replace(/;\s*/g, ', ').replace(/\s*,\s*/g, ', ').trim();
}
let toastTimer;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2500); }

// ── SIDEBAR TOGGLE ───────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = $('sidebar');
  if (!sb) return;
  sb.classList.toggle('collapsed');
  // Update toggle icon
  const btn = sb.querySelector('.sidebar-toggle');
  if (btn) {
    const isCollapsed = sb.classList.contains('collapsed');
    btn.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-label', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
    btn.innerHTML = isCollapsed
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  }
}

// ── KEYBOARD ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  // Play/Pause
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); togglePlay(); }
  // Next/Previous
  if (e.code === 'ArrowRight' && !e.shiftKey) nextTrack();
  if (e.code === 'ArrowLeft' && !e.shiftKey) prevTrack();
  // Volume up/down
  if (e.code === 'ArrowUp') { e.preventDefault(); adjustVolume(0.05); }
  if (e.code === 'ArrowDown') { e.preventDefault(); adjustVolume(-0.05); }
  // Mute toggle
  if (e.code === 'KeyM') toggleMute();
  // Like current track
  if (e.code === 'KeyL' && queue[currentIdx]) toggleLike(queue[currentIdx].id);
  // Shuffle toggle
  if (e.code === 'KeyS') toggleShuffle();
  // Repeat toggle
  if (e.code === 'KeyR') toggleRepeat();
  // Full player
  if (e.code === 'KeyF') toggleFullPlayer();
  // Escape
  if (e.code === 'Escape') { if ($('fp-queue')?.classList.contains('visible')) fpToggleQueue(); else closeFullPlayer(); }
  // Search focus
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') { e.preventDefault(); $('search-input').focus(); }
  // Seek to percentage (1-9 = 10%-90%, 0 = 100%)
  if (e.code >= 'Digit1' && e.code <= 'Digit9' && audio.duration) {
    const pct = parseInt(e.code.replace('Digit', '')) / 10;
    audio.currentTime = audio.duration * pct;
  }
  if (e.code === 'Digit0' && audio.duration) {
    audio.currentTime = audio.duration;
  }
});

// ── AUTH (Supabase) ────────────────────────────────────────────────────
const sb = () => window.tunelessSupabase; // shorthand for inline client
let currentUser = null;
let syncStatus = 'logged-out';

async function initAuth() {
  try {
    if (!sb()) { console.warn('[auth] supabase client not loaded'); return; }
    sb().onAuthChange(async (event, user) => {
      if (event === 'SIGNED_IN' && user) {
        currentUser = user;
        onUserLoggedIn();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        onUserLoggedOut();
      }
    });
    // Check for existing session
    const session = await sb().getSession();
    if (session?.user) {
      currentUser = session.user;
      onUserLoggedIn();
      return;
    }
  } catch (e) {
    console.warn('[auth] init failed:', e);
  }
  // No session — show auth overlay
  showAuthOverlay();
}

async function onUserLoggedIn() {
  console.log('[auth] logged in as:', currentUser.email);
  $('auth-overlay').classList.remove('visible');
  syncStatus = 'syncing';
  updateSyncUI('Syncing...');
  // Run sync
  try {
    await syncOnLogin();
    playlists = JSON.parse(localStorage.getItem('tl_playlists') || '[]');
    likedIds = new Set(JSON.parse(localStorage.getItem('tl_liked') || '[]'));
    if (tab === 'library') renderLibrary();
    if (tab === 'home') renderHome();
    renderSidebar();
    syncStatus = 'synced';
    updateSyncUI('Synced');
  } catch (e) {
    console.error('[auth] sync failed:', e);
    syncStatus = 'error';
    updateSyncUI('Sync error: ' + e.message);
  }
}

function onUserLoggedOut() {
  syncStatus = 'logged-out';
  updateSyncUI('Signed out');
}

function updateSyncUI(detail) {
  const el = $('sync-status');
  if (el) {
    const dotClass = syncStatus === 'synced' ? 'synced' : syncStatus === 'syncing' ? 'syncing' : syncStatus === 'error' ? 'error' : 'logged-out';
    el.innerHTML = `<span class="sync-dot ${dotClass}"></span> ${esc(detail || syncStatus)}`;
  }
}

function showAuthOverlay() {
  $('auth-overlay').classList.add('visible');
  switchAuthTab('login');
}

function switchAuthTab(tabName) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === tabName));
  $('auth-login-form').classList.toggle('hidden', tabName !== 'login');
  $('auth-signup-form').classList.toggle('hidden', tabName !== 'signup');
  $('auth-forgot-form').classList.add('hidden');
  ['auth-login-error', 'auth-signup-error', 'auth-forgot-error'].forEach(id => { const el = $(id); if (el) el.textContent = ''; });
  ['auth-signup-success', 'auth-forgot-success'].forEach(id => { const el = $(id); if (el) el.textContent = ''; });
}

function showAuthForgot() {
  $('auth-login-form').classList.add('hidden');
  $('auth-signup-form').classList.add('hidden');
  $('auth-forgot-form').classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
}

async function handleAuthLogin() {
  const email = $('auth-login-email').value.trim();
  const password = $('auth-login-password').value;
  const errEl = $('auth-login-error');
  const btn = $('auth-login-btn');
  if (!email || !password) { errEl.textContent = 'Email and password required'; return; }
  btn.disabled = true; btn.textContent = 'Signing in...'; errEl.textContent = '';
  try {
    await sb().signIn(email, password);
  } catch (e) {
    errEl.textContent = e.message || 'Sign in failed';
  }
  btn.disabled = false; btn.textContent = 'Sign In';
}

async function handleAuthSignup() {
  const name = $('auth-signup-name').value.trim();
  const email = $('auth-signup-email').value.trim();
  const password = $('auth-signup-password').value;
  const errEl = $('auth-signup-error');
  const sucEl = $('auth-signup-success');
  const btn = $('auth-signup-btn');
  if (!email || !password) { errEl.textContent = 'Email and password required'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  btn.disabled = true; btn.textContent = 'Creating account...'; errEl.textContent = ''; sucEl.textContent = '';
  try {
    await sb().signUp(email, password, name);
    // Auto sign-in after successful signup
    try {
      await sb().signIn(email, password);
      // Auth change callback handles the rest (hides overlay, syncs)
    } catch (signInErr) {
      // If auto sign-in fails (e.g. email confirmation required), show message
      sucEl.textContent = 'Account created! Please check your email, then sign in.';
      setTimeout(() => switchAuthTab('login'), 1500);
    }
  } catch (e) {
    errEl.textContent = e.message || 'Sign up failed';
  }
  btn.disabled = false; btn.textContent = 'Create Account';
}

async function handleAuthForgotSubmit() {
  const email = $('auth-forgot-email').value.trim();
  const errEl = $('auth-forgot-error');
  const sucEl = $('auth-forgot-success');
  const btn = $('auth-forgot-btn');
  if (!email) { errEl.textContent = 'Email required'; return; }
  btn.disabled = true; btn.textContent = 'Sending...'; errEl.textContent = ''; sucEl.textContent = '';
  try {
    await sb().resetPassword(email);
    sucEl.textContent = 'Password reset link sent. Check your email.';
  } catch (e) {
    errEl.textContent = e.message || 'Failed to send reset link';
  }
  btn.disabled = false; btn.textContent = 'Send Reset Link';
}

async function handleAuthSignOut() {
  await sb().signOut();
  currentUser = null;
  showAuthOverlay();
}

function skipAuth() {
  $('auth-overlay').classList.remove('visible');
}

async function handleAuthGoogle() {
  const supabaseUrl = 'https://nknoznglfiyzlahjsgbl.supabase.co';
  const redirectUrl = 'tuneless://auth/callback';
  try {
    if (window.tuneless?.googleAuth) {
      // Electron: use IPC to open Google OAuth in a separate window
      const result = await window.tuneless.googleAuth(supabaseUrl, redirectUrl);
      if (result?.ok) {
        // Result handled by onGoogleAuthResult listener below
      } else {
        const errEl = $('auth-login-error');
        if (errEl) errEl.textContent = result?.error || 'Google sign-in was cancelled';
      }
    } else {
      // Fallback: redirect via Supabase (works in browser)
      window.location.href = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
    }
  } catch (e) {
    const errEl = $('auth-login-error');
    if (errEl) errEl.textContent = 'Google sign-in failed: ' + e.message;
  }
}

// Listen for Google auth results from main process (Electron IPC)
if (window.tuneless?.onGoogleAuthResult) {
  window.tuneless.onGoogleAuthResult(async (data) => {
    if (data?.access_token && data?.refresh_token) {
      localStorage.setItem('tl_sb_access', data.access_token);
      localStorage.setItem('tl_sb_refresh', data.refresh_token);
      if (data.user) localStorage.setItem('tl_sb_user', JSON.stringify(data.user));
      currentUser = data.user;
      onUserLoggedIn();
    }
  });
}

// Listen for password recovery callback from main process
if (window.tuneless?.onRecovery) {
  window.tuneless.onRecovery(async (data) => {
    if (data?.type === 'recovery' && data?.access_token) {
      // Store the recovery session so we can call updateUser
      localStorage.setItem('tl_sb_access', data.access_token);
      if (data.refresh_token) localStorage.setItem('tl_sb_refresh', data.refresh_token);
      // Show a "set new password" modal
      showResetPasswordModal(data.access_token);
    }
  });
}

function showResetPasswordModal(accessToken) {
  const overlay = $('prompt-overlay');
  const titleEl = $('prompt-title');
  const input = $('prompt-input');
  const okBtn = $('prompt-ok');
  const cancelBtn = $('prompt-cancel');

  titleEl.textContent = 'Set new password';
  input.type = 'password';
  input.value = '';
  input.placeholder = 'New password (min 6 characters)';
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  function close() {
    overlay.style.display = 'none';
    input.type = 'text';
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
  }

  async function onOk() {
    const newPassword = input.value;
    if (!newPassword || newPassword.length < 6) {
      toast('Password must be at least 6 characters');
      return;
    }
    try {
      const res = await fetch('https://nknoznglfiyzlahjsgbl.supabase.co/auth/v1/user', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbm96bmdsZml5emxhaGpzZ2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMjYzNTQsImV4cCI6MjEwMTcwMjM1NH0.bqgie6QV3-k61Vyu-k5mCFXFLK9xhb_qzP1zgASnlKE',
        },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) throw new Error('Password update failed');
      toast('Password updated! You can now sign in.');
      close();
      switchAuthTab('login');
    } catch (e) {
      toast('Failed: ' + e.message);
    }
  }

  function onCancel() { close(); }
  function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') close(); }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
}

// ── CLOUD SYNC ─────────────────────────────────────────────────────────
async function syncOnLogin() {
  if (!sb() || !currentUser) return;
  const local = {
    playlists: JSON.parse(localStorage.getItem('tl_playlists') || '[]'),
    likedIds: JSON.parse(localStorage.getItem('tl_liked') || '[]'),
    settings: { youtube_api_key: localStorage.getItem('tl_api_key') || '' },
  };

  // Pull remote data
  try {
    const remotePls = await fetchRemotePlaylists();
    const remoteLiked = await fetchRemoteLiked();

    // Merge playlists (prefer more tracks)
    const merged = new Map();
    for (const rp of remotePls) merged.set(rp.id, rp);
    for (const lp of local.playlists) {
      const existing = merged.get(lp.id);
      if (!existing || (lp.tracks?.length || 0) >= (existing.tracks?.length || 0)) {
        merged.set(lp.id, lp);
      }
    }
    const mergedPlaylists = Array.from(merged.values());

    // Merge liked (union)
    const mergedLiked = [...new Set([...local.likedIds, ...remoteLiked])];

    // Write merged to localStorage
    localStorage.setItem('tl_playlists', JSON.stringify(mergedPlaylists));
    localStorage.setItem('tl_liked', JSON.stringify(mergedLiked));

    // Push back anything that was local-only
    for (const pl of mergedPlaylists) {
      await pushPlaylistToCloud(pl);
    }
    await pushLikedToCloud(mergedLiked);
  } catch (e) {
    console.warn('[sync] pull/push failed, pushing local only:', e);
    for (const pl of local.playlists) await pushPlaylistToCloud(pl);
    await pushLikedToCloud(local.likedIds);
  }
}

async function fetchRemotePlaylists() {
  if (!sb() || !currentUser) return [];
  const { data } = await sb().from('playlists').select('*').eq('user_id', currentUser.id).then(r => ({ data: r }));
  if (!data?.length) return [];
  const plIds = data.map(p => p.id);
  const { data: tracks } = await sb().from('playlist_tracks').select('*').in('playlist_id', plIds).then(r => ({ data: r }));
  return data.map(pl => ({
    id: pl.id, name: pl.name, trackCount: pl.track_count,
    tracks: (tracks || []).filter(t => t.playlist_id === pl.id).map(t => ({ name: t.name, artist: t.artist, ytId: t.yt_id })),
  }));
}

async function fetchRemoteLiked() {
  if (!sb() || !currentUser) return [];
  const { data } = await sb().from('liked_songs').select('track_id').eq('user_id', currentUser.id).then(r => ({ data: r }));
  return (data || []).map(r => r.track_id);
}

function localIdToUuid(localId) {
  if (!localId) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) return localId;
  let hash = 0;
  for (let i = 0; i < localId.length; i++) { hash = ((hash << 5) - hash) + localId.charCodeAt(i); hash |= 0; }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-5${hex.slice(1, 4)}-${((parseInt(hex.slice(0, 2), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(2, 4)}-${hex.slice(0, 4)}${hex.slice(4, 8)}`;
}

async function pushPlaylistToCloud(pl) {
  if (!sb() || !currentUser) return;
  const remoteId = localIdToUuid(pl.id);
  try {
    await sb().upsert({ id: remoteId, user_id: currentUser.id, name: pl.name, track_count: pl.tracks?.length || 0, updated_at: new Date().toISOString() }, { onConflict: 'id' }).then(r => r);
    // Replace tracks
    const del = await sb().delete('playlist_tracks').eq('playlist_id', remoteId);
    if (pl.tracks?.length) {
      const rows = pl.tracks.map((t, i) => ({ playlist_id: remoteId, user_id: currentUser.id, position: i, name: t.name, artist: t.artist || '', yt_id: t.ytId || null }));
      await sb().insert(rows).then(r => r);
    }
  } catch (e) { console.warn('[sync] push playlist failed:', e.message); }
}

async function syncPlaylistToCloud(pl) {
  if (!currentUser) return;
  await pushPlaylistToCloud(pl);
}

async function syncPlaylistDeleteToCloud(plId) {
  if (!sb() || !currentUser) return;
  try { await sb().delete('playlists').eq('id', localIdToUuid(plId)); } catch (e) {}
}

async function pushLikedToCloud(likedArray) {
  if (!sb() || !currentUser) return;
  try {
    await sb().delete('liked_songs').eq('user_id', currentUser.id);
    if (likedArray.length) {
      const rows = likedArray.map(id => ({ user_id: currentUser.id, track_id: id }));
      await sb().insert(rows).then(r => r);
    }
  } catch (e) { console.warn('[sync] push liked failed:', e.message); }
}

async function syncLikedToCloud(likedArray) {
  if (!currentUser) return;
  await pushLikedToCloud(likedArray);
}
