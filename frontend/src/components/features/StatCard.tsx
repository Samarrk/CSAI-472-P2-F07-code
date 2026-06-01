import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '@/theme/colors';
import Card from '@/components/ui/Card';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  iconBg?: string;
  iconColor?: string;
  valueColor?: string;
  style?: ViewStyle;
}

export default function StatCard({
  label,
  value,
  subtitle,
  icon,
  iconBg,
  iconColor,
  valueColor,
  style,
}: StatCardProps) {
  return (
    <Card style={[{ flex: 1 }, style]}>
      {icon && (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: iconBg ?? Colors.surface.containerHigh,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 8,
          }}
        >
          <MaterialCommunityIcons
            name={icon}
            size={18}
            color={iconColor ?? Colors.primary.DEFAULT}
          />
        </View>
      )}
      <Text
        style={{
          fontSize: 10,
          fontWeight: '600',
          color: Colors.outline.DEFAULT,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 24,
          fontWeight: '700',
          color: valueColor ?? Colors.surface.on,
        }}
      >
        {value}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontSize: 12,
            color: Colors.outline.DEFAULT,
            marginTop: 2,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </Card>
  );
}
