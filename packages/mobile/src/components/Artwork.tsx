// ──────────────────────────────────────────────
// Tuneless — Artwork Component
// Image with fallback music note icon.
// ──────────────────────────────────────────────

import React, { useState } from 'react';
import {
  Image,
  View,
  StyleSheet,
  type ImageStyle,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { colors } from '../theme/colors';

interface ArtworkProps {
  uri?: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Border radius override (defaults to size/4) */
  borderRadius?: number;
}

export default function Artwork({
  uri,
  size,
  style,
  imageStyle,
  borderRadius,
}: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const radius = borderRadius ?? size / 4;

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: radius },
        style,
      ]}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={[
            styles.image,
            { width: size, height: size, borderRadius: radius },
            imageStyle,
          ]}
          onError={() => setFailed(true)}
          resizeMode="cover"
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: radius },
          ]}
        >
          {/* Music note icon (simple SVG equivalent) */}
          <MusicNoteIcon size={size * 0.4} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

/** Simple music note icon drawn with view + border tricks */
function MusicNoteIcon({
  size,
  color,
}: {
  size: number;
  color: string;
}) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Note head (circle) */}
      <View
        style={{
          width: size * 0.55,
          height: size * 0.55,
          borderRadius: size * 0.275,
          borderWidth: 2.5,
          borderColor: color,
          position: 'absolute',
          bottom: size * 0.05,
          left: size * 0.05,
        }}
      />
      {/* Stem */}
      <View
        style={{
          width: 2.5,
          height: size * 0.7,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.05,
          left: size * 0.5,
        }}
      />
      {/* Flag */}
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.25,
          borderLeftColor: color,
          borderTopWidth: size * 0.12,
          borderTopColor: 'transparent',
          borderBottomWidth: size * 0.12,
          borderBottomColor: 'transparent',
          position: 'absolute',
          bottom: size * 0.55,
          left: size * 0.5,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  image: {
    resizeMode: 'cover',
  },
  fallback: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
