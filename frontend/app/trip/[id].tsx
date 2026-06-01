import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import Colors from '@/theme/colors';
import { DrivingSession, Mistake } from '@/types';
import { formatDate, formatDuration, getScoreColor } from '@/utils/formatters';
import { getTripCache } from '@/utils/tripCache';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Module-level maps so they're not recreated on every AlertRow render.
const MISTAKE_ICONS: Record<string, IconName> = {
  lane_departure: 'road-variant',
  tailgating:     'car-multiple',
  red_light:      'traffic-light',
  near_miss:      'car-emergency',
};

const SEVERITY_COLOR: Record<string, string> = {
  medium:   Colors.tertiary.DEFAULT,
  high:     Colors.error.DEFAULT,
  critical: Colors.error.DEFAULT,
};

//  Sub-components 

function VideoSection({ videoUrl }: { videoUrl?: string }) {
  const videoRef = useRef<Video>(null);
  const [videoStatus, setVideoStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  if (!videoUrl) {
    return (
      <View style={styles.videoBox}>
        <MaterialCommunityIcons name="video-outline" size={40} color="rgba(255,255,255,0.4)" />
        <Text style={styles.videoTitle}>Video Not Available Yet</Text>
        <Text style={styles.videoSub}>
          Session recordings will appear here once the dashcam backend is connected.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoBox}>
      <Video
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        source={{ uri: videoUrl }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        isLooping={false}
        onLoad={() => setVideoStatus('ready')}
        onError={() => setVideoStatus('error')}
      />
      {videoStatus === 'loading' && <ActivityIndicator color="#fff" size="large" />}
      {videoStatus === 'error' && (
        <>
          <MaterialCommunityIcons name="video-off-outline" size={40} color="rgba(255,255,255,0.4)" />
          <Text style={styles.videoTitle}>Could not load video</Text>
        </>
      )}
    </View>
  );
}

function StatCell({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <MaterialCommunityIcons name={icon} size={18} color={Colors.outline.DEFAULT} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function AlertRow({ mistake }: { mistake: Mistake }) {
  const icon = MISTAKE_ICONS[mistake.type] ?? 'alert-circle-outline';
  const color = SEVERITY_COLOR[mistake.severity] ?? Colors.tertiary.DEFAULT;
  const mins = Math.floor(mistake.timestamp / 60);
  const secs = mistake.timestamp % 60;

  return (
    <View style={styles.alertRow}>
      <View style={[styles.alertIcon, { backgroundColor: `${color}18` }]}>
        <MaterialCommunityIcons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.alertLabel}>{mistake.label}</Text>
        <Text style={styles.alertTime}>at {mins}:{String(secs).padStart(2, '0')}</Text>
      </View>
      <View style={[styles.severityPill, { backgroundColor: `${color}18`, borderColor: color }]}>
        <Text style={[styles.severityText, { color }]}>{mistake.severity}</Text>
      </View>
    </View>
  );
}

//  Screen 

export default function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? 'u_001');
  const storeSessions = useSessionStore((s) => s.sessions);

  // Initializer tries the in-memory store first — avoids an AsyncStorage read when the user
  // navigates here directly from the session list where data is already loaded.
  const [session, setSession] = useState<DrivingSession | null>(
    () => storeSessions.find((s) => s.id === id) ?? null,
  );
  // loading starts false when we already have the session from the store.
  const [loading, setLoading] = useState(session === null);

  useEffect(() => {
    if (session !== null) return;
    (async () => {
      const cached = await getTripCache(userId);
      setSession(cached.find((s) => s.id === id) ?? null);
      setLoading(false);
    })();
  }, [id, userId, session]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary.DEFAULT} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <MaterialCommunityIcons name="car-off" size={48} color={Colors.outline.DEFAULT} />
        <Text style={styles.notFound}>Trip not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.goBack}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const scoreColor = getScoreColor(session.score);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={22} color={Colors.surface.on} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{session.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Video */}
        <VideoSection videoUrl={session.videoUrl} />

        {/* Section label */}
        <Text style={styles.sectionLabel}>Session Summary</Text>

        {/* Score card */}
        <View style={styles.card}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreBig, { color: scoreColor }]}>{session.score.toFixed(1)}</Text>
            <Text style={[styles.scoreOf, { color: scoreColor }]}>/5</Text>
          </View>
          <Text style={[styles.scoreLabel, { color: scoreColor }]}>{session.scoreLabel}</Text>
        </View>

        {/* Stats row */}
        <View style={[styles.card, styles.statsCard]}>
          <StatCell icon="calendar-outline" label="Date" value={formatDate(session.startedAt)} />
          <View style={styles.statDivider} />
          <StatCell icon="clock-outline" label="Time" value={formatTime(session.startedAt)} />
          <View style={styles.statDivider} />
          <StatCell icon="timer-outline" label="Duration" value={formatDuration(session.durationMinutes)} />
        </View>

        {/* Alerts */}
        <View style={styles.card}>
          {session.mistakes.length === 0 ? (
            <View style={styles.cleanDrive}>
              <View style={styles.cleanIcon}>
                <MaterialCommunityIcons name="check-circle" size={36} color={Colors.secondary.DEFAULT} />
              </View>
              <Text style={styles.cleanText}>Clean drive — no alerts!</Text>
            </View>
          ) : (
            <>
              <Text style={styles.alertsTitle}>
                {session.mistakes.length} Alert{session.mistakes.length !== 1 ? 's' : ''}
              </Text>
              {session.mistakes.map((m, i) => (
                <React.Fragment key={m.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <AlertRow mistake={m} />
                </React.Fragment>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFound: { fontSize: 16, color: Colors.outline.DEFAULT, fontWeight: '500' },
  goBack: { fontSize: 15, color: Colors.primary.DEFAULT, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 56,
    backgroundColor: Colors.surface.containerLowest,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.containerHigh,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surface.containerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: Colors.surface.on,
    flex: 1, textAlign: 'center',
  },
  videoBox: {
    height: 210, backgroundColor: '#1c2626',
    alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 32,
  },
  videoTitle: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  videoSub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  scroll: { gap: 12 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.outline.DEFAULT,
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 20, paddingTop: 4,
  },
  card: {
    backgroundColor: Colors.surface.containerLowest,
    marginHorizontal: 16, borderRadius: 20, padding: 20,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  scoreBig: { fontSize: 52, fontWeight: '800', lineHeight: 56 },
  scoreOf: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  scoreLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  statsCard: { flexDirection: 'row', paddingVertical: 16, paddingHorizontal: 8 },
  statCell: { flex: 1, alignItems: 'center', gap: 5 },
  statLabel: { fontSize: 11, color: Colors.outline.DEFAULT, fontWeight: '500' },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.surface.on },
  statDivider: { width: 1, backgroundColor: Colors.surface.containerHigh, marginVertical: 4 },
  alertsTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.outline.DEFAULT,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12,
  },
  cleanDrive: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  cleanIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: `${Colors.secondary.DEFAULT}18`,
    alignItems: 'center', justifyContent: 'center',
  },
  cleanText: { fontSize: 15, fontWeight: '600', color: Colors.secondary.DEFAULT },
  divider: { height: 1, backgroundColor: Colors.surface.containerHigh, marginVertical: 2 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  alertIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  alertLabel: { fontSize: 14, fontWeight: '600', color: Colors.surface.on },
  alertTime: { fontSize: 12, color: Colors.outline.DEFAULT, marginTop: 2 },
  severityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  severityText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
});
