export function buildShuffleOrder(length: number, excludeIdx: number): number[] {
  const indices = Array.from({ length }, (_, i) => i).filter(i => i !== excludeIdx);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if (excludeIdx >= 0 && excludeIdx < length) indices.push(excludeIdx);
  return indices;
}

export function spreadAdjacentSameArtist(order: number[], tracks: { artist?: string }[], lockLast: boolean) {
  const limit = lockLast ? order.length - 1 : order.length;
  if (limit < 2) return;
  for (let p = 0; p < limit - 1; p++) {
    const a0 = (tracks[order[p]]?.artist || '').toLowerCase().trim();
    const a1 = (tracks[order[p + 1]]?.artist || '').toLowerCase().trim();
    if (!a0 || !a1 || a0 !== a1) continue;
    for (let q = p + 2; q < Math.min(p + 16, limit); q++) {
      if ((tracks[order[q]]?.artist || '').toLowerCase().trim() !== a0) {
        [order[p + 1], order[q]] = [order[q], order[p + 1]];
        break;
      }
    }
  }
}
