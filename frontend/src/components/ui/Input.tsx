import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '@/theme/colors';

interface InputProps extends TextInputProps {
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  error?: string;
  isPassword?: boolean;
  containerStyle?: ViewStyle;
  rightElement?: React.ReactNode;
}

export default function Input({
  label,
  icon,
  error,
  isPassword = false,
  containerStyle,
  rightElement,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: Colors.primary.DEFAULT,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: Colors.surface.containerHighest,
          borderRadius: 16,
          paddingHorizontal: 16,
          height: 56,
          borderWidth: 1,
          borderColor: focused ? Colors.primary.DEFAULT : 'transparent',
        }}
      >
        {icon && (
          <MaterialCommunityIcons
            name={icon}
            size={20}
            color={Colors.outline.DEFAULT}
            style={{ marginRight: 12 }}
          />
        )}
        <TextInput
          {...props}
          secureTextEntry={isPassword && !showPassword}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              fontSize: 16,
              color: Colors.surface.on,
            },
            props.style,
          ]}
          placeholderTextColor={Colors.outline.DEFAULT}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
            <MaterialCommunityIcons
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color={Colors.outline.DEFAULT}
            />
          </TouchableOpacity>
        )}
        {!isPassword && rightElement}
      </View>
      {error ? (
        <Text style={{ fontSize: 12, color: Colors.error.DEFAULT, marginTop: 2 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
