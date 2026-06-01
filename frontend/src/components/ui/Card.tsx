import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import Colors from '@/theme/colors';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  radius?: number;
}

export default function Card({
  children,
  style,
  padded = true,
  radius = 24,
}: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: Colors.surface.containerLowest,
          borderRadius: radius,
          padding: padded ? 16 : 0,
          shadowColor: Colors.primary.tint,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.06,
          shadowRadius: 20,
          elevation: 3,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
