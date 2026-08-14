// ── Supabase Client — Auth + Data Layer ──────────────────────────────────
// Handles authentication, playlist/liked-songs CRUD, and real-time sync.
// Works in Electron renderer (Chromium).

import { createClient } from '@supabase/supabase-js';

// ── Configuration ──────────────────────────────────────────────────────
// These are injected by the Electron main process via a preload bridge,
// or fall back to window.__SUPABASE_CONFIG set during init.
const SUPABASE_URL = window.__SUPABASE_CONFIG?.url || '';
const SUPABASE_ANON_KEY = window.__SUPABASE_CONFIG?.anonKey || '';

let supabase = null;
let _onAuthChange = null;
let _onSyncEvent = null;

// ── Initialize ─────────────────────────────────────────────────────────
export function initSupabase(url, anonKey) {
  if (!url || !anonKey) return false;
  supabase = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 2 } },
  });
  // Listen for auth state changes
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[supabase] auth event:', event);
    if (_onAuthChange) _onAuthChange(event, session);
  });
  return true;
}

export function isConfigured() {
  return supabase !== null;
}

export function getClient() {
  return supabase;
}

// ── Auth Callbacks ─────────────────────────────────────────────────────
export function onAuthChange(callback) {
  _onAuthChange = callback;
}

export function onSyncEvent(callback) {
  _onSyncEvent = callback;
}

function emitSync(event, data) {
  if (_onSyncEvent) _onSyncEvent(event, data);
}

// ── Auth: Sign Up ──────────────────────────────────────────────────────
export async function signUp(email, password, displayName) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName || email.split('@')[0] } },
  });
  if (error) throw error;
  return data;
}

// ── Auth: Sign In ──────────────────────────────────────────────────────
export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ── Auth: Sign Out ─────────────────────────────────────────────────────
export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) console.warn('[supabase] signOut error:', error);
}

// ── Auth: Get Current Session ──────────────────────────────────────────
export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ── Auth: Reset Password ───────────────────────────────────────────────
export async function resetPassword(email) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════════════
// DATA LAYER — Playlists, Liked Songs, Settings
// ══════════════════════════════════════════════════════════════════════

// ── Settings ───────────────────────────────────────────────────────────
export async function getSettings() {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data;
}

export async function upsertSettings(settings) {
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, ...settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ── Playlists (bulk) ───────────────────────────────────────────────────
export async function getAllPlaylists() {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];

  const { data: pls, error: plErr } = await supabase
    .from('playlists')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (plErr) throw plErr;

  if (!pls?.length) return [];

  // Fetch all tracks for these playlists in one query
  const plIds = pls.map(p => p.id);
  const { data: tracks, error: tErr } = await supabase
    .from('playlist_tracks')
    .select('*')
    .in('playlist_id', plIds)
    .order('position', { ascending: true });
  if (tErr) throw tErr;

  // Assemble
  return pls.map(pl => ({
    id: pl.id,
    name: pl.name,
    trackCount: pl.track_count,
    tracks: (tracks || [])
      .filter(t => t.playlist_id === pl.id)
      .map(t => ({ name: t.name, artist: t.artist, ytId: t.yt_id })),
    _syncedAt: pl.updated_at,
  }));
}

// ── Playlists: Upsert (full replace) ───────────────────────────────────
export async function upsertPlaylist(localPl) {
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;

  // Check if this playlist already exists remotely (match by local ID stored in a metadata column,
  // or by name if the local ID is a local-only ID like 'pl_...')
  // For simplicity: we store the local playlist ID as the Supabase row ID
  // by using a deterministic UUID from the local ID.
  const remoteId = localIdToUuid(localPl.id);

  // Upsert the playlist row
  const { error: plErr } = await supabase
    .from('playlists')
    .upsert({
      id: remoteId,
      user_id: user.id,
      name: localPl.name,
      track_count: localPl.tracks?.length || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  if (plErr) throw plErr;

  // Replace all tracks for this playlist
  // Delete existing tracks first
  await supabase.from('playlist_tracks').delete().eq('playlist_id', remoteId);

  // Insert new tracks
  if (localPl.tracks?.length) {
    const trackRows = localPl.tracks.map((t, i) => ({
      playlist_id: remoteId,
      user_id: user.id,
      position: i,
      name: t.name,
      artist: t.artist || '',
      yt_id: t.ytId || null,
    }));
    const { error: tErr } = await supabase.from('playlist_tracks').insert(trackRows);
    if (tErr) throw tErr;
  }

  emitSync('playlist-upserted', { id: localPl.id, name: localPl.name });
}

// ── Playlists: Delete ──────────────────────────────────────────────────
export async function deletePlaylist(localId) {
  if (!supabase) return;
  const remoteId = localIdToUuid(localId);
  // Tracks cascade-delete via FK
  const { error } = await supabase.from('playlists').delete().eq('id', remoteId);
  if (error) throw error;
  emitSync('playlist-deleted', { id: localId });
}

// ── Liked Songs ────────────────────────────────────────────────────────
export async function getLikedSongs() {
  if (!supabase) return [];
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('liked_songs')
    .select('track_id')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []).map(r => r.track_id);
}

export async function replaceLikedSongs(likedArray) {
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;

  // Delete all existing
  await supabase.from('liked_songs').delete().eq('user_id', user.id);

  // Insert new (batch in groups of 500)
  if (likedArray.length) {
    const rows = likedArray.map(id => ({ user_id: user.id, track_id: id }));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from('liked_songs').insert(batch);
      if (error) throw error;
    }
  }

  emitSync('liked-replaced', { count: likedArray.length });
}

// ── Sync: Push all local data to Supabase ──────────────────────────────
export async function pushAllToSupabase(localData) {
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;

  console.log('[sync] pushing local data to Supabase...');

  // 1. Push settings
  if (localData.settings) {
    await upsertSettings(localData.settings);
  }

  // 2. Push playlists
  if (localData.playlists?.length) {
    for (const pl of localData.playlists) {
      await upsertPlaylist(pl);
    }
  }

  // 3. Push liked songs
  if (localData.likedIds?.length) {
    await replaceLikedSongs(localData.likedIds);
  }

  console.log('[sync] push complete');
  emitSync('push-complete', {});
}

// ── Sync: Pull all data from Supabase ──────────────────────────────────
export async function pullAllFromSupabase() {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;

  console.log('[sync] pulling data from Supabase...');

  const [settings, playlists, likedIds] = await Promise.all([
    getSettings(),
    getAllPlaylists(),
    getLikedSongs(),
  ]);

  console.log('[sync] pull complete:', {
    settings: !!settings,
    playlists: playlists.length,
    liked: likedIds.length,
  });

  emitSync('pull-complete', { playlists: playlists.length, liked: likedIds.length });
  return { settings, playlists, likedIds };
}

// ── Realtime: Subscribe to changes ─────────────────────────────────────
let _realtimeChannel = null;

export function subscribeToChanges(callback) {
  if (!supabase) return;
  const user = getUser();
  if (!user) return;

  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
  }

  _realtimeChannel = supabase
    .channel('tuneless-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, (payload) => {
      console.log('[realtime] playlist change:', payload.eventType);
      callback('playlists', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_tracks' }, (payload) => {
      console.log('[realtime] track change:', payload.eventType);
      callback('tracks', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'liked_songs' }, (payload) => {
      console.log('[realtime] liked change:', payload.eventType);
      callback('liked', payload);
    })
    .subscribe();
}

export function unsubscribeFromChanges() {
  if (_realtimeChannel && supabase) {
    supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

// Convert a local playlist ID (like 'pl_12345_abc') to a deterministic UUID
// so we can match local and remote records.
function localIdToUuid(localId) {
  if (!localId) return null;
  // If it's already a UUID, return it
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) {
    return localId;
  }
  // Generate a deterministic UUID v5-like from the local ID
  // Use a simple hash to create a UUID-shaped string
  let hash = 0;
  for (let i = 0; i < localId.length; i++) {
    const ch = localId.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-5${hex.slice(1, 4)}-${((parseInt(hex.slice(0, 2), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(2, 4)}-${hex.slice(0, 4)}${hex.slice(4, 8)}`;
}
