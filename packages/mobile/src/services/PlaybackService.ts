// ──────────────────────────────────────────────
// Tuneless — PlaybackService
// Background playback event handlers for Android/iOS.
// Registered in playerSetup.ts via TrackPlayer.registerPlaybackService.
// ──────────────────────────────────────────────

import TrackPlayer, { Event, type Track } from 'react-native-track-player';

/**
 * The playback service handles background audio events.
 * This runs in a separate context (headless JS on Android).
 */
export default async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious();
  });

  TrackPlayer.addEventListener(
    Event.RemoteSeek,
    async ({ position }: { position: number }) => {
      await TrackPlayer.seekTo(position);
    },
  );

  TrackPlayer.addEventListener(
    Event.RemoteDuck,
    async ({ paused, permanent }: { paused: boolean; permanent: boolean }) => {
      if (permanent) {
        await TrackPlayer.stop();
      } else if (paused) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    },
  );

  // Playback queue ended — handled by the playerStore
  // via polling syncFromTrackPlayer and onTrackEnded
}
