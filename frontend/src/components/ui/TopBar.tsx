import React from 'react';
import { View, TouchableOpacity, Text, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/theme/colors';

interface TopBarProps {
  showBack?: boolean;
  showLogo?: boolean;
  rightContent?: React.ReactNode;
  style?: ViewStyle;
  title?: string;
  onBack?: () => void;
}

export default function TopBar({
  showBack = false,
  showLogo = true,
  rightContent,
  style,
  title,
  onBack,
}: TopBarProps) {
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 24,
          paddingVertical: 12,
          backgroundColor: 'transparent',
        },
        style,
      ]}
    >
      {/* Left — back button or spacer */}
      <View style={{ width: 40 }}>
        {showBack && (
          <TouchableOpacity onPress={handleBack} hitSlop={12}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={Colors.surface.on}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Center — logo text or title */}
      {showLogo ? (
        <View style={{ alignItems: 'center' }}>
          {/* Replaced by real logo asset in a later batch */}
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: Colors.primary.DEFAULT,
            }}
          >
            Tamakkan
          </Text>
        </View>
      ) : title ? (
        <Text
          style={{
            fontSize: 16,
            fontWeight: '600',
            color: Colors.surface.on,
          }}
        >
          {title}
        </Text>
      ) : (
        <View />
      )}

      {/* Right */}
      <View style={{ alignItems: 'flex-end', minWidth: 40 }}>
        {rightContent}
      </View>
    </View>
  );
}
