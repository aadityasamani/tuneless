import TrackPlayer, {
  State,
  Event,
  Capability,
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
} from 'react-native-track-player';
import type { Track } from '../types';

let _initialised = false;

/**
 * Initialise TrackPlayer with Android-specific config.
 */
export async function setupPlayer(): Promise<boolean> {
  if (_initialised) return true;

  try {
    await TrackPlayer.setupPlayer({
      androidAudioContentType: AndroidAudioContentType.Music,
      autoHandleInterruptions: false,
    });

    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
        Capability.SeekTo,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
    });

    _initialised = true;
    return true;
  } catch (error) {
    console.error('Failed to setup TrackPlayer:', error);
    return false;
  }
}

/**
 * Register the playback service that runs in the background.
 */
export function registerPlaybackService() {
  TrackPlayer.registerPlaybackService(() => {
    const { PlaybackService } = require('./PlaybackService');
    return PlaybackService;
  });
}

function toRNTrack(track: Track) {
  return {
    id: track.id,
    url: track.audioUrl || '',
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    artwork: track.thumbnail,
  };
}

export async function playTrack(track: Track): Promise<void> {
  await TrackPlayer.reset();
  await TrackPlayer.add(toRNTrack(track));
  await TrackPlayer.play();
}

export async function setQueue(
  tracks: Track[],
  startIndex: number = 0,
): Promise<void> {
  const rnTracks = tracks.map(toRNTrack);
  await TrackPlayer.reset();
  if (rnTracks.length > 0) {
    await TrackPlayer.add(rnTracks);
    if (startIndex > 0) {
      await TrackPlayer.skip(startIndex);
    }
    await TrackPlayer.play();
  }
}

export async function addToQueue(track: Track): Promise<void> {
  await TrackPlayer.add(toRNTrack(track));
}

export async function getPlaybackState() {
  const state = await TrackPlayer.getPlaybackState();
  const progress = await TrackPlayer.getProgress();

  return {
    isPlaying: state.state === State.Playing,
    isPaused: state.state === State.Paused,
    isBuffering: state.state === State.Buffering,
    progress: progress.duration > 0 ? progress.position / progress.duration : 0,
    duration: progress.duration,
    position: progress.position,
  };
}

export const PlaybackService = async function () {
  // Handlers registered via TrackPlayer.addEventListener in PlaybackService.ts
};
