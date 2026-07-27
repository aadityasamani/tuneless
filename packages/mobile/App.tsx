// ──────────────────────────────────────────────
// Tuneless — Root App
// SafeAreaProvider, StatusBar, setup player on mount,
// load settings/playlists, render navigation.
// ──────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { StatusBar, View, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from './src/theme/colors';
import { typography } from './src/theme/typography';
import { spacing } from './src/theme/spacing';

// Stores
import { useSettingsStore } from './src/stores/settingsStore';
import { usePlaylistStore } from './src/stores/playlistStore';
import { usePlayerStore } from './src/stores/playerStore';
import { useLikesStore } from './src/stores/likesStore';

// Services
import { setupPlayer, registerPlaybackService } from './src/services/playerSetup';
import { setApiKey, hasApiKey } from './src/services/youtubeApi';

// Navigation
import RootNavigator from './src/navigation/RootNavigator';
import MiniPlayer from './src/components/MiniPlayer';

/** Register the playback service once at module level */
registerPlaybackService();

function AppContent() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);

  // Stores
  const { loadSettings, youtubeApiKey, loaded: settingsLoaded } = useSettingsStore();
  const { load: loadPlaylists, loaded: playlistsLoaded } = usePlaylistStore();
  const { load: loadLikes } = useLikesStore();
  const { isPlaying, currentIndex } = usePlayerStore();

  useEffect(() => {
    async function init() {
      try {
        // 1. Load persisted settings
        await loadSettings();

        // 2. Load persisted playlists
        await loadPlaylists();
        await loadLikes();

        // 3. Setup the track player
        await setupPlayer();

        // 4. Sync API key into the youtubeApi module
        const store = useSettingsStore.getState();
        if (store.youtubeApiKey) {
          setApiKey(store.youtubeApiKey);
        }

        setReady(true);
      } catch (error) {
        console.error('Failed to initialise Tuneless:', error);
        setReady(true); // Still render the app, just warn
      }
    }

    init();
  }, []);

  // Sync API key whenever it changes in settings
  useEffect(() => {
    if (settingsLoaded && youtubeApiKey) {
      setApiKey(youtubeApiKey);
    }
  }, [youtubeApiKey, settingsLoaded]);

  // Loading splash
  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashIcon}>♪</Text>
        <Text style={styles.splashTitle}>Tuneless</Text>
        <Text style={styles.splashSubtitle}>Loading...</Text>
      </View>
    );
  }

  const hasActiveTrack = currentIndex >= 0;

  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: colors.accent,
          background: colors.bg,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.accent,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '800' },
        },
      }}
    >
      <View style={styles.appContainer}>
        <RootNavigator />

        {/* Persistent MiniPlayer (shown when a track is active) */}
        {hasActiveTrack && (
          <View style={[styles.miniPlayerWrapper, { bottom: 0 }]}>
            <MiniPlayer onPress={() => setFullPlayerOpen(true)} />
          </View>
        )}
      </View>
    </NavigationContainer>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.bg}
        translucent={false}
      />
      <AppContent />
    </SafeAreaProvider>
  );
}

export default App;

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIcon: {
    fontSize: 64,
    color: colors.accent,
    marginBottom: spacing.lg,
  },
  splashTitle: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  splashSubtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  appContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  miniPlayerWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
