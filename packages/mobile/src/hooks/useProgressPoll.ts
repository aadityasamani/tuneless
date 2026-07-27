// ──────────────────────────────────────────────
// Tuneless — useProgressPoll hook
// Polls the player progress on a timer while playing.
// ──────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/playerStore';

/**
 * Hook that polls player progress at a given interval
 * while the player is playing. Unsubscribes on unmount
 * or when paused.
 *
 * @param intervalMs - Polling interval in ms (default 500)
 */
export function useProgressPoll(intervalMs: number = 500) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const updateProgress = usePlayerStore((s) => s.updateProgress);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        updateProgress();
      }, intervalMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, intervalMs, updateProgress]);
}
