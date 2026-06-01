import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/theme/colors';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
  height?: number;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  textStyle,
  fullWidth = true,
  height = 56,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[
          { borderRadius: 16, overflow: 'hidden', width: fullWidth ? '100%' : undefined },
          style,
        ]}
      >
        <LinearGradient
          colors={
            isDisabled
              ? ['#9ecece', '#9ecece']
              : [Colors.primary.DEFAULT, Colors.primary.container]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            height,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingHorizontal: 24,
          }}
        >
          {icon}
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              style={[
                { color: '#fff', fontSize: 16, fontWeight: '600' },
                textStyle,
              ]}
            >
              {label}
            </Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  if (variant === 'secondary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.8}
        style={[
          {
            height,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: isDisabled ? Colors.outline.variant : Colors.primary.DEFAULT,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingHorizontal: 24,
            width: fullWidth ? '100%' : undefined,
          },
          style,
        ]}
      >
        {icon}
        {loading ? (
          <ActivityIndicator color={Colors.primary.DEFAULT} />
        ) : (
          <Text
            style={[
              {
                color: isDisabled ? Colors.outline.DEFAULT : Colors.primary.DEFAULT,
                fontSize: 16,
                fontWeight: '600',
              },
              textStyle,
            ]}
          >
            {label}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  // ghost
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        {
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 16,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
    >
      {icon}
      <Text
        style={[
          {
            color: isDisabled ? Colors.outline.DEFAULT : Colors.primary.DEFAULT,
            fontSize: 14,
            fontWeight: '500',
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
