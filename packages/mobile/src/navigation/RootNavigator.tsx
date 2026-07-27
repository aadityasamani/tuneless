// ──────────────────────────────────────────────
// Tuneless — Root Navigator
// Bottom tabs (Discover, Search, Library, Settings) + modals
// ──────────────────────────────────────────────

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, tabBarHeight } from '../theme/spacing';
import type { RootStackParamList, MainTabParamList } from '../types';

import SearchScreen from '../screens/SearchScreen';
import LibraryScreen from '../screens/LibraryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import FullPlayerScreen from '../screens/FullPlayerScreen';
import PlaylistDetailScreen from '../screens/PlaylistDetailScreen';
import QueueScreen from '../screens/QueueScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Discover: '✦',
    Search: '⌕',
    Library: '≡',
    Settings: '○',
  };
  return <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>{icons[name] || '○'}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarStyle: styles.tabBar,
      tabBarLabelStyle: styles.tabLabel,
      tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.textMuted,
    })}>
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_bottom' }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="FullPlayer" component={FullPlayerScreen} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="Queue" component={QueueScreen} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, height: tabBarHeight, paddingBottom: 4, paddingTop: spacing.xs },
  tabLabel: { ...typography.monoSmall, fontSize: 10 },
  tabIcon: { fontSize: 18 },
  tabIconActive: { fontSize: 20 },
});
