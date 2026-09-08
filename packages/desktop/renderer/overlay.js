let allPlaylists = [];
let filteredPlaylists = [];
let selectedIndex = -1; // -1 represents the Quick Action card
let currentTrack = null;
let isPlaying = false;

const searchInput = document.getElementById('playlist-search');
const playlistList = document.getElementById('playlist-list');
const quickActionCard = document.getElementById('quick-action-card');
const qaTitle = document.getElementById('qa-title');
const qaSub = document.getElementById('qa-sub');

// Mini player elements
const npThumb = document.getElementById('np-thumb');
const npFallback = document.getElementById('np-thumb-fallback');
const npTitle = document.getElementById('np-title');
const npArtist = document.getElementById('np-artist');
const npPlayIcon = document.getElementById('np-play-icon');

// Listen for state from Electron main process
if (window.overlayApi) {
  window.overlayApi.onState((state) => {
    if (!state) return;
    if (state.playlists) {
      allPlaylists = state.playlists;
      applyFilter();
    }
    if (state.currentTrack !== undefined) {
      currentTrack = state.currentTrack;
    }
    if (state.isPlaying !== undefined) {
      isPlaying = !!state.isPlaying;
    }
    updateMiniPlayer();
  });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function updateMiniPlayer() {
  if (!currentTrack) {
    npThumb.style.display = 'none';
    npFallback.style.display = 'flex';
    npTitle.textContent = 'Nothing playing';
    npArtist.textContent = 'Tuneless is idle';
    npPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    return;
  }

  if (currentTrack.thumb) {
    npThumb.src = currentTrack.thumb;
    npThumb.style.display = 'block';
    npFallback.style.display = 'none';
  } else {
    npThumb.style.display = 'none';
    npFallback.style.display = 'flex';
  }

  npTitle.textContent = currentTrack.title || currentTrack.name || 'Unknown';
  npArtist.textContent = currentTrack.artist || 'Unknown';

  if (isPlaying) {
    npPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    npPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  }
}

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    filteredPlaylists = [...allPlaylists];
  } else {
    filteredPlaylists = allPlaylists.filter(pl =>
      (pl.name || '').toLowerCase().includes(query)
    );
  }

  // Update quick action display
  const primaryPl = allPlaylists.find(p => p.id === '__liked') || allPlaylists[0];
  if (primaryPl) {
    qaTitle.textContent = `Shuffle "${primaryPl.name}"`;
    qaSub.innerHTML = `${primaryPl.trackCount || primaryPl.tracks?.length || 0} tracks &middot; Instant shuffle`;
  }

  renderList();
}

function renderList() {
  if (!filteredPlaylists.length) {
    playlistList.innerHTML = '<div class="empty-state">No matching playlists found</div>';
    return;
  }

  playlistList.innerHTML = filteredPlaylists.map((pl, idx) => {
    const isSelected = selectedIndex === idx;
    const shortcutNum = idx < 9 ? (idx + 1) : '';
    const trackCount = pl.trackCount || (pl.tracks ? pl.tracks.length : 0);
    const thumb = pl.tracks && pl.tracks[0]?.thumb;

    return `
      <div class="pl-item ${isSelected ? 'selected' : ''}" 
           data-index="${idx}" 
           onclick="playPlaylistAt(${idx})"
           onmouseenter="setSelection(${idx})">
        ${shortcutNum ? `<span class="pl-shortcut">${shortcutNum}</span>` : '<span class="pl-shortcut"></span>'}
        <div class="pl-thumb-wrap">
          ${thumb ? `<img class="pl-thumb" src="${esc(thumb)}" alt="" loading="lazy">` : `<span class="pl-thumb-fallback">🎵</span>`}
        </div>
        <div class="pl-info">
          <div class="pl-name">${esc(pl.name)}</div>
          <div class="pl-tracks">${trackCount} tracks</div>
        </div>
        <div class="pl-actions">
          <span class="pl-shuffle-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
            Shuffle
          </span>
        </div>
      </div>
    `;
  }).join('');

  updateSelectionUI();
}

function setSelection(idx) {
  selectedIndex = idx;
  updateSelectionUI();
}

function updateSelectionUI() {
  if (selectedIndex === -1) {
    quickActionCard.classList.add('selected');
  } else {
    quickActionCard.classList.remove('selected');
  }

  const items = playlistList.querySelectorAll('.pl-item');
  items.forEach((item, i) => {
    if (i === selectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function playPlaylistAt(idx) {
  const pl = filteredPlaylists[idx];
  if (!pl) return;
  if (window.overlayApi) {
    window.overlayApi.playPlaylist({ plId: pl.id, shuffle: true });
  }
}

function triggerCurrentSelection() {
  if (selectedIndex === -1) {
    // Quick action: primary playlist or Liked Songs
    const primaryPl = allPlaylists.find(p => p.id === '__liked') || allPlaylists[0];
    if (primaryPl && window.overlayApi) {
      window.overlayApi.playPlaylist({ plId: primaryPl.id, shuffle: true });
    }
  } else if (selectedIndex >= 0 && selectedIndex < filteredPlaylists.length) {
    playPlaylistAt(selectedIndex);
  }
}

// Quick action card click
quickActionCard.addEventListener('click', () => {
  selectedIndex = -1;
  triggerCurrentSelection();
});

// Search input typing
searchInput.addEventListener('input', () => {
  selectedIndex = searchInput.value.trim() ? 0 : -1;
  applyFilter();
});

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (window.overlayApi) window.overlayApi.close();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < filteredPlaylists.length - 1) {
      selectedIndex++;
      updateSelectionUI();
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex > -1) {
      selectedIndex--;
      updateSelectionUI();
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    triggerCurrentSelection();
    return;
  }

  // Number shortcuts 1-9 (only when search input isn't focused or is empty)
  if (!searchInput.value && e.key >= '1' && e.key <= '9') {
    const numIdx = parseInt(e.key, 10) - 1;
    if (numIdx < filteredPlaylists.length) {
      e.preventDefault();
      playPlaylistAt(numIdx);
      return;
    }
  }
});

// Mini player actions
function togglePlay() {
  if (window.overlayApi) window.overlayApi.togglePlay();
}
function nextTrack() {
  if (window.overlayApi) window.overlayApi.nextTrack();
}
function prevTrack() {
  if (window.overlayApi) window.overlayApi.prevTrack();
}
function openFullApp() {
  if (window.overlayApi) window.overlayApi.openFullApp();
}

// Auto-focus search input on window appearance
window.addEventListener('focus', () => {
  searchInput.focus();
  searchInput.select();
});
