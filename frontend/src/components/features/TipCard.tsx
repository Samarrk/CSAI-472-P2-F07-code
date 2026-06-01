import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '@/theme/colors';

interface TipCardProps {
  tip: string;
  title?: string;
  style?: ViewStyle;
}

export default function TipCard({ tip, title = 'Daily Driving Tip', style }: TipCardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: Colors.primary.container,
          borderRadius: 24,
          padding: 16,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <MaterialCommunityIcons
          name="lightbulb-outline"
          size={16}
          color="rgba(255,255,255,0.9)"
        />
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 14,
          lineHeight: 22,
          color: '#fff',
          fontWeight: '400',
        }}
      >
        {tip}
      </Text>
    </View>
  );
}
