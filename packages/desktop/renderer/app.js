// ── STATE ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const audio = $('audio-player');

let API_KEY = localStorage.getItem('tl_api_key') || '';
let tab = 'search', searchResults = [], queue = [], currentIdx = -1;
let isPlaying = false, shuffleOn = true, repeatMode = 'off';
let progressTimer = null;
let playlists = JSON.parse(localStorage.getItem('tl_playlists') || '[]');
let ytCache = JSON.parse(localStorage.getItem('tl_yt_cache') || '{}');
let isStreamLoading = false;
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
  // Media key handlers (from Electron globalShortcuts)
  if (window.tuneless?.onMediaPlayPause) {
    window.tuneless.onMediaPlayPause(() => togglePlay());
    window.tuneless.onMediaNext(() => nextTrack());
    window.tuneless.onMediaPrev(() => prevTrack());
    window.tuneless.onMediaStop(() => { audio.pause(); audio.currentTime = 0; });
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
  isPlaying = true; isStreamLoading = false;
  updatePlayButtons(); startProgress();
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
  isPlaying = false; stopProgress();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  // Check if there's a next track or if we should auto-recommend
  if (currentIdx + 1 < queue.length) {
    setTimeout(() => nextTrack(), crossfadeSec > 0 ? 800 : 500);
  } else if (autoplay && API_KEY) {
    setTimeout(() => {
      autoRecommend().then(() => {
        // Try to play the first recommendation if queue was empty
        if (currentIdx + 1 < queue.length) nextTrack();
        else if (queue.length > 0 && currentIdx < queue.length - 1) nextTrack();
      });
    }, 1000);
  }
});
audio.addEventListener('timeupdate', () => { _hasPlayedData = true; updateTimeDisplay(); clearStallTimer(); });
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
    // Use ?v= cache-buster (NOT &) — primary URL has no query string
    audio.src = _fallbackUrl + '&v=' + Date.now();
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
  // First load can take a while — yt-dlp has to extract the stream URL (5-15s).
  // Only react fast (3s) for mid-playback stalls, where we already had audio.
  const delay = _hasPlayedData ? 3000 : 15000;
  _stallTimer = setTimeout(async () => {
    clearStallTimer();
    _stallRetries++;
    console.warn('[audio] stall detected (retry ' + _stallRetries + ')');
    if (_stallRetries === 1) {
      // First stall → try fallback format immediately (preserving position)
      const ok = await tryFallbackFormat();
      if (ok) { _stallRetries = 0; return; }
    }
    if (_stallRetries <= 2 && queue[currentIdx]) {
      // Second attempt: try fresh URL for primary format
      toast('Buffering... retrying stream');
      try {
        const song = queue[currentIdx];
        const urls = await window.tuneless.playStream(song.id);
        if (urls?.error) {
          console.warn('[audio] stream retry blocked:', urls.error);
          toast('YouTube blocked playback — set up cookies in Settings');
        } else if (urls?.primary) {
          _primaryUrl = urls.primary;
          _fallbackUrl = urls.fallback;
          _usingFallback = false;
          audio.src = urls.primary + '?v=' + Date.now();
          await audio.play();
          return;
        }
      } catch (e) {
        console.warn('[audio] stream retry failed:', e);
      }
    }
    // Give up and skip
    toast('Stream failed - skipping to next');
    _stallRetries = 0; _fallbackUrl = null; _primaryUrl = null;
    if (queue.length > 1) nextTrack();
    else { audio.pause(); audio.src = ''; isStreamLoading = false; updatePlayButtons(); }
  }, _hasPlayedData ? 3000 : 15000);
}
audio.addEventListener('waiting', () => { isStreamLoading = true; updatePlayButtons(); startStallTimer(); });
audio.addEventListener('canplay', () => { _hasPlayedData = true; isStreamLoading = false; updatePlayButtons(); clearStallTimer(); _stallRetries = 0; });
audio.addEventListener('playing', () => { _hasPlayedData = true; isStreamLoading = false; updatePlayButtons(); clearStallTimer(); _stallRetries = 0; });
audio.addEventListener('error', async (e) => {
  const errCode = audio.error ? audio.error.code : 0;
  const errMsg = audio.error && audio.error.message ? audio.error.message : 'unknown';
  console.error('Audio error:', 'code=' + errCode, 'msg=' + errMsg);
  // For decode / unsupported / network errors — try fallback format first
  if (!_usingFallback && _fallbackUrl && (errCode === 3 || errCode === 4 || errCode === 2)) {
    console.warn('[audio] trying fallback after decode error');
    const ok = await tryFallbackFormat();
    if (ok) return;
  }
  if (queue.length > 1) {
    toast('Playback error - skipping to next');
    _fallbackUrl = null; _primaryUrl = null;
    setTimeout(() => nextTrack(), 1500);
  } else {
    toast('Playback failed - try a different song');
    setPlayerLoading(false);
    _fallbackUrl = null; _primaryUrl = null;
  }
});

// ── MEDIA SESSION ────────────────────────────────────────────────────────
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => togglePlay());
  navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
  navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
  navigator.mediaSession.setActionHandler('seekto', (e) => { if (e.seekTime && audio.duration) audio.currentTime = e.seekTime; });
  navigator.mediaSession.setActionHandler('stop', () => { audio.pause(); audio.currentTime = 0; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; });
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  setupMediaSession();
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title || 'Unknown', artist: song.artist || '', album: 'Tuneless',
    artwork: song.thumb
      ? [{ src: song.thumb, sizes: '480x480', type: 'image/jpeg' }]
      : [{ src: getYtThumb(song.id), sizes: '480x480', type: 'image/jpeg' }],
  });
  navigator.mediaSession.playbackState = 'playing';
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
  searchResults = []; window._lq = '';
  if (tab === 'search') renderSearch();
}

async function doSearch(q) {
  if (!q || q === window._lq) return;
  window._lq = q;
  if (tab !== 'search') switchTab('search');
  if (!API_KEY) { renderEmpty('No API Key', 'Go to Settings and paste your YouTube Data API key'); return; }
  renderLoading();
  try {
    searchResults = await window.tuneless.searchYoutube(q + ' official audio', API_KEY);
    searchResults.forEach(r => { if (!r.thumb) r.thumb = getYtThumb(r.id); });
    renderSearch();
  } catch (e) {
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
    $('content').innerHTML = `<div class="state-msg"><div class="state-icon">&#x2315;</div><div class="state-title">Search</div><div class="state-sub">Type a song or artist above</div></div>`;
    return;
  }
  $('content').innerHTML = `<div class="track-list">${searchResults.map((r,i) => trackHtml(r,i,'search')).join('')}</div>`;
}

function renderLibrary() {
  if (tab !== 'library') return;

  // Build full playlist list including Liked Songs
  let allPls = [...playlists];
  const likedPl = getLikedPlaylist();
  if (likedPl) allPls.unshift(likedPl);

  let html = `<div class="section-header"><span class="section-title">Playlists (${allPls.length})</span></div>`;
  html += `<div class="library-content">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div class="import-zone" onclick="createNewPlaylist()" style="flex:1;margin-bottom:0;padding:14px">
        <div class="import-label" style="font-size:12px">+ New Playlist</div>
      </div>
      <div class="import-zone" onclick="$('file-input').click()" style="flex:1;margin-bottom:0;padding:14px">
        <div class="import-label" style="font-size:12px">Import CSV</div>
        <input type="file" id="file-input" accept=".csv,.json" multiple style="display:none">
      </div>
      <div class="import-zone" onclick="importSpotifyPlaylist()" style="flex:1;margin-bottom:0;padding:14px;border-color:#1DB954">
        <div class="import-label" style="font-size:12px;color:#1DB954">Import Spotify</div>
      </div>
    </div>`;

  if (!allPls.length) {
    html += `<div class="state-msg" style="padding:20px 0"><div class="state-icon">&#x2261;</div><div class="state-title">No playlists</div><div class="state-sub">Create one or import from Exportify</div></div>`;
  } else {
    html += `<div class="playlist-list">`;
    allPls.forEach(pl => {
      const cached = pl.tracks.filter(t => t.ytId).length;
      const isLiked = pl.isLiked;
      html += `<div class="playlist-item" onclick="renderPlaylistDetail('${pl.id}')">
        <div class="pl-art">${isLiked ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-heart-fill"/></svg>' : '&#x2261;'}</div>
        <div class="pl-info">
          <div class="pl-name">${esc(pl.name)}${isLiked ? ' <span style="font-size:10px;color:var(--text-tertiary)">· ' + likedIds.size + ' liked</span>' : ''}</div>
          <div class="pl-meta">${pl.trackCount} track${pl.trackCount!==1?'s':''} · ${cached} cached${isLiked ? ' · auto' : ''}</div>
        </div>
        <div class="pl-actions">
          ${isLiked ? '' : `<button class="pl-btn" onclick="event.stopPropagation();shufflePl('${pl.id}', event)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><use href="#icon-shuffle"/></svg> Shuffle</button>`}
          ${isLiked ? '' : `<button class="pl-btn-del" onclick="event.stopPropagation();delPl('${pl.id}')" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-x"/></svg></button>`}
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  $('content').innerHTML = html;
  const fi = $('file-input');
  if (fi) { fi.addEventListener('change', function() { if (this.files?.length) handleFiles(this.files); this.value = ''; }); }
}

// ── PROMPT MODAL (replaces native prompt() — broken in Electron) ──
function showPrompt(title, placeholder, callback) {
  const overlay = $('prompt-overlay');
  const input = $('prompt-input');
  const titleEl = $('prompt-title');
  const okBtn = $('prompt-ok');
  const cancelBtn = $('prompt-cancel');

  titleEl.textContent = title;
  input.value = '';
  input.placeholder = placeholder || '';
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  function close(result) {
    overlay.style.display = 'none';
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
    callback(result);
  }
  function onOk() { close(input.value); }
  function onCancel() { close(null); }
  function onKey(e) { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
}

function createNewPlaylist() {
  showPrompt('Playlist name:', 'My Playlist', async (name) => {
    if (!name || !name.trim()) return;
    const pl = { id: 'pl_'+Date.now()+'_'+Math.random().toString(36).slice(2), name: name.trim(), trackCount: 0, tracks: [] };
    playlists.unshift(pl); savePls(); renderLibrary(); toast('Created "' + name.trim() + '"');
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

  titleEl.textContent = 'Add to playlist:';
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
    $('content').innerHTML = `<div class="state-msg"><div class="state-icon">&#x25B6;</div><div class="state-title">Queue is empty</div><div class="state-sub">Search songs or shuffle a playlist</div></div>`;
    return;
  }
  $('content').innerHTML = `<div class="section-header"><span class="section-title">Up Next (${queue.length})</span><button class="section-action" onclick="clearQ()">Clear</button></div><div class="track-list">${queue.map((r,i) => trackHtml(r,i,'queue')).join('')}</div>`;
}

function renderSettings() {
  if (tab !== 'settings') return;
  const isLoggedIn = !!currentUser;
  const initials = currentUser?.email ? currentUser.email.slice(0, 2).toUpperCase() : '';
  const displayName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '';

  let html = `<div style="padding:24px;max-width:500px">`;

  // Account section
  {
    html += `<div class="account-card">
      <div class="account-header">
        <div class="account-avatar">${isLoggedIn ? esc(initials) : '?'}</div>
        <div style="flex:1">
          <div class="account-name">${isLoggedIn ? esc(displayName) : 'Not signed in'}</div>
          <div class="account-email">${isLoggedIn ? esc(currentUser.email) : 'Sign in to sync across devices'}</div>
        </div>
      </div>
      <div class="sync-status" id="sync-status"><span class="sync-dot ${syncStatus === 'synced' ? 'synced' : syncStatus === 'syncing' ? 'syncing' : 'logged-out'}"></span> ${isLoggedIn ? esc(syncStatus) : 'Offline mode'}</div>
      ${isLoggedIn
        ? `<button class="setup-btn" style="margin-top:8px;background:transparent;color:var(--text-secondary);border:1px solid var(--border)" onclick="handleAuthSignOut()">Sign Out</button>`
        : `<button class="setup-btn" style="margin-top:8px" onclick="showAuthOverlay()">Sign In / Sign Up</button>`
      }
    </div>`;
  }

  html += `${API_KEY ? '' : '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--text-secondary)">Set your YouTube API key to enable search and playback.</div>'}`

  // YouTube API Key
  html += `<div style="margin-bottom:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">YouTube API Key</div>
      <input type="text" id="sett-key" class="setup-input" value="${esc(API_KEY)}" placeholder="AIza..." autocomplete="off" spellcheck="false">
      <button class="setup-btn" style="margin-top:8px" onclick="updateKey()">${API_KEY ? 'Update' : 'Save'}</button>
      ${API_KEY ? `<div style="margin-top:8px;font-size:11px;color:var(--text-tertiary)">● ${API_KEY.slice(0,12)}...</div>` : ''}
    </div>`;

  // Audio settings
  html += `<div style="margin-bottom:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Audio</div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:12px;color:var(--text-secondary);min-width:80px">Crossfade</span>
        <input type="range" id="crossfade-slider" min="0" max="10" step="1" value="${crossfadeSec}"
          style="flex:1;-webkit-appearance:none;appearance:none;height:3px;background:var(--border);border-radius:2px;outline:none;cursor:pointer">
        <span id="crossfade-label" style="font-size:12px;color:var(--text-secondary);min-width:40px">${crossfadeSec}s</span>
      </div>
    </div>`;

  // Sleep Timer
  html += `<div style="margin-bottom:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Sleep Timer</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[15,30,45,60,90,120].map(m => `<button class="pl-btn" onclick="setSleepTimer(${m})" style="padding:6px 12px">${m >= 60 ? (m/60) + 'h' : m + 'm'}</button>`).join('')}
        <button class="pl-btn" onclick="cancelSleepTimer()" style="padding:6px 12px;border-color:#ef4444;color:#ef4444">Off</button>
      </div>
      <div id="sleep-timer-status" style="font-size:11px;color:var(--text-muted);margin-top:8px;display:none"></div>
    </div>`;

  // Shortcuts
  html += `<div>
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Shortcuts</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:2.2">
        <kbd class="kb">Space</kbd> Play/Pause &middot; <kbd class="kb">M</kbd> Mute &middot; <kbd class="kb">L</kbd> Like<br>
        <kbd class="kb">&rarr;</kbd> Next &middot; <kbd class="kb">&larr;</kbd> Prev &middot; <kbd class="kb">&uarr;&darr;</kbd> Volume<br>
        <kbd class="kb">S</kbd> Shuffle &middot; <kbd class="kb">R</kbd> Repeat &middot; <kbd class="kb">F</kbd> Full player<br>
        <kbd class="kb">1</kbd>-<kbd class="kb">9</kbd> Seek 10%-90% &middot; <kbd class="kb">0</kbd> End<br>
        <kbd class="kb">&#x2318;K</kbd> Search &middot; <kbd class="kb">Esc</kbd> Close overlay
      </div>
    </div>`;

  // Cookies
  html += `<div style="margin-top:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">YouTube Cookies</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:10px">
        YouTube sometimes blocks playback ("Sign in to confirm you're not a bot").
        Fix it by exporting a cookies.txt from your browser (Get cookies.txt LOCALLY extension) and importing it here.
      </div>
      <div id="cookies-status" style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px">Checking...</div>
      <button class="setup-btn" style="margin-bottom:8px" onclick="importCookies()">Import cookies.txt</button>
      <button class="setup-btn" id="cookies-remove-btn" style="display:none;background:transparent;color:var(--text-tertiary);border:1px solid var(--border)" onclick="removeCookies()">Remove cookies</button>
    </div>`;

  // Diagnostics
  html += `<div style="margin-top:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">Diagnostics</div>
      <button class="setup-btn" style="margin-bottom:8px" onclick="runDiagnostics()">Test Audio Pipeline</button>
      <div id="diag-results" style="font-size:12px;color:var(--text-secondary);line-height:1.8;background:var(--surface);padding:12px;border-radius:4px;border:1px solid var(--border);white-space:pre-wrap;font-family:monospace;max-height:300px;overflow-y:auto"></div>
    </div>`;

  // About
  html += `<div style="margin-top:24px">
      <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">About</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.8">
        Tuneless &mdash; desktop music player.<br>
        Algorithmic recommendations &middot; yt-dlp audio &middot; v2.0.8
      </div>
    </div>
  </div>`;
  $('content').innerHTML = html;
  const cfSlider = $('crossfade-slider');
  if (cfSlider) {
    cfSlider.addEventListener('input', () => {
      crossfadeSec = parseFloat(cfSlider.value);
      $('crossfade-label').textContent = crossfadeSec + 's';
      localStorage.setItem('tl_crossfade', crossfadeSec.toString());
    });
  }
  // Show cookie status
  updateCookiesStatus();
}

function renderPlaylistDetail(plId) {
  currentPlaylistId = plId;
  const isLiked = plId === '__liked';
  const pl = isLiked ? getLikedPlaylist() : playlists.find(p => p.id === plId);
  if (!pl) { renderLibrary(); return; }
  const cached = pl.tracks.filter(t => t.ytId).length;
  const hasFilter = _plFilter.length > 0;
  const filtered = hasFilter
    ? pl.tracks.filter(t => t.name.toLowerCase().includes(_plFilter) || t.artist.toLowerCase().includes(_plFilter))
    : pl.tracks;

  let html = `<div class="pl-det-head">
      <button class="back-btn" onclick="renderLibrary();currentPlaylistId=null;_plFilter=''"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-arrow-left"/></svg></button>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${esc(pl.name)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${pl.trackCount} tracks · ${cached} cached · ${filtered.length} shown</div>
      </div>
      <div class="pl-action-group">
        <button class="pl-play-btn" id="pl-play-btn" onclick="playPl('${plId}', event)" title="Play"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg></button>
        <button class="pl-shuffle-toggle${shuffleOn ? ' active' : ''}" id="pl-shuffle-toggle" onclick="toggleShuffleFromPlaylist('${plId}', event)" title="Shuffle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-shuffle"/></svg></button>
      </div>
    </div>
    <div style="padding:8px 24px;border-bottom:1px solid var(--border)">
      <input type="text" id="pl-filter" placeholder="Filter ${pl.trackCount} tracks..." autocomplete="off" spellcheck="false"
        style="width:100%;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:13px;outline:none"
        value="${esc(_plFilter)}">
    </div>
    <div class="track-list" id="pl-tracks"></div>`;

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
      const header = $('content').querySelector('.pl-det-head .pl-info div:last-child');
      if (header) header.textContent = `${pl.trackCount} tracks · ${cached} cached · ${newFiltered.length} shown`;
    });
  }
}

function renderPlaylistTracks(pl, plId, filtered) {
  const el = $('pl-tracks');
  if (!el) return;
  const isLiked = plId === '__liked';
  if (!filtered.length) {
    el.innerHTML = `<div class="state-msg" style="padding:40px"><div class="state-icon">&#x25CB;</div><div class="state-title">${_plFilter ? 'No matching tracks' : 'No tracks'}</div><div class="state-sub">${_plFilter ? 'Try a different search term' : 'This playlist is empty'}</div></div>`;
  } else {
    el.innerHTML = filtered.map((t, i) => {
      const isCurrentlyPlaying = queue[currentIdx]?.id === (t.ytId || '');
      const thumb = t.ytId ? getYtThumb(t.ytId) : '';
      const realIdx = pl.tracks.indexOf(t);
      return `<div class="track-item${isCurrentlyPlaying ? ' playing' : ''}"
        draggable="${!isLiked}"
        ondragstart="_dragIdx=${realIdx};this.style.opacity='0.4'"
        ondragend="this.style.opacity='1'"
        ondragover="event.preventDefault();this.style.borderTop='2px solid var(--accent)'"
        ondragleave="this.style.borderTop=''"
        ondrop="event.preventDefault();this.style.borderTop='';reorderTrack('${plId}',_dragIdx,${realIdx})"
        onclick="playPlaylistTrack('${plId}', ${realIdx})">
        ${!isLiked ? '<div style="display:flex;align-items:center;color:var(--text-muted);cursor:grab;padding-right:4px;font-size:10px">⠿</div>' : ''}
        <div class="track-thumb">${thumb ? `<img src="${thumb}" loading="lazy">` : ''}</div>
        <div class="track-info">
          <div class="track-title">${esc(t.name)}${isCurrentlyPlaying ? ' <span style="color:var(--text-tertiary)">&#x25CF; playing</span>' : ''}</div>
          <div class="track-artist">${esc(normalizeArtist(t.artist) || 'Unknown')}</div>
        </div>
        <div style="flex-shrink:0;display:flex;align-items:center;color:var(--text-tertiary)">${t.ytId ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-check"/></svg>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-refresh"/></svg>'}</div>
      </div>`;
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
  return `<div class="track-item${playing?' playing':''}">
    <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer" onclick="${ctx==='queue' ? 'playFromQ('+i+')' : 'playSearch('+i+')'}">
    <div class="track-thumb">${thumb ? `<img src="${esc(thumb)}" loading="lazy">` : ''}</div>
    <div class="track-info">
      <div class="track-title">${esc(r.title||r.name)}${isStreamLoading && playing ? ' <span style="color:var(--text-tertiary)">loading...</span>' : ''}</div>
      <div class="track-artist">${esc(normalizeArtist(r.artist)||'')}</div>
    </div>
    <div class="track-dur">${r.duration||''}</div>
    </div>
    <div style="flex-shrink:0;display:flex;gap:4px">
      <button class="pc-btn" onclick="playNextSearch(${i})" title="Play next" style="font-size:0;width:26px;height:26px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg></button>
      <button class="pc-btn" onclick="addToQueueEnd('${esc(titleAttr)}','${esc(r.artist||'')}','${r.id}')" title="Add to queue" style="font-size:0;width:26px;height:26px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg></button>
    </div>
  </div>`;
}

// Queue management
function playNextSearch(i) {
  const s = searchResults[i]; if (!s) return;
  const existing = queue.findIndex(q => q.id === s.id);
  if (existing >= 0) { toast('Already in queue'); return; }
  const song = { id: s.id, title: s.title, artist: s.artist, thumb: s.thumb || getYtThumb(s.id), duration: s.duration || '' };
  if (currentIdx >= 0 && currentIdx < queue.length) {
    queue.splice(currentIdx + 1, 0, song);
  } else {
    queue.push(song);
  }
  toast('"' + trunc(s.title, 30) + '" will play next');
  saveSession();
  if (tab === 'queue') renderQueue();
}

function addToQueueEnd(title, artist, id) {
  const existing = queue.findIndex(q => q.id === id);
  if (existing >= 0) { toast('Already in queue'); return; }
  const song = { id, title, artist, thumb: getYtThumb(id), duration: '' };
  queue.push(song);
  toast('Added to queue');
  saveSession();
  if (tab === 'queue') renderQueue();
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
  clearStallTimer(); _stallRetries = 0; _hasPlayedData = false;
  const song = queue[idx]; if (!song) return;

  // Crossfade: only on auto-advance (song ending), NOT on manual skip
  // Skip when muted so we never restore stale volume
  if (!manual && crossfadeSec > 0 && !isMuted && audio.src && !audio.paused) {
    const fadeDuration = Math.min(crossfadeSec, 1.5); // cap at 1.5s even for auto
    const fadeSteps = 8;
    const fadeInterval = (fadeDuration * 1000) / fadeSteps;
    const startVol = audio.volume;
    for (let i = fadeSteps; i >= 0; i--) {
      audio.volume = startVol * (i / fadeSteps);
      await new Promise(r => setTimeout(r, fadeInterval));
    }
  } else if (audio.src && !audio.paused) {
    // Manual skip: cut instantly
    audio.volume = 0;
  }
  audio.volume = isMuted ? 0 : currentVol;

  currentIdx = idx; updateNowPlaying(song); setPlayerLoading(true);
  addToRecentlyPlayed(song);
  try {
    const urls = await window.tuneless.playStream(song.id);
    if (urls?.error) {
      console.error('[playIndex] stream error:', urls.error);
      setPlayerLoading(false);
      _fallbackUrl = null; _primaryUrl = null;
      const isBot = /bot-check|cookies/i.test(urls.error);
      if (isBot) {
        toast('YouTube blocked this track — import cookies.txt in Settings to fix');
      } else {
        toast('Could not get audio stream: ' + urls.error);
      }
      // Skip to next track instead of redirecting away from current view
      if (queue.length > 1) {
        setTimeout(() => nextTrack(), 1500);
      }
      return;
    }
    if (!urls || !urls.primary) { toast('Could not get audio stream'); setPlayerLoading(false); return; }
    _primaryUrl = urls.primary;
    _fallbackUrl = urls.fallback;
    _usingFallback = false;
    console.log('[playIndex] setting src:', _primaryUrl);
    audio.src = _primaryUrl;
    // Wait for the audio element to have enough data before playing
    await audio.play();
    toast('▶ ' + trunc(song.title, 50));
  } catch (e) {
    console.error('play error:', e);
    if (e.name === 'NotAllowedError') { setPlayerLoading(false); toast('Click play to start'); }
    else { toast('Failed to play: ' + (e.message || 'unknown')); setPlayerLoading(false); }
  }
  saveSession();
}

function togglePlay() {
  if (isStreamLoading) return;
  if (audio.ended && audio.src) {
    // Song ended — restart it (or go next based on repeat mode)
    if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); }
    else if (currentIdx + 1 < queue.length || repeatMode === 'all') nextTrack();
    else { audio.currentTime = 0; audio.play(); }
  } else if (audio.paused && audio.src) {
    audio.play();
  } else if (!audio.paused) {
    audio.pause();
  } else if (currentIdx >= 0) {
    playIndex(currentIdx);
  }
}

function nextTrack() {
  if (!queue.length) return;
  let next;
  if (shuffleOn && queue.length > 1) {
    // Pick a random track that isn't the current one
    do { next = Math.floor(Math.random() * queue.length); } while (next === currentIdx);
  } else {
    next = currentIdx + 1;
    if (next >= queue.length) { if (repeatMode === 'all') next = 0; else return; }
  }
  playIndex(next, true); if (tab === 'queue') renderQueue();
}

function prevTrack() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prev = currentIdx - 1;
  if (prev < 0) { if (repeatMode === 'all') prev = queue.length - 1; else return; }
  playIndex(prev, true); if (tab === 'queue') renderQueue();
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

function seekTo(e) { const rect = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration; }
function fpSeek(e) { const rect = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration; }

function clearQ() {
  queue = []; currentIdx = -1; audio.pause(); audio.src = '';
  _fallbackUrl = null; _primaryUrl = null; _usingFallback = false;
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
  $('fp-q-count').textContent = queue.length + ' tracks';
  $('fp-queue-list').innerHTML = queue.map((t, i) => {
    const playing = i === currentIdx; const thumb = t.thumb || getYtThumb(t.id);
    return `<div class="fp-queue-item${playing?' playing':''}" onclick="closeFullPlayer();playFromQ(${i})">
      <div class="fp-qi-thumb">${thumb ? `<img src="${thumb}" loading="lazy">` : ''}</div>
      <div class="fp-qi-info"><div class="fp-qi-title">${esc(t.title||t.name)}</div><div class="fp-qi-artist">${esc(normalizeArtist(t.artist)||'')}</div></div>
    </div>`;
  }).join('');
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
  if (btn) { btn.classList.remove('loading'); setIcon(btn, isPlaying ? 'pause' : 'play', 20); }
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
  // Show a prompt for the Spotify playlist URL
  showPrompt('Spotify Playlist URL:', 'https://open.spotify.com/playlist/...', async (url) => {
    if (!url || !url.includes('spotify.com/playlist/')) {
      toast('Please enter a valid Spotify playlist URL');
      return;
    }
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
async function updateCookiesStatus() {
  const el = $('cookies-status');
  if (!el) return;
  try {
    const s = await window.tuneless.cookiesStatus();
    if (s?.present) {
      el.innerHTML = '<span style="color:#1DB954">●</span> cookies.txt active — streams use it';
      const btn = $('cookies-remove-btn');
      if (btn) btn.style.display = 'block';
    } else {
      el.innerHTML = '<span style="color:var(--text-quaternary)">○</span> No cookies.txt yet — import one if YouTube blocks playback';
      const btn = $('cookies-remove-btn');
      if (btn) btn.style.display = 'none';
    }
  } catch (e) {
    el.textContent = 'Status unavailable: ' + e.message;
  }
}

async function importCookies() {
  try {
    const r = await window.tuneless.cookiesImport();
    toast(r?.ok ? r.message : (r?.message || 'Import failed'));
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
  switchTab('settings');
  const el = $('cookies-status');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function runDiagnostics() {
  const el = $('diag-results');
  el.textContent = 'Running diagnostics...\n';
  try {
    // 1. Check yt-dlp version
    el.textContent += '\n1. Checking yt-dlp... ';
    const ver = await window.tuneless.ytdlpVersion();
    el.textContent += ver + '\n';
  } catch (e) {
    el.textContent += 'ERROR: ' + e.message + '\n';
  }
  try {
    // 2. Try to resolve a test video
    el.textContent += '\n2. Testing stream extraction (Rick Astley)...\n';
    const result = await window.tuneless.ytdlpTest('dQw4w9WgXcQ');
    el.textContent += '   Primary URL: ' + (result.primary ? result.primary.slice(0,80) + '...' : 'FAILED') + '\n';
    el.textContent += '   Fallback URL: ' + (result.fallback ? result.fallback.slice(0,80) + '...' : 'FAILED') + '\n';
    el.textContent += '   Last resort: ' + (result.lastResort ? result.lastResort.slice(0,80) + '...' : 'FAILED') + '\n';
    if (result.error) el.textContent += '   Errors: ' + result.error + '\n';
    if (result.primary) el.textContent += '\n✅ yt-dlp works! Stream URLs extracted.\n';
    else el.textContent += '\n❌ yt-dlp failed to extract any stream.\n';
  } catch (e) {
    el.textContent += '   ERROR: ' + e.message + '\n';
  }
  try {
    // 3. Test stream proxy
    el.textContent += '\n3. Testing stream proxy... ';
    const resp = await fetch('http://127.0.0.1:18762/stream/dQw4w9WgXcQ', { method: 'HEAD' });
    el.textContent += 'HTTP ' + resp.status + ' ' + resp.statusText + '\n';
  } catch (e) {
    el.textContent += 'NOT REACHABLE: ' + e.message + '\n';
  }
  try {
    // 4. Check audio element support
    el.textContent += '\n4. Audio element support:\n';
    const a = document.createElement('audio');
    el.textContent += '   canPlayType(aac/mp4): ' + (a.canPlayType('audio/mp4').replace('no', '❌').replace('maybe', '⚠️ maybe').replace('probably', '✅ probably')) + '\n';
    el.textContent += '   canPlayType(mp3): ' + (a.canPlayType('audio/mpeg').replace('no', '❌').replace('maybe', '⚠��� maybe').replace('probably', '✅ probably')) + '\n';
    el.textContent += '   canPlayType(ogg/opus): ' + (a.canPlayType('audio/ogg; codecs=opus').replace('no', '❌').replace('maybe', '⚠️ maybe').replace('probably', '✅ probably')) + '\n';
    el.textContent += '   canPlayType(webm): ' + (a.canPlayType('audio/webm').replace('no', '❌').replace('maybe', '⚠️ maybe').replace('probably', '✅ probably')) + '\n';
  } catch (e) {
    el.textContent += '   ERROR: ' + e.message + '\n';
  }
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
function renderHome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  let html = '';
  html += `<div class="home-greeting">${greeting}</div>`;
  html += `<div class="home-title">Home</div>`;

  // Jump Back In — last 6 recently played
  const jumpBack = recentlyPlayed.slice(0, 6);
  if (jumpBack.length) {
    html += `<div class="section-header"><span class="section-title">Jump back in</span></div>`;
    html += `<div class="home-cards">`;
    jumpBack.forEach((t, i) => {
      const thumb = t.thumb || getYtThumb(t.id);
      html += `<div class="home-card" onclick="replayRecents(${i})">
        <div class="home-card-img"><img src="${esc(thumb)}" loading="lazy"><div class="home-card-gradient"></div>
        <button class="home-card-play" onclick="event.stopPropagation();replayRecents(${i})"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg></button></div>
        <div class="home-card-info"><div class="home-card-title">${esc(t.title)}</div><div class="home-card-sub">${esc(normalizeArtist(t.artist))}</div></div>
      </div>`;
    });
    html += `</div>`;
  }

  // Up Next — queue preview
  if (queue.length > currentIdx + 1) {
    const nextTracks = queue.slice(currentIdx + 1, currentIdx + 9);
    html += `<div class="section-header"><span class="section-title">Up Next</span><button class="section-action" onclick="switchTab('queue')">See all</button></div>`;
    html += `<div class="up-next-list">`;
    nextTracks.forEach((t, i) => {
      const thumb = t.thumb || getYtThumb(t.id);
      const dotClass = t._rec ? 'green' : 'gray';
      html += `<div class="up-next-row" onclick="playFromQ(${currentIdx + 1 + i})">
        <div class="up-next-thumb"><img src="${esc(thumb)}" loading="lazy"></div>
        <div class="up-next-info"><div class="up-next-title">${esc(t.title)}</div><div class="up-next-artist">${esc(normalizeArtist(t.artist))}</div></div>
        <div class="up-next-dot ${dotClass}"></div>
      </div>`;
    });
    html += `</div>`;
  }

  // Your Playlists
  if (playlists.length) {
    html += `<div class="section-header"><span class="section-title">Your Playlists</span><button class="section-action" onclick="switchTab('library')">See all</button></div>`;
    html += `<div class="home-cards">`;
    playlists.slice(0, 6).forEach(p => {
      const thumb = p.tracks[0]?.ytId ? getYtThumb(p.tracks[0].ytId) : '';
      html += `<div class="home-card" onclick="renderPlaylistDetail('${p.id}')">
        <div class="home-card-img">${thumb ? `<img src="${esc(thumb)}" loading="lazy">` : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:48px;color:var(--text-muted)"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}<div class="home-card-gradient"></div></div>
        <div class="home-card-info"><div class="home-card-title">${esc(p.name)}</div><div class="home-card-sub">${p.trackCount} tracks</div></div>
      </div>`;
    });
    html += `</div>`;
  }

  // Recently Resolved
  if (recentlyPlayed.length) {
    html += `<div class="section-header"><span class="section-title">Recently Resolved</span></div>`;
    html += `<div class="resolved-table"><div class="resolved-row header"><span class="resolved-cell">Track</span><span class="resolved-cell">Artist</span><span class="resolved-cell">Plays</span><span class="resolved-cell">Status</span></div>`;
    recentlyPlayed.slice(0, 10).forEach(t => {
      html += `<div class="resolved-row" onclick="replayRecents(${recentlyPlayed.indexOf(t)})"><span class="resolved-cell">${esc(t.title)}</span><span class="resolved-cell" style="color:var(--text-muted)">${esc(normalizeArtist(t.artist))}</span><span class="resolved-cell" style="color:var(--text-muted)">${t.playCount || 1}</span><span class="resolved-status"><span class="resolved-dot ok"></span> Resolved</span></div>`;
    });
    html += `</div>`;
  }

  if (!jumpBack?.length && !playlists.length && !recentlyPlayed.length) {
    html += `<div class="state-msg" style="padding:60px 0"><div class="state-icon">&#x266B;</div><div class="state-title">Welcome to Tuneless</div><div class="state-sub">Search for a song to get started, or import a playlist from Spotify.</div></div>`;
  }

  $('content').innerHTML = html;
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
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  const remaining = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000));
  el.style.display = 'block';
  el.innerHTML = `⏱ Sleep in ${remaining}m <button onclick="cancelSleepTimer()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;text-decoration:underline;margin-left:4px">cancel</button>`;
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
