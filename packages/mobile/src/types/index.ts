export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
  audioUrl?: string;
  // For recently played tracking
  playedAt?: number;
  playCount?: number;
}

export interface PlaylistTrack {
  id: string;
  title: string;
  artist: string;
  searchQuery: string;
  ytId: string | null;
  duration: number;
}

export interface Playlist {
  id: string;
  name: string;
  duration: number;
  tracks: PlaylistTrack[];
  createdAt: number;
  updatedAt: number;
  sourceLabel?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
  channel?: string;
  views?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  progress: number;
  duration: number;
  position: number;
}

export interface Settings {
  youtubeApiKey: string;
  crossfadeSec: number;
}

export interface SessionData {
  queue: Track[];
  currentIndex: number;
  timestamp: number;
}

export interface LikedState {
  likedIds: Set<string>;
}

export interface RecommendedTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  source: 'similar' | 'genre' | 'random';
  reason?: string;
}

export type RootStackParamList = {
  MainTabs: undefined;
  FullPlayer: undefined;
  PlaylistDetail: { playlistId: string };
  Queue: undefined;
};

export type MainTabParamList = {
  Search: undefined;
  Discover: undefined;
  Library: undefined;
  Settings: undefined;
};

export interface YouTubeExtractorNative {
  extractAudioUrl(videoId: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}
