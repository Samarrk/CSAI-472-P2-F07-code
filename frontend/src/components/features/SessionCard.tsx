import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DrivingSession } from '@/types';
import { formatDate, formatDuration, getScoreColor } from '@/utils/formatters';
import Colors from '@/theme/colors';
import Card from '@/components/ui/Card';

interface SessionCardProps {
  session: DrivingSession;
  variant?: 'compact' | 'full';
  onPress?: () => void;
}

export default function SessionCard({
  session,
  variant = 'compact',
  onPress,
}: SessionCardProps) {
  if (variant === 'compact') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
          {/* Thumbnail */}
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: Colors.surface.containerHighest,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {session.thumbnailUrl ? (
              <Image
                source={{ uri: session.thumbnailUrl }}
                style={{ width: 48, height: 48 }}
              />
            ) : (
              <MaterialCommunityIcons
                name="car"
                size={24}
                color={Colors.outline.DEFAULT}
              />
            )}
          </View>

          {/* Info */}
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: Colors.surface.on,
              }}
            >
              {session.title}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: Colors.outline.DEFAULT,
                marginTop: 2,
              }}
            >
              {formatDate(session.startedAt)} • {formatDuration(session.durationMinutes)}
            </Text>
          </View>

          {/* Score */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                color: getScoreColor(session.score),
              }}
            >
              {session.score}
            </Text>
            <Text
              style={{
                fontSize: 9,
                fontWeight: '700',
                color: getScoreColor(session.score),
                letterSpacing: 0.5,
              }}
            >
              {session.scoreLabel}
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  }

  // Full card with video thumbnail
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <View
          style={{
            height: 180,
            backgroundColor: Colors.surface.containerHighest,
            position: 'relative',
          }}
        >
          {session.thumbnailUrl ? (
            <Image
              source={{ uri: session.thumbnailUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                flex: 1,
                backgroundColor: '#1a2020',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="play-circle" size={48} color="rgba(255,255,255,0.6)" />
            </View>
          )}

          {/* Overlay */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: 12,
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
              {session.title}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 }}>
              {formatDate(session.startedAt)} • {formatDuration(session.durationMinutes)}
            </Text>
          </View>

          {/* Score pill */}
          <View
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              backgroundColor: Colors.primary.container,
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
              {session.score.toFixed(1)} Score
            </Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
}
