// ── Tuneless — Recommendation Engine ──────────────────────────
// Pure algorithmic recommendations from your own music library.
// No external APIs. Uses genre keyword mapping, artist co-occurrence,
// and Jaccard similarity on track titles.

import { Playlist, PlaylistTrack, Track, RecommendedTrack } from '../types';

const GENRE_KEYWORDS: Record<string, string[]> = {
  pop: ['pop', 'taylor swift', 'justin bieber', 'ariana grande', 'billie eilish', 'dua lipa', 'ed sheeran', 'harry styles', 'olivia rodrigo', 'bruno mars', 'katy perry', 'lady gaga', 'rihanna', 'selena gomez', 'maroon 5', 'coldplay', 'imagine dragons', 'one direction'],
  rock: ['rock', 'queen', 'led zeppelin', 'pink floyd', 'ac/dc', 'nirvana', 'metallica', 'guns n roses', 'the beatles', 'rolling stones', 'aerosmith', 'foo fighters', 'red hot chili', 'green day', 'linkin park', 'radiohead', 'muse', 'arctic monkeys', 'pearl jam', 'paramore'],
  'hip-hop': ['hip hop', 'rap', 'kendrick lamar', 'drake', 'j cole', 'travis scott', 'kanye west', 'jay z', 'eminem', 'snoop dogg', 'dr dre', 'tupac', 'nas', 'outkast', 'childish gambino', 'post malone', 'cardi b', 'nicki minaj'],
  'r&b': ['rnb', 'soul', 'stevie wonder', 'marvin gaye', 'aretha franklin', 'beyonce', 'usher', 'alicia keys', 'the weeknd', 'frank ocean', 'daniel caesar', 'sza', 'michael jackson', 'prince'],
  electronic: ['electronic', 'edm', 'dance', 'techno', 'house', 'trance', 'dubstep', 'ambient', 'david guetta', 'calvin harris', 'avicii', 'skrillex', 'deadmau5', 'daft punk', 'kygo', 'flume', 'illenium'],
  jazz: ['jazz', 'miles davis', 'john coltrane', 'duke ellington', 'louis armstrong', 'ella fitzgerald', 'nina simone', 'frank sinatra', 'chet baker'],
  classical: ['classical', 'beethoven', 'mozart', 'bach', 'chopin', 'tchaikovsky', 'vivaldi', 'debussy', 'ravel', 'orchestra', 'symphony', 'ludovico einaudi', 'yiruma'],
  indie: ['indie', 'vampire weekend', 'arcade fire', 'the xx', 'tame impala', 'beach house', 'phoebe bridgers', 'mitski', 'mac demarco', 'bon iver', 'fleet foxes', 'glass animals', 'the neighborhood'],
  metal: ['metal', 'heavy metal', 'iron maiden', 'black sabbath', 'slipknot', 'disturbed', 'tool', 'system of a down'],
  folk: ['folk', 'bob dylan', 'joni mitchell', 'simon & garfunkel', 'johnny cash', 'the lumineers', 'mumford & sons', 'hozier', 'caamp'],
  latin: ['latin', 'reggaeton', 'salsa', 'bad bunny', 'j balvin', 'ozuna', 'rosalia', 'shakira', 'daddy yankee'],
  country: ['country', 'dolly parton', 'johnny cash', 'garth brooks', 'chris stapleton', 'luke combs', 'morgan wallen', 'zach bryan'],
  'k-pop': ['kpop', 'bts', 'blackpink', 'twice', 'exo', 'red velvet', 'stray kids', 'aespa', 'itzy', 'newjeans'],
  'lo-fi': ['lofi', 'lo-fi', 'chill beats', 'lofi hip hop', 'study music', 'chillhop'],
};

function inferGenre(artist: string, title: string): Record<string, number> {
  const combined = ((artist || '') + ' ' + (title || '')).toLowerCase();
  const scores: Record<string, number> = {};
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) score += kw.length > 5 ? 3 : 1;
    }
    if (score > 0) scores[genre] = score;
  }
  return scores;
}

function getTopGenres(scores: Record<string, number>, count = 3): string[] {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, count).map(e => e[0]);
}

interface ArtistNode {
  genreScores: Record<string, number>;
  coArtists: Record<string, number>;
  totalPlays: number;
  sampleArtist: string;
}

function buildArtistGraph(
  playlists: Playlist[],
  recentlyPlayed: Track[],
  likedIds: Set<string>,
): Record<string, ArtistNode> {
  const graph: Record<string, ArtistNode> = {};

  playlists.forEach(pl => {
    const artistsInPlaylist = [...new Set(pl.tracks.map(t => t.artist?.toLowerCase().trim()).filter(Boolean))];
    artistsInPlaylist.forEach(a1 => {
      if (!graph[a1]) graph[a1] = { genreScores: {}, coArtists: {}, totalPlays: 0, sampleArtist: pl.tracks.find(t => t.artist?.toLowerCase().trim() === a1)?.artist || a1 };
      artistsInPlaylist.forEach(a2 => { if (a1 !== a2) graph[a1].coArtists[a2] = (graph[a1].coArtists[a2] || 0) + 1; });
    });
  });

  playlists.forEach(pl => {
    pl.tracks.forEach(t => {
      const a = t.artist?.toLowerCase().trim();
      if (!a || !graph[a]) return;
      const g = inferGenre(t.artist, t.title);
      for (const [genre, score] of Object.entries(g)) graph[a].genreScores[genre] = (graph[a].genreScores[genre] || 0) + score;
      graph[a].totalPlays++;
    });
  });

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

function findSimilarArtists(graph: Record<string, ArtistNode>, sourceArtist: string, maxCount = 5): string[] {
  const source = sourceArtist?.toLowerCase().trim();
  if (!source || !graph[source]) return [];

  const scores: Record<string, number> = {};
  const sourceGenreKeys = Object.keys(graph[source].genreScores).sort();

  for (const [artist, data] of Object.entries(graph)) {
    if (artist === source) continue;
    let score = 0;
    const coScore = data.coArtists[source] || graph[source].coArtists[artist] || 0;
    score += coScore * 4;
    const targetGenres = Object.keys(data.genreScores);
    const genreOverlap = sourceGenreKeys.filter(g => targetGenres.includes(g)).length;
    score += (sourceGenreKeys.length > 0 ? genreOverlap / Math.max(sourceGenreKeys.length, 1) : 0) * 3;
    score += Math.min(data.totalPlays / 5, 1) * 2;
    if (score > 0.5) scores[artist] = score;
  }

  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, maxCount).map(e => e[0]);
}

export function buildRecommendations(
  playlists: Playlist[],
  recentlyPlayed: Track[],
  likedIds: Set<string>,
  queue: Track[],
  maxCount = 20,
): RecommendedTrack[] {
  const seenIds = new Set(queue.map(q => q.id));
  recentlyPlayed.forEach(r => seenIds.add(r.id));

  const graph = buildArtistGraph(playlists, recentlyPlayed, likedIds);

  const seedArtists = [...new Set([
    ...recentlyPlayed.slice(0, 10).map(r => r.artist?.toLowerCase().trim()).filter(Boolean) as string[],
    ...Array.from(likedIds).map(id => {
      const found = recentlyPlayed.find(r => r.id === id);
      return found?.artist?.toLowerCase().trim();
    }).filter(Boolean) as string[],
  ])];

  const results: RecommendedTrack[] = [];
  const similarArtistScores: Record<string, number> = {};

  for (const seed of seedArtists) {
    const similar = findSimilarArtists(graph, seed, 5);
    similar.forEach((artist, idx) => {
      similarArtistScores[artist] = (similarArtistScores[artist] || 0) + (5 - idx);
    });
  }

  const topSimilar = Object.entries(similarArtistScores).sort((a, b) => b[1] - a[1]);

  for (const [artist] of topSimilar) {
    const displayName = graph[artist]?.sampleArtist || artist;
    const tracks: PlaylistTrack[] = [];
    playlists.forEach(pl => {
      pl.tracks.forEach(t => {
        if (t.artist?.toLowerCase().trim() === artist && t.ytId && !seenIds.has(t.ytId)) tracks.push(t);
      });
    });
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    for (const t of tracks) {
      if (results.length >= maxCount) break;
      if (!seenIds.has(t.ytId) && !results.some(r => r.id === t.ytId)) {
        results.push({ id: t.ytId, title: t.title, artist: t.artist, thumbnail: `https://img.youtube.com/vi/${t.ytId}/hqdefault.jpg`, source: 'similar', reason: `Because you listen to ${displayName}` });
        seenIds.add(t.ytId);
      }
    }
    if (results.length >= maxCount) break;
  }

  // Fill remaining with genre-matched tracks
  if (results.length < maxCount) {
    const allRemaining: PlaylistTrack[] = [];
    playlists.forEach(pl => pl.tracks.forEach(t => { if (t.ytId && !seenIds.has(t.ytId)) allRemaining.push(t); }));
    const dominantGenres: Record<string, number> = {};
    [...seedArtists, ...topSimilar.slice(0, 3).map(e => e[0])].forEach(a => {
      if (graph[a]) { for (const [g, s] of Object.entries(graph[a].genreScores)) dominantGenres[g] = (dominantGenres[g] || 0) + s; }
    });
    const topDomGenres = getTopGenres(dominantGenres, 3);
    const scored = allRemaining.map(t => ({ track: t, gScore: Object.entries(inferGenre(t.artist, t.title)).reduce((sum, [g, s]) => sum + (topDomGenres.includes(g) ? s : 0), 0) })).filter(t => t.gScore > 0);
    scored.sort((a, b) => b.gScore - a.gScore);
    for (const { track: t } of scored) {
      if (results.length >= maxCount) break;
      results.push({ id: t.ytId!, title: t.title, artist: t.artist, thumbnail: `https://img.youtube.com/vi/${t.ytId}/hqdefault.jpg`, source: 'genre' });
    }
  }

  return results;
}
