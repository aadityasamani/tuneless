// ──────────────────────────────────────────────
// Tuneless — ProgressSlider Component
// Seekable draggable progress bar using PanResponder.
// ──────────────────────────────────────────────

import React, { useRef, useCallback } from 'react';
import { View, PanResponder, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { colors } from '../theme/colors';
import { borderRadius } from '../theme/spacing';

interface ProgressSliderProps {
  progress: number; // 0–1
  onSeek: (fraction: number) => void;
  /** Height of the bar track (default 6) */
  height?: number;
  /** Whether the slider is interactive (default true) */
  disabled?: boolean;
}

export default function ProgressSlider({
  progress,
  onSeek,
  height = 6,
  disabled = false,
}: ProgressSliderProps) {
  const trackWidth = useRef(0);
  const trackX = useRef(0);

  const clamp = useCallback(
    (val: number) => Math.max(0, Math.min(1, val)),
    [],
  );

  const getFraction = useCallback(
    (pageX: number) => {
      if (trackWidth.current <= 0) return 0;
      const relativeX = pageX - trackX.current;
      return clamp(relativeX / trackWidth.current);
    },
    [clamp],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        const fraction = getFraction(evt.nativeEvent.pageX);
        onSeek(fraction);
      },
      onPanResponderMove: (evt) => {
        const fraction = getFraction(evt.nativeEvent.pageX);
        onSeek(fraction);
      },
      onPanResponderRelease: (evt) => {
        const fraction = getFraction(evt.nativeEvent.pageX);
        onSeek(fraction);
      },
    }),
  ).current;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, x } = e.nativeEvent.layout;
    trackWidth.current = width;
    trackX.current = x;
  }, []);

  const fillFraction = Math.max(0, Math.min(1, progress));
  const fillPct = `${fillFraction * 100}%`;
  const thumbVisible = !disabled && progress > 0;

  return (
    <View
      style={[styles.container, { height: height + 12 }]}
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      {/* Track background */}
      <View
        style={[
          styles.track,
          {
            height,
            borderRadius: height / 2,
          },
        ]}
      >
        {/* Filled portion */}
        <View
          style={[
            styles.fill,
            {
              width: fillPct as any,
              height,
              borderRadius: height / 2,
            },
          ]}
        />
      </View>

      {/* Thumb */}
      {thumbVisible && (
        <View
          style={[
            styles.thumb,
            {
              left: fillPct as any,
              width: height + 10,
              height: height + 10,
              borderRadius: (height + 10) / 2,
              marginLeft: -(height + 10) / 2,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    paddingVertical: 6,
  },
  track: {
    backgroundColor: colors.progressBg,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: colors.progressFill,
  },
  thumb: {
    position: 'absolute',
    backgroundColor: colors.accent,
    top: '50%' as any,
    transform: [{ translateY: -50 }],
    // left and marginLeft set dynamically
  },
});
