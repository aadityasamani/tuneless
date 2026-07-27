// ──────────────────────────────────────────────
// Tuneless — Toast Component
// Animated snackbar notification.
// ──────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, borderRadius } from '../theme/spacing';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  duration?: number; // ms, default 3000
  onDismiss: () => void;
}

const BG_COLORS: Record<ToastType, string> = {
  info: colors.surface2,
  success: '#1a3a1a',
  warning: '#3a2a1a',
  error: '#3a1a1a',
};

const TEXT_COLORS: Record<ToastType, string> = {
  info: colors.text,
  success: '#4caf50',
  warning: colors.warning,
  error: colors.error,
};

export default function Toast({
  message,
  type = 'info',
  visible,
  duration = 3000,
  onDismiss,
}: ToastProps) {
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Animate in
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto dismiss
      const timer = setTimeout(() => {
        dismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: BG_COLORS[type],
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Text style={[styles.message, { color: TEXT_COLORS[type] }]}>
        {message}
      </Text>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[styles.dismiss, { color: TEXT_COLORS[type] }]}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 9999,
  },
  message: {
    ...typography.body,
    flex: 1,
    marginRight: spacing.sm,
  },
  dismiss: {
    fontSize: 14,
    fontWeight: '700',
    paddingLeft: spacing.sm,
  },
});
