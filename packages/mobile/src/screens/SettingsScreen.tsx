// ──────────────────────────────────────────────
// Tuneless — Settings Screen
// API key, crossfade, about
// ─��────────────────────────────────────────────

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';
import { setApiKey } from '../services/youtubeApi';
import Toast from '../components/Toast';

export default function SettingsScreen() {
  const { youtubeApiKey, crossfadeSec, saveApiKey, setCrossfade, clearApiKey } = useSettingsStore();
  const [apiKeyInput, setApiKeyInput] = useState(youtubeApiKey);
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as const });

  const showToast = (m: string, t: 'info' | 'success' | 'warning' | 'error' = 'info') => setToast({ visible: true, message: m, type: t });

  useEffect(() => { if (!isEditing) setApiKeyInput(youtubeApiKey); }, [youtubeApiKey, isEditing]);

  const handleSave = useCallback(async () => {
    const key = apiKeyInput.trim();
    if (!key) { showToast('Enter a valid API key', 'warning'); return; }
    await saveApiKey(key);
    setApiKey(key);
    setIsEditing(false);
    showToast('API key saved', 'success');
  }, [apiKeyInput, saveApiKey]);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.headerTitle}>Settings</Text>

      {/* API Key */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>YouTube API Key</Text>
        <Text style={s.sectionDesc}>Required for search and playback. Free from Google Cloud Console.</Text>
        {youtubeApiKey && !isEditing ? (
          <View style={s.keyDisplay}>
            <Text style={s.keyText} numberOfLines={1}>{youtubeApiKey.slice(0, 8)}...{youtubeApiKey.slice(-4)}</Text>
            <View style={s.row}>
              <TouchableOpacity style={s.editBtn} onPress={() => setIsEditing(true)}><Text style={s.editBtnText}>Edit</Text></TouchableOpacity>
              <TouchableOpacity style={s.clearBtn} onPress={() => { clearApiKey(); setApiKeyInput(''); }}><Text style={s.clearBtnText}>Remove</Text></TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={s.inputC}>
            <TextInput style={s.input} placeholder="AIza..." placeholderTextColor={colors.textMuted} value={apiKeyInput} onChangeText={setApiKeyInput} autoCapitalize="none" autoCorrect={false} />
            <View style={s.row}>
              {isEditing && <TouchableOpacity style={s.cancelBtn} onPress={() => { setIsEditing(false); setApiKeyInput(youtubeApiKey); }}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>}
              <TouchableOpacity style={s.saveBtn} onPress={handleSave}><Text style={s.saveBtnText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        )}
        <TouchableOpacity onPress={() => Linking.openURL('https://console.cloud.google.com/apis/credentials')}>
          <Text style={s.linkText}>Get API Key →</Text>
        </TouchableOpacity>
      </View>

      {/* Crossfade */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Crossfade</Text>
        <View style={s.row}>
          <Text style={s.cfLabel}>{crossfadeSec}s</Text>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {[0, 2, 4, 6, 8, 10].map(v => (
              <TouchableOpacity key={v} style={[s.cfDot, crossfadeSec === v && s.cfDotActive]} onPress={() => setCrossfade(v)}>
                <Text style={[s.cfDotText, crossfadeSec === v && s.cfDotTextActive]}>{v}s</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Text style={s.sectionDesc}>Smooth fade between songs (0 = off)</Text>
      </View>

      {/* About */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>About</Text>
        <View style={s.aboutRow}><Text style={s.aboutLabel}>Version</Text><Text style={s.aboutValue}>1.0.0</Text></View>
        <View style={s.aboutRow}><Text style={s.aboutLabel}>Engine</Text><Text style={s.aboutValue}>NewPipe + yt-dlp</Text></View>
      </View>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onDismiss={() => setToast(p => ({ ...p, visible: false }))} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 120 },
  headerTitle: { ...typography.h1, color: colors.text, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.xxxl },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  sectionDesc: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  keyDisplay: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.lg, marginBottom: spacing.md },
  keyText: { ...typography.mono, color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  editBtn: { backgroundColor: colors.accentBg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: borderRadius.sm },
  editBtnText: { ...typography.body, color: colors.accent, fontWeight: '600' },
  clearBtn: { backgroundColor: 'rgba(231,76,60,0.1)', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: borderRadius.sm },
  clearBtnText: { ...typography.body, color: colors.error, fontWeight: '600' },
  inputC: { marginBottom: spacing.md },
  input: { ...typography.body, color: colors.text, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  cancelBtn: { backgroundColor: colors.surface2, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, borderRadius: borderRadius.sm },
  cancelBtnText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.accent, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, borderRadius: borderRadius.sm },
  saveBtnText: { ...typography.body, color: colors.bg, fontWeight: '600' },
  linkText: { ...typography.body, color: colors.accent, textDecorationLine: 'underline', marginTop: spacing.sm },
  cfLabel: { ...typography.h3, color: colors.text, minWidth: 30 },
  cfDot: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: borderRadius.sm, backgroundColor: colors.surface2 },
  cfDotActive: { backgroundColor: colors.accent },
  cfDotText: { ...typography.bodySmall, color: colors.textSecondary },
  cfDotTextActive: { color: colors.bg, fontWeight: '600' },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  aboutLabel: { ...typography.body, color: colors.textSecondary },
  aboutValue: { ...typography.mono, color: colors.text },
});
