// ── Sync Layer — localStorage ↔ Supabase ────────────────────────────────
// Handles merging local data with cloud data on login,
// and pushing changes to Supabase on every mutation.

import {
  pushAllToSupabase,
  pullAllFromSupabase,
  subscribeToChanges,
  unsubscribeFromChanges,
} from './supabase.js';

let _syncEnabled = false;
let _onSyncStatus = null;

export function onSyncStatus(cb) { _onSyncStatus = cb; }
function emitStatus(status, detail) {
  if (_onSyncStatus) _onSyncStatus(status, detail);
}

// ══════════════════════════════════════════════════════════════════════
// READ LOCAL DATA from localStorage
// ══════════════════════════════════════════════════════════════════════
function readLocal() {
  return {
    playlists: JSON.parse(localStorage.getItem('tl_playlists') || '[]'),
    likedIds: JSON.parse(localStorage.getItem('tl_liked') || '[]'),
    settings: {
      youtube_api_key: localStorage.getItem('tl_api_key') || '',
      crossfade_sec: parseFloat(localStorage.getItem('tl_crossfade') || '3'),
      autoplay: localStorage.getItem('tl_autoplay') !== 'false',
    },
  };
}

function writeLocal(data) {
  if (data.playlists) {
    localStorage.setItem('tl_playlists', JSON.stringify(data.playlists));
  }
  if (data.likedIds) {
    localStorage.setItem('tl_liked', JSON.stringify(data.likedIds));
  }
  if (data.settings) {
    if (data.settings.youtube_api_key !== undefined) {
      localStorage.setItem('tl_api_key', data.settings.youtube_api_key);
    }
    if (data.settings.crossfade_sec !== undefined) {
      localStorage.setItem('tl_crossfade', String(data.settings.crossfade_sec));
    }
    if (data.settings.autoplay !== undefined) {
      localStorage.setItem('tl_autoplay', String(data.settings.autoplay));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// MERGE LOGIC
// ══════════════════════════════════════════════════════════════════════

// Merge playlists: prefer whichever has more tracks (heuristic for "more complete")
function mergePlaylists(local, remote) {
  const merged = new Map();

  // Index remote by ID
  for (const rp of remote) {
    merged.set(rp.id, { ...rp, _source: 'remote' });
  }

  // Merge local playlists
  for (const lp of local) {
    const existing = merged.get(lp.id);
    if (!existing) {
      // Local-only playlist — push to remote
      merged.set(lp.id, { ...lp, _source: 'local', _needsPush: true });
    } else {
      // Both exist — pick the one with more tracks (better heuristic than timestamp)
      const localCount = lp.tracks?.length || 0;
      const remoteCount = existing.tracks?.length || 0;
      if (localCount >= remoteCount) {
        // Local is more complete — keep it, mark for push
        merged.set(lp.id, { ...lp, _source: 'local', _needsPush: true });
      } else {
        // Remote is more complete — keep it, mark for local write
        merged.set(lp.id, { ...existing, _source: 'remote', _needsLocalWrite: true });
      }
    }
  }

  return Array.from(merged.values());
}

// Merge liked songs: union of both sets
function mergeLiked(local, remote) {
  const set = new Set([...(local || []), ...(remote || [])]);
  return Array.from(set);
}

// Merge settings: prefer non-empty values
function mergeSettings(local, remote) {
  if (!remote) return local;
  return {
    youtube_api_key: local.youtube_api_key || remote.youtube_api_key || '',
    crossfade_sec: local.crossfade_sec || remote.crossfade_sec || 3,
    autoplay: local.autoplay ?? (remote.autoplay ?? true),
  };
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════

// Called after successful login — merges local + remote, writes both sides
export async function syncOnLogin() {
  emitStatus('syncing', 'Syncing your data...');
  try {
    const local = readLocal();
    const remote = await pullAllFromSupabase();

    if (!remote) {
      // First time — push local data
      emitStatus('syncing', 'Uploading your library...');
      await pushAllToSupabase(local);
      _syncEnabled = true;
      startRealtimeSync();
      emitStatus('synced', 'Library synced to cloud');
      return;
    }

    // Merge
    emitStatus('syncing', 'Merging libraries...');
    const mergedPlaylists = mergePlaylists(local.playlists, remote.playlists);
    const mergedLiked = mergeLiked(local.likedIds, remote.likedIds);
    const mergedSettings = mergeSettings(local.settings, remote.settings);

    // Write merged data to localStorage
    writeLocal({
      playlists: mergedPlaylists,
      likedIds: mergedLiked,
      settings: mergedSettings,
    });

    // Push back any local-only or local-wins playlists
    const needsPush = mergedPlaylists.filter(p => p._needsPush || p._source === 'local');
    if (needsPush.length) {
      emitStatus('syncing', `Uploading ${needsPush.length} playlist(s)...`);
      for (const pl of needsPush) {
        const { _needsPush, _source, _syncedAt, ...clean } = pl;
        // Convert remote-format back to local format for push
        await pushPlaylistToCloud(clean);
      }
    }

    // Push merged liked songs
    await pushLikedToCloud(mergedLiked);

    _syncEnabled = true;
    startRealtimeSync();
    emitStatus('synced', `Synced ${mergedPlaylists.length} playlists, ${mergedLiked.length} liked songs`);
  } catch (err) {
    console.error('[sync] login sync failed:', err);
    emitStatus('error', 'Sync failed: ' + err.message);
  }
}

// Called on logout
export function syncOnLogout() {
  _syncEnabled = false;
  unsubscribeFromChanges();
  emitStatus('logged-out', '');
}

// Push a single playlist mutation to the cloud
export async function syncPlaylist(localPl) {
  if (!_syncEnabled) return;
  try {
    const { pushPlaylistToCloud } = await import('./supabase.js');
    await pushPlaylistToCloud(localPl);
  } catch (err) {
    console.error('[sync] playlist push failed:', err);
  }
}

// Push liked songs mutation to the cloud
export async function syncLiked(likedIds) {
  if (!_syncEnabled) return;
  try {
    await pushLikedToCloud(likedIds);
  } catch (err) {
    console.error('[sync] liked push failed:', err);
  }
}

// Push settings mutation to the cloud
export async function syncSettings(settings) {
  if (!_syncEnabled) return;
  try {
    const { upsertSettings } = await import('./supabase.js');
    await upsertSettings(settings);
  } catch (err) {
    console.error('[sync] settings push failed:', err);
  }
}

// ══════════════════════════════════════════════════════════════════════
// REALTIME SYNC
// ══════════════════════════════════════════════════════════════════════

function startRealtimeSync() {
  subscribeToChanges((table, payload) => {
    console.log(`[sync] realtime: ${table} ${payload.eventType}`);
    // On any remote change, re-pull and merge
    // (simple approach — for production, would do targeted merges)
    handleRemoteChange(table, payload);
  });
}

async function handleRemoteChange(table, payload) {
  if (!_syncEnabled) return;
  try {
    const remote = await pullAllFromSupabase();
    if (!remote) return;

    const local = readLocal();
    const mergedPlaylists = mergePlaylists(local.playlists, remote.playlists);
    const mergedLiked = mergeLiked(local.likedIds, remote.likedIds);

    writeLocal({ playlists: mergedPlaylists, likedIds: mergedLiked });
    emitStatus('synced', 'Updated from another device');

    // Notify the UI to re-render
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('tuneless:synced', { detail: { table } }));
    }
  } catch (err) {
    console.error('[sync] remote change handling failed:', err);
  }
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS (local → cloud format conversion)
// ══════════════════════════════════════════════════════════════════════

async function pushPlaylistToCloud(localPl) {
  const { upsertPlaylist } = await import('./supabase.js');
  await upsertPlaylist(localPl);
}

async function pushLikedToCloud(likedIds) {
  const { replaceLikedSongs } = await import('./supabase.js');
  await replaceLikedSongs(likedIds);
}
