import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { getStats, getDailyTip } from '@/services/api';
import { getTripCache } from '@/utils/tripCache';
import ScoreRing from '@/components/features/ScoreRing';
import { formatDate, formatDuration, getScoreColor } from '@/utils/formatters';
import { DrivingSession } from '@/types';

// Defined at module level so it isn't recreated on every render inside the component.
const severityColor = (s: 'medium' | 'high' | 'critical') =>
  s === 'high' || s === 'critical' ? Colors.error.DEFAULT
  : Colors.tertiary.DEFAULT;

const formatMistakeTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function SessionCard({ session }: { session: DrivingSession }) {
  const scoreColor = getScoreColor(session.score);
  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionThumb}>
        <MaterialCommunityIcons name="car-side" size={22} color={Colors.primary.container} />
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionTitle} numberOfLines={1}>{session.title}</Text>
        <Text style={styles.sessionMeta}>
          {formatDate(session.startedAt)} · {formatDuration(session.durationMinutes)}
        </Text>
      </View>
      <View style={styles.sessionScoreCol}>
        <Text style={[styles.sessionScoreNum, { color: scoreColor }]}>{session.score.toFixed(1)}</Text>
        <Text style={styles.sessionScoreLabel}>{session.scoreLabel}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const {
    dashcamConnected,
    dashcamDevice,
    sessions,
    stats,
    dailyTip,
    setSessions,
    setStats,
    setDailyTip,
  } = useSessionStore();

  const firstName = (user?.name ?? '').split(' ')[0] || 'User';
  const [showVideoModal, setShowVideoModal] = useState(false);

  // user.id (stable primitive) instead of user (new object reference each render) prevents
  // this effect from re-firing every time the auth store selector returns a fresh object.
  // Cache, stats, and tip all fire in parallel — none of them depends on the other.
  useEffect(() => {
    if (!user) return;
    getTripCache(user.id).then((cached) => {
      if (cached.length > 0) setSessions(cached);
    }).catch(() => {});
    getStats(user.id).then(setStats).catch(() => {});
    getDailyTip().then(setDailyTip).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // sessions[0] is always the most recent because sessionStore.stopSession prepends new entries.
  const lastSession = sessions[0] ?? null;
  const averageScore = sessions.length > 0
    ? Number((sessions.reduce((s, d) => s + d.score, 0) / sessions.length).toFixed(2))
    : 0;
  const totalDrives = sessions.length;
  const totalAlerts = sessions.reduce((sum, s) => sum + s.mistakes.length, 0);
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Hardcoded fallback so the tip card is never empty even when the API call fails.
  const tipText =
    dailyTip?.content ??
    'Maintaining a 3-second gap from the car ahead reduces harsh braking by 40%.';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <AppLogo size="mini" />
        <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={12} style={styles.avatar}>
          <MaterialCommunityIcons name="account" size={22} color={Colors.primary.container} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View style={styles.greeting}>
          <View style={styles.greetingRow}>
            <Text style={styles.greetingName}>Hello, {firstName}!</Text>
            {dashcamConnected && (
              <View style={styles.connectedBadge}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedBadgeText} numberOfLines={1}>
                  {dashcamDevice?.name ?? 'DashCam'}
                </Text>
                <Text style={styles.connectedBadgeSep}>·</Text>
                <Text style={styles.connectedBadgeStatus}>Connected</Text>
              </View>
            )}
          </View>
          <Text style={styles.subtitle}>
            {dashcamConnected
              ? 'Ready for your next safe journey?'
              : 'Ready for your driving session?'}
          </Text>
        </View>

        {dashcamConnected ? (
          <>
            {/*  CONNECTED STATE  */}

            {/* Start Driving button */}
            <TouchableOpacity
              onPress={() => router.push('/wifi-connection')}
              activeOpacity={0.85}
              style={styles.startBtn}
            >
              <LinearGradient
                colors={[Colors.primary.DEFAULT, Colors.secondary.DEFAULT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startBtnGradient}
              >
                <MaterialCommunityIcons name="play-circle" size={24} color="#fff" />
                <Text style={styles.startBtnText}>Start Driving Session</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Stats , only visible once the user has at least one saved session */}
            {sessions.length > 0 ? (
              <>
                {/* Average Score card */}
                <View style={styles.scoreCard}>
                  <View style={styles.scoreCardLeft}>
                    <Text style={styles.cardLabel}>AVERAGE SCORE</Text>
                    <View style={styles.scoreLine}>
                      <Text style={styles.scoreNum}>{averageScore.toFixed(1)}</Text>
                      <Text style={styles.scoreUnit}>/5.0</Text>
                    </View>
                    <View style={styles.scoreTrend}>
                      <MaterialCommunityIcons name="trending-up" size={16} color={Colors.secondary.DEFAULT} />
                      <Text style={styles.scoreTrendText}>+{stats?.scoreChange ?? 7}% vs last week</Text>
                    </View>
                  </View>
                  <ScoreRing
                    score={averageScore}
                    maxScore={5}
                    size={96}
                    strokeWidth={8}
                    centerIcon={
                      <MaterialCommunityIcons name="star" size={30} color={Colors.primary.DEFAULT} />
                    }
                  />
                </View>

                {/* Stats row */}
                <View style={styles.miniCardRow}>
                  <View style={styles.miniCard}>
                    <View style={[styles.miniCardIcon, { backgroundColor: `${Colors.primary.container}22` }]}>
                      <MaterialCommunityIcons name="car-multiple" size={20} color={Colors.primary.container} />
                    </View>
                    <Text style={styles.miniCardLabel}>TOTAL DRIVES</Text>
                    <Text style={styles.miniCardNum}>{totalDrives}</Text>
                  </View>
                  <View style={styles.miniCard}>
                    <View style={[styles.miniCardIcon, { backgroundColor: `${Colors.error.DEFAULT}22` }]}>
                      <MaterialCommunityIcons name="bell-alert-outline" size={20} color={Colors.error.DEFAULT} />
                    </View>
                    <Text style={styles.miniCardLabel}>TOTAL ALERTS</Text>
                    <Text style={styles.miniCardNum}>{totalAlerts}</Text>
                  </View>
                </View>

                {/* Top improvement area */}
                <View style={styles.improvementCard}>
                  <View style={styles.improvementIcon}>
                    <MaterialCommunityIcons name="home-alert" size={22} color={Colors.primary.fixed} />
                  </View>
                  <View style={styles.improvementContent}>
                    <Text style={styles.improvementLabel}>TOP IMPROVEMENT AREA</Text>
                    <Text style={styles.improvementTitle}>{stats?.topImprovementArea ?? 'Harsh Braking'}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="rgba(255,255,255,0.4)" />
                </View>
              </>
            ) : null}

            {/* Daily tip */}
            <View style={styles.tipCard}>
              <View style={styles.tipHeader}>
                <MaterialCommunityIcons name="lightbulb-on" size={18} color={Colors.primary.onContainer} />
                <Text style={styles.tipLabel}>DAILY DRIVING TIP</Text>
              </View>
              <Text style={styles.tipText}>{tipText}</Text>
              <View style={styles.tipGlow} />
            </View>

            {/* Recent Sessions */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
              <TouchableOpacity
                hitSlop={8}
                onPress={() => router.push('/(tabs)/progress')}
                style={styles.viewAllRow}
              >
                <Text style={styles.viewAllText}>VIEW ALL</Text>
                <MaterialCommunityIcons name="arrow-right" size={14} color={Colors.primary.container} />
              </TouchableOpacity>
            </View>

            {lastSession ? (
              <>
                {/* Most recent , tappable hero card with video */}
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setShowVideoModal(true)}
                  style={styles.lastSessionCard}
                >
                  <LinearGradient
                    colors={['#1e2e2e', '#0a1818']}
                    style={StyleSheet.absoluteFillObject}
                  >
                    <View style={styles.lastSessionBgIcon}>
                      <MaterialCommunityIcons name="car-side" size={64} color="rgba(255,255,255,0.08)" />
                    </View>
                  </LinearGradient>

                  {/* Score circle , top right */}
                  <View style={[styles.lastDriveScore, { borderColor: getScoreColor(lastSession.score) }]}>
                    <Text style={[styles.lastDriveScoreNum, { color: getScoreColor(lastSession.score) }]}>
                      {lastSession.score.toFixed(1)}
                    </Text>
                    <Text style={styles.lastDriveScorePts}>/5</Text>
                  </View>

                  {/* Play button , center */}
                  <View style={styles.lastSessionPlayOverlay}>
                    <View style={styles.lastSessionPlayBtn}>
                      <MaterialCommunityIcons name="play" size={28} color="#fff" />
                    </View>
                  </View>

                  {/* Info bar , bottom */}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.85)']}
                    style={styles.lastSessionInfoOverlay}
                  >
                    <View style={styles.lastSessionInfoRow}>
                      <View style={{ gap: 2 }}>
                        <Text style={styles.lastSessionTitle}>{lastSession.title}</Text>
                        <Text style={styles.lastSessionMeta}>
                          {formatDate(lastSession.startedAt)} · {formatTime(lastSession.startedAt)}
                        </Text>
                      </View>
                      <View style={styles.lastDriveDuration}>
                        <MaterialCommunityIcons name="clock-outline" size={12} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.lastDriveDurationText}>
                          {formatDuration(lastSession.durationMinutes)}
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Capped at 2 older entries , enough context without crowding the hero. Full history lives in the Progress tab. */}
                {sessions.slice(1, 3).map((s) => (
                  <SessionCard key={s.id} session={s} />
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="car-clock" size={36} color={Colors.outline.DEFAULT} />
                <Text style={styles.emptyStateText}>No sessions yet — save your first session to see it here.</Text>
              </View>
            )}
          </>
        ) : (
          <>
            {/*  PRE-CONNECT STATE  */}

            {/* DashCam status card */}
            <View style={styles.dashcamCard}>
              <View style={styles.dashcamIconWrap}>
                <View style={styles.dashcamIconRing} />
                <MaterialCommunityIcons name="video-off" size={44} color={Colors.primary.container} />
              </View>
              <Text style={styles.dashcamTitle}>No DashCam Detected</Text>
              <Text style={styles.dashcamDesc}>
                Connect your device via Bluetooth or Wi-Fi to start recording your driving metrics.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/devices')}
                activeOpacity={0.85}
                style={styles.connectBtn}
              >
                <LinearGradient
                  colors={[Colors.primary.DEFAULT, Colors.secondary.DEFAULT]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.connectBtnGradient}
                >
                  <MaterialCommunityIcons name="connection" size={22} color="#fff" />
                  <Text style={styles.connectBtnText}>Connect to DashCam</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <View style={styles.statBadge}>
                  <Text style={[styles.statBadgeText, { color: Colors.secondary.onContainer }]}>
                    AVERAGE SCORE
                  </Text>
                </View>
                <View style={styles.statNumRow}>
                  <Text style={[styles.statNum, { color: Colors.primary.DEFAULT }]}>
                    {sessions.length > 0 ? averageScore.toFixed(1) : '--'}
                  </Text>
                  {sessions.length > 0 && <Text style={styles.statUnit}>/5</Text>}
                </View>
                <Text style={styles.statSub}>
                  {sessions.length > 0
                    ? `${totalDrives} session${totalDrives !== 1 ? 's' : ''} total`
                    : 'No sessions yet'}
                </Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statBadge, { backgroundColor: `${Colors.error.DEFAULT}18` }]}>
                  <Text style={[styles.statBadgeText, { color: Colors.error.DEFAULT }]}>
                    TOTAL ALERTS
                  </Text>
                </View>
                <View style={styles.statNumRow}>
                  <Text style={[styles.statNum, { color: Colors.error.DEFAULT }]}>
                    {totalAlerts}
                  </Text>
                </View>
                <Text style={styles.statSub}>
                  {totalAlerts === 0 ? 'Drive safely!' : `across ${totalDrives} session${totalDrives !== 1 ? 's' : ''}`}
                </Text>
              </View>
            </View>

            {/* Recent Sessions */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
              <TouchableOpacity hitSlop={8} onPress={() => router.push('/(tabs)/progress')}>
                <Text style={styles.viewAllText}>VIEW ALL</Text>
              </TouchableOpacity>
            </View>

            {sessions.length > 0
              ? sessions.slice(0, 3).map((s) => <SessionCard key={s.id} session={s} />)
              : (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="car-clock" size={36} color={Colors.outline.DEFAULT} />
                  <Text style={styles.emptyStateText}>
                    No sessions yet — connect your dashcam and start your first drive!
                  </Text>
                </View>
              )}
          </>
        )}
      </ScrollView>

      {/* Rendered as a Modal rather than a separate route so the home screen state underneath
          is preserved , no need to pass the session object through navigation params. */}
      <Modal
        visible={showVideoModal}
        animationType="slide"
        onRequestClose={() => setShowVideoModal(false)}
        statusBarTranslucent
      >
        <StatusBar barStyle="light-content" backgroundColor="#0a0f0f" />
        <View style={styles.videoModal}>

          {/* Fixed header */}
          <View style={[styles.videoModalHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setShowVideoModal(false)} hitSlop={12} style={styles.videoModalClose}>
              <MaterialCommunityIcons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.videoModalTitle} numberOfLines={1}>
              {lastSession?.title ?? 'Last Drive'}
            </Text>
            <View style={{ width: 38 }} />
          </View>

          {/* Scrollable: video + summary */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

            {/* Video or placeholder */}
            {lastSession?.videoUrl ? (
              <Video
                source={{ uri: lastSession.videoUrl }}
                style={styles.videoPlayer}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <MaterialCommunityIcons name="video-outline" size={64} color="rgba(255,255,255,0.2)" />
                <Text style={styles.videoPlaceholderTitle}>Video Not Available Yet</Text>
                <Text style={styles.videoPlaceholderSub}>
                  Session recordings will appear here once the dashcam backend is connected.
                </Text>
              </View>
            )}

            {/*  Session Summary  */}
            {lastSession && (
              <View style={styles.summarySection}>

                <Text style={styles.summaryHeading}>SESSION SUMMARY</Text>

                {/* Score block */}
                <View style={styles.summaryScoreRow}>
                  <Text style={[styles.summaryScoreBig, { color: getScoreColor(lastSession.score) }]}>
                    {lastSession.score.toFixed(1)}
                  </Text>
                  <View style={styles.summaryScoreMeta}>
                    <Text style={styles.summaryScoreOutOf}>/5</Text>
                    <View style={[styles.summaryScoreLabelBadge, { backgroundColor: `${getScoreColor(lastSession.score)}22` }]}>
                      <Text style={[styles.summaryScoreLabelText, { color: getScoreColor(lastSession.score) }]}>
                        {lastSession.scoreLabel}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Stats strip */}
                <View style={styles.summaryStatsStrip}>
                  <View style={styles.summaryStatItem}>
                    <MaterialCommunityIcons name="calendar-outline" size={16} color="rgba(255,255,255,0.4)" />
                    <Text style={styles.summaryStatLabel}>Date</Text>
                    <Text style={styles.summaryStatValue}>{formatDate(lastSession.startedAt)}</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStatItem}>
                    <MaterialCommunityIcons name="clock-outline" size={16} color="rgba(255,255,255,0.4)" />
                    <Text style={styles.summaryStatLabel}>Time</Text>
                    <Text style={styles.summaryStatValue}>{formatTime(lastSession.startedAt)}</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStatItem}>
                    <MaterialCommunityIcons name="timer-outline" size={16} color="rgba(255,255,255,0.4)" />
                    <Text style={styles.summaryStatLabel}>Duration</Text>
                    <Text style={styles.summaryStatValue}>{formatDuration(lastSession.durationMinutes)}</Text>
                  </View>
                </View>

                {/* Alerts */}
                {lastSession.mistakes.length === 0 ? (
                  <View style={styles.summaryNoAlerts}>
                    <MaterialCommunityIcons name="shield-check" size={36} color={Colors.secondary.DEFAULT} />
                    <Text style={styles.summaryNoAlertsText}>Clean drive — no alerts!</Text>
                  </View>
                ) : (
                  <View style={styles.summaryAlertsList}>
                    <View style={styles.summaryAlertsHeader}>
                      <MaterialCommunityIcons name="bell-alert-outline" size={15} color="rgba(255,255,255,0.5)" />
                      <Text style={styles.summaryAlertsTitle}>
                        ALERTS  ·  {lastSession.mistakes.length}
                      </Text>
                    </View>
                    {lastSession.mistakes.map((m) => (
                      <View key={m.id} style={styles.summaryAlertRow}>
                        <View style={[styles.summaryAlertAccent, { backgroundColor: severityColor(m.severity) }]} />
                        <View style={styles.summaryAlertBody}>
                          <Text style={styles.summaryAlertLabel}>{m.label}</Text>
                          <Text style={styles.summaryAlertTime}>at {formatMistakeTime(m.timestamp)} min</Text>
                        </View>
                        <View style={[styles.summaryAlertSeverity, { backgroundColor: `${severityColor(m.severity)}20` }]}>
                          <Text style={[styles.summaryAlertSeverityText, { color: severityColor(m.severity) }]}>
                            {m.severity.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  //  Header 
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 1,
    paddingRight: 16,
    height: 60,
    backgroundColor: '#ffffff',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${Colors.primary.container}22`,
    borderWidth: 2,
    borderColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
  },
  //  Scroll 
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  //  Greeting 
  greeting: {
    gap: 4,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  greetingName: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: `${Colors.secondary.container}55`,
    borderRadius: 999,
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.secondary.DEFAULT,
  },
  connectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary.onContainer,
    maxWidth: 140,
  },
  connectedBadgeSep: {
    fontSize: 12,
    color: Colors.secondary.onContainer,
    opacity: 0.5,
  },
  connectedBadgeStatus: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.secondary.onContainer,
    opacity: 0.8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.surface.onVariant,
  },
  //  CONNECTED: Start button 
  startBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  startBtnGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startBtnText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  //  CONNECTED: Score card 
  scoreCard: {
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  scoreCardLeft: {
    gap: 6,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.surface.onVariant,
    letterSpacing: 0.5,
  },
  scoreLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  scoreNum: {
    fontSize: 40,
    fontWeight: '700',
    color: Colors.primary.DEFAULT,
    lineHeight: 44,
  },
  scoreUnit: {
    fontSize: 16,
    color: Colors.surface.onVariant,
  },
  scoreTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scoreTrendText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary.DEFAULT,
  },
  //  CONNECTED: Mini cards 
  miniCardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  miniCard: {
    flex: 1,
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    padding: 20,
    gap: 8,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  miniCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.surface.onVariant,
    letterSpacing: 0.5,
  },
  miniCardNum: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  //  CONNECTED: Improvement card 
  improvementCard: {
    backgroundColor: Colors.surface.inverse,
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  improvementIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  improvementContent: {
    flex: 1,
    gap: 4,
  },
  improvementLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.5,
  },
  improvementTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  //  CONNECTED: Tip card 
  tipCard: {
    backgroundColor: Colors.primary.container,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    overflow: 'hidden',
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary.onContainer,
    letterSpacing: 0.5,
    opacity: 0.85,
  },
  tipText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.primary.onContainer,
    lineHeight: 22,
  },
  tipGlow: {
    position: 'absolute',
    right: -32,
    bottom: -32,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  //  CONNECTED: Last session 
  lastSessionCard: {
    borderRadius: 24,
    overflow: 'hidden',
    height: 192,
  },
  lastSessionBgIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastSessionPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastSessionPlayBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastSessionInfoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 48,
  },
  lastSessionInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  lastSessionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  lastSessionMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  //  PRE-CONNECT: DashCam card 
  dashcamCard: {
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    gap: 16,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  dashcamIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.surface.containerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashcamIconRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: Colors.primary.fixed,
    borderStyle: 'dashed',
    opacity: 0.7,
  },
  dashcamTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.surface.on,
    textAlign: 'center',
  },
  dashcamDesc: {
    fontSize: 14,
    color: Colors.outline.DEFAULT,
    textAlign: 'center',
    lineHeight: 20,
  },
  connectBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
  },
  connectBtnGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  connectBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  //  PRE-CONNECT: Stats row 
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    padding: 20,
    gap: 8,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  statBadge: {
    backgroundColor: `${Colors.secondary.container}55`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  statBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statNumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  statNum: {
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 36,
  },
  statUnit: {
    fontSize: 14,
    color: Colors.outline.DEFAULT,
  },
  statSub: {
    fontSize: 13,
    color: Colors.surface.onVariant,
  },
  //  PRE-CONNECT: Focus card 
  focusCard: {
    backgroundColor: Colors.primary.container,
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  focusTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.primary.onContainer,
  },
  focusPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  focusPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  focusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.3,
  },
  focusDesc: {
    fontSize: 13,
    color: `${Colors.primary.onContainer}CC`,
    lineHeight: 18,
  },
  //  Shared: Section header + sessions 
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary.container,
    letterSpacing: 0.5,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.surface.container,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sessionThumb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${Colors.primary.container}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionInfo: {
    flex: 1,
    gap: 3,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  sessionMeta: {
    fontSize: 13,
    color: Colors.outline.DEFAULT,
  },
  sessionScoreCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  sessionScoreNum: {
    fontSize: 20,
    fontWeight: '700',
  },
  sessionScoreLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.outline.DEFAULT,
    letterSpacing: 0.5,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 20,
    paddingHorizontal: 24,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.outline.DEFAULT,
    textAlign: 'center',
    lineHeight: 20,
  },
  //  Last Drive enhancements 
  lastDriveScore: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  lastDriveScoreNum: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 19,
  },
  lastDriveScorePts: {
    fontSize: 8,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  lastDriveDuration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lastDriveDurationText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  //  Video Modal 
  videoModal: {
    flex: 1,
    backgroundColor: '#0a0f0f',
  },
  videoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  videoModalClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoModalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  videoPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#111820',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  videoPlaceholderTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
  videoPlaceholderSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    lineHeight: 18,
  },
  //  Session Summary 
  summarySection: {
    padding: 20,
    gap: 20,
  },
  summaryHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
  },
  summaryScoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  summaryScoreBig: {
    fontSize: 64,
    fontWeight: '700',
    lineHeight: 68,
  },
  summaryScoreMeta: {
    gap: 6,
    paddingBottom: 6,
  },
  summaryScoreOutOf: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '500',
  },
  summaryScoreLabelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  summaryScoreLabelText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  summaryStatsStrip: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    paddingVertical: 16,
  },
  summaryStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },
  summaryStatLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  summaryStatValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  summaryNoAlerts: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
    backgroundColor: `${Colors.secondary.DEFAULT}12`,
    borderRadius: 16,
  },
  summaryNoAlertsText: {
    fontSize: 15,
    color: Colors.secondary.DEFAULT,
    fontWeight: '600',
  },
  summaryAlertsList: {
    gap: 10,
  },
  summaryAlertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  summaryAlertsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
  },
  summaryAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    overflow: 'hidden',
    gap: 12,
  },
  summaryAlertAccent: {
    width: 4,
    alignSelf: 'stretch',
  },
  summaryAlertBody: {
    flex: 1,
    paddingVertical: 12,
    gap: 2,
  },
  summaryAlertLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  summaryAlertTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  summaryAlertSeverity: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 12,
  },
  summaryAlertSeverityText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
