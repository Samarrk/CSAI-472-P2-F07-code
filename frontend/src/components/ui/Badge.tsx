import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import Colors from '@/theme/colors';

export type BadgeVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'outline'
  | 'success'
  | 'connected';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  dot?: boolean;
}

const STYLES: Record<BadgeVariant, { bg: string; text: string; border?: string }> = {
  primary: { bg: Colors.primary.container, text: Colors.primary.onContainer },
  secondary: { bg: Colors.secondary.container, text: Colors.secondary.onContainer },
  tertiary: { bg: Colors.tertiary.container, text: Colors.tertiary.onContainer },
  error: { bg: Colors.error.container, text: Colors.error.onContainer },
  outline: { bg: 'transparent', text: Colors.primary.DEFAULT, border: Colors.primary.DEFAULT },
  success: { bg: '#dcfce7', text: '#14532d' },
  connected: { bg: '#e8f5e9', text: '#1b5e20', border: '#4caf50' },
};

export default function Badge({
  label,
  variant = 'primary',
  style,
  dot = false,
}: BadgeProps) {
  const s = STYLES[variant];

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 999,
          backgroundColor: s.bg,
          borderWidth: s.border ? 1 : 0,
          borderColor: s.border ?? 'transparent',
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      {dot && (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: s.text,
          }}
        />
      )}
      <Text
        style={{
          fontSize: 11,
          fontWeight: '600',
          color: s.text,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
