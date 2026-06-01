import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Animated,
  Easing,
  Modal,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { stopSession as callStopSession, SessionSummary, SessionEventDTO } from '@/services/api';
import { saveSessionToDb, uuidv4 } from '@/services/supabaseService';
import { getTripCache, saveTripCache } from '@/utils/tripCache';
import Colors from '@/theme/colors';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getScoreLabel } from '@/utils/formatters';
import { DrivingSession, MistakeType } from '@/types';

//  WebSocket — spec: ws://<jetson-ip>:8000/ws/session/{session_id} 
// Shape of messages pushed by the Jetson (BACKEND_SPEC.md §3).
interface JetsonMessage {
  kind: 'alert' | 'speed_limit' | 'status';
  // alert fields
  event_type?: MistakeType;
  subtype?: string | null;        // red_light: 'ahead' | 'ran'
  severity?: 'medium' | 'high' | 'critical';
  is_vru?: boolean;
  message_en?: string;            // text the phone speaks
  session_time_s?: number;        // seconds since session start
  // speed_limit fields
  limit_kmh?: number | null;
  // status fields
  state?: 'active' | 'ended';
  timestamp?: number;
}

//  Types 
type AlertSeverity = 'danger' | 'warning';

interface AlertEntry {
  id: string;
  type: MistakeType;
  subtype?: string;
  message: string;
  severity: AlertSeverity;
  timestamp: number;              // seconds since session start
}


const HUD_HEIGHT = 52;
const BANNER_H = 64;
const DASH_CYCLE = 80; // dash height + gap
const N_DASHES = 8;

//  Helpers 
function severityFg(s: AlertSeverity) {
  return s === 'danger' ? Colors.error.container : Colors.tertiary.fixedDim;
}
function severityAccent(s: AlertSeverity) {
  return s === 'danger' ? Colors.error.DEFAULT : Colors.tertiary.DEFAULT;
}
function scoreColor(v: number) {
  if (v >= 4.0) return Colors.primary.DEFAULT;
  if (v >= 3.0) return Colors.tertiary.DEFAULT;
  return Colors.error.DEFAULT;
}
function pad2(n: number) { return n.toString().padStart(2, '0'); }
function formatTime(secs: number) {
  return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
}

// Score penalties per spec (BACKEND_SPEC.md §6.1)
function scorePenalty(type: MistakeType, subtype?: string): number {
  switch (type) {
    case 'near_miss':      return -1.0;
    case 'red_light':      return subtype === 'ran' ? -1.0 : 0;
    case 'tailgating':     return -0.5;
    case 'lane_departure': return -0.4;
  }
}

// Human-readable label per event type + subtype
function eventLabel(type: MistakeType, subtype?: string): string {
  switch (type) {
    case 'lane_departure': return 'Lane Departure';
    case 'tailgating':     return 'Tailgating';
    case 'red_light':      return subtype === 'ran' ? 'Ran Red Light' : 'Red Light Ahead';
    case 'near_miss':      return 'Near Miss';
  }
}

//  Top-down car (realistic sedan) 
function TopDownCar() {
  return (
    <View style={tdCar.wrapper}>
      {/* Shadow under body */}
      <View style={tdCar.shadow} />

      {/* Front-left / front-right wheels */}
      <View style={[tdCar.wheel, { top: 18, left: 0 }]} />
      <View style={[tdCar.wheel, { top: 18, right: 0 }]} />
      {/* Rear-left / rear-right wheels */}
      <View style={[tdCar.wheel, { bottom: 18, left: 0 }]} />
      <View style={[tdCar.wheel, { bottom: 18, right: 0 }]} />

      {/* Car body */}
      <View style={tdCar.body}>
        {/* Front bumper */}
        <View style={tdCar.bumper} />
        {/* Headlights */}
        <View style={tdCar.frontLights}>
          <View style={tdCar.headlight} />
          <View style={tdCar.headlight} />
        </View>
        {/* Hood */}
        <View style={tdCar.hood} />
        {/* Windshield */}
        <View style={tdCar.windshield} />
        {/* Cabin , narrowed with side margins to show roofline */}
        <View style={tdCar.cabin} />
        {/* Rear window */}
        <View style={tdCar.rearWindow} />
        {/* Trunk */}
        <View style={tdCar.trunk} />
        {/* Tail lights */}
        <View style={tdCar.rearLights}>
          <View style={tdCar.taillight} />
          <View style={tdCar.taillight} />
        </View>
        {/* Rear bumper */}
        <View style={tdCar.bumper} />
      </View>
    </View>
  );
}

const CAR_W = 44;   // body width
const WRAP_W = 60;  // wrapper (body + wheels)

const tdCar = StyleSheet.create({
  wrapper: {
    width: WRAP_W,
    height: 106,
    position: 'relative',
    alignItems: 'center',
  },
  shadow: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 4,
    bottom: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  wheel: {
    position: 'absolute',
    width: 10,
    height: 22,
    backgroundColor: '#111',
    borderRadius: 3,
  },
  body: {
    width: CAR_W,
    height: 106,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#cacaca',
  },
  bumper:     { height: 5, backgroundColor: '#999' },
  frontLights: {
    height: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    backgroundColor: '#b5b5b5',
    alignItems: 'center',
  },
  headlight: {
    width: 8,
    height: 3,
    backgroundColor: 'rgba(255,252,180,0.95)',
    borderRadius: 2,
  },
  rearLights: {
    height: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    backgroundColor: '#b5b5b5',
    alignItems: 'center',
  },
  taillight: {
    width: 8,
    height: 3,
    backgroundColor: 'rgba(255,30,30,0.95)',
    borderRadius: 2,
  },
  hood: { height: 16, backgroundColor: '#d4d4d4' },
  windshield: {
    height: 14,
    backgroundColor: 'rgba(140,205,235,0.72)',
    marginHorizontal: 3,
    borderRadius: 3,
  },
  cabin: {
    height: 22,
    backgroundColor: '#2e2e2e',
    marginHorizontal: 5,
    borderRadius: 2,
  },
  rearWindow: {
    height: 12,
    backgroundColor: 'rgba(140,205,235,0.62)',
    marginHorizontal: 3,
    borderRadius: 3,
  },
  trunk: { height: 16, backgroundColor: '#d4d4d4' },
});

//  Component 
export default function LiveSessionScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const stopSession      = useSessionStore((s) => s.stopSession);
  const activeSessionId  = useSessionStore((s) => s.activeSessionId);
  const dashcamDevice    = useSessionStore((s) => s.dashcamDevice);
  const user = useAuthStore((s) => s.user);
  const voiceAlertsEnabled = useSettingsStore((s) => s.voiceAlertsEnabled);
  const jetsonIp           = useSettingsStore((s) => s.jetsonIp);

  //  State 
  // elapsedRef is the authoritative value read at stop-time; `elapsed` state drives the timer display.
  // Using a ref avoids a stale-closure problem inside the setInterval callback.
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState(5.0);
  const [alertLog, setAlertLog] = useState<AlertEntry[]>([]);
  const [bannerAlert, setBannerAlert] = useState<AlertEntry | null>(null);
  const [detectedSpeed, setDetectedSpeed] = useState<number | null>(null);
  // Initialise from the persisted Settings toggle so the global setting is respected
  const [voiceEnabled, setVoiceEnabled] = useState(voiceAlertsEnabled);
  const [showSummary, setShowSummary] = useState(false);
  const [finalScore, setFinalScore] = useState(5.0);
  const [finalElapsed, setFinalElapsed] = useState(0);
  const [showNameModal, setShowNameModal] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState('');
  const [finalEvents, setFinalEvents] = useState<SessionEventDTO[]>([]);

  // availH is the usable height between the HUD and the bottom safe area.
  // 48% gives the panel roughly half the screen at rest, leaving a proper road view above.
  const availH     = screenH - insets.top - insets.bottom - HUD_HEIGHT;
  const initPanelH = Math.round(availH * 0.48 + 16);
  const MIN_PANEL_H = 80;

  //  Animations 
  const recPulse    = useRef(new Animated.Value(1)).current;
  const bannerY     = useRef(new Animated.Value(-BANNER_H - 8)).current;
  const roadAnim    = useRef(new Animated.Value(0)).current;
  const panelHeight = useRef(new Animated.Value(initPanelH)).current;
  const bannerTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the banner is currently in its slid-in position so we skip the spring
  // animation if a new alert fires while the banner is already visible.
  const bannerVisibleRef = useRef(false);
  const wsRef            = useRef<WebSocket | null>(null);
  // voiceEnabledRef mirrors the toggle so the WebSocket closure always reads the current value
  // — closures capture the value at creation time, not on every update.
  const voiceEnabledRef  = useRef(voiceAlertsEnabled);
  const sessionActiveRef = useRef(true);   // flipped to false the moment STOP is pressed
  const sessionEndedRef  = useRef(false);  // set when backend sends status: ended

  // Panel is resized by animating its height rather than translateY so the road view
  // above it expands when the panel collapses — no gap ever appears between them.
  const panDragStart   = useRef(initPanelH);
  const panelHeightVal = useRef(initPanelH);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, { dy }) => Math.abs(dy) > 4,
      onPanResponderGrant: () => {
        panelHeight.stopAnimation();
        panDragStart.current = panelHeightVal.current;
      },
      onPanResponderMove: (_, { dy }) => {
        const next = Math.max(MIN_PANEL_H, Math.min(panDragStart.current - dy, initPanelH));
        panelHeight.setValue(next);
        panelHeightVal.current = next;
      },
      onPanResponderRelease: (_, { vy }) => {
        const curr = panelHeightVal.current;
        const collapse = curr < initPanelH * 0.6 || vy > 0.5;
        const target = collapse ? MIN_PANEL_H : initPanelH;
        panelHeightVal.current = target;
        panDragStart.current   = target;
        Animated.spring(panelHeight, {
          toValue: target,
          useNativeDriver: false, // height animation needs this
          speed: 18,
          bounciness: 4,
        }).start();
      },
    }),
  ).current;


  //  Layout 
  const bannerTop = insets.top + HUD_HEIGHT + 10;

  // Dashes translate downward by one full DASH_CYCLE then loop — gives the illusion of
  // the road scrolling toward the viewer. Linear easing so there's no acceleration jitter.
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(roadAnim, {
        toValue: DASH_CYCLE,
        duration: 600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [roadAnim]);

  //  Banner controller 
  const showBanner = useCallback(
    (entry: AlertEntry) => {
      setBannerAlert(entry);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      if (!bannerVisibleRef.current) {
        bannerVisibleRef.current = true;
        Animated.spring(bannerY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 22,
          bounciness: 3,
        }).start();
      }
      bannerTimerRef.current = setTimeout(() => {
        Animated.timing(bannerY, {
          toValue: -BANNER_H - 8,
          duration: 220,
          useNativeDriver: true,
        }).start(() => {
          bannerVisibleRef.current = false;
          setBannerAlert(null);
        });
      }, 4000);
    },
    [bannerY],
  );

  //  Sync voice ref so WebSocket closure always reads current value 
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) Speech.stop();
  }, [voiceEnabled]);

  //  TTS , speaks the alert twice in English 
  const speakAlert = useCallback((text: string) => {
    if (!voiceEnabledRef.current) return;
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.9,
      pitch: 1.0,
      volume: 1.0,
    });
  }, []);

  //  REC pulsing 
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(recPulse, { toValue: 0.08, duration: 550, useNativeDriver: true }),
        Animated.timing(recPulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [recPulse]);

  //  Timer 
  useEffect(() => {
    const id = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);


  // Speed limit is driven by WS speed_limit messages; no mock cycling needed.

  //  Cleanup 
  useEffect(() => {
    return () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, []);

  //  WebSocket — Jetson real-time channel (BACKEND_SPEC.md §3) 
  // ws://<jetson-ip>:8000/ws/session/{session_id}
  useEffect(() => {
    if (!activeSessionId) return;
    const wsUrl = `ws://${jetsonIp}:8000/ws/session/${activeSessionId}`;

    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          if (!sessionActiveRef.current) return;
          try {
            const data: JetsonMessage = JSON.parse(evt.data as string);

            //  Speed-limit update 
            if (data.kind === 'speed_limit') {
              if (data.limit_kmh != null) {
                setDetectedSpeed(data.limit_kmh);
                speakAlert(`Speed limit is ${data.limit_kmh} kilometers per hour`);
              }
              return;
            }

            //  Session status 
            if (data.kind === 'status') {
              if (data.state === 'ended') sessionEndedRef.current = true;
              return;
            }

            //  Alert 
            if (data.kind !== 'alert' || !data.event_type || !data.message_en) return;

            const dispSeverity: AlertSeverity =
              data.severity === 'medium' ? 'warning' : 'danger';

            const entry: AlertEntry = {
              id: String(Date.now()),
              type: data.event_type,
              subtype: data.subtype ?? undefined,
              message: data.message_en,
              severity: dispSeverity,
              timestamp: Math.round(data.session_time_s ?? 0),
            };
            // Cap at 20 entries so the list stays snappy on long drives.
            setAlertLog((prev) => [entry, ...prev].slice(0, 20));
            setScore((prev) => {
              const delta = scorePenalty(entry.type, entry.subtype);
              return Math.max(0, Math.min(5.0, parseFloat((prev + delta).toFixed(2))));
            });
            showBanner(entry);
            speakAlert(entry.message);
          } catch { /* ignore malformed frames */ }
        };

        ws.onerror = () => { /* silent , Jetson not yet connected */ };

        ws.onclose = () => {
          wsRef.current = null;
          // Auto-reconnect unless the user stopped the session, the backend ended it,
          // or the effect is cleaning up. 4 s gives the Jetson time to recover.
          if (!destroyed && sessionActiveRef.current && !sessionEndedRef.current) {
            reconnectTimer = setTimeout(connect, 4000);
          }
        };
      } catch { /* WebSocket constructor unavailable */ }
    }

    connect();

    return () => {
      destroyed = true;
      sessionEndedRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [showBanner, speakAlert, jetsonIp, activeSessionId]);

  // Freezes the session UI immediately so the user sees a score at once.
  // The POST to the backend runs after — if it succeeds, the final score and event list
  // are updated; if not, the local snapshot is kept.
  function handleStop() {
    sessionActiveRef.current = false;   // stops all new alerts + TTS at the gate
    Speech.stop();

    const snapshotScore   = score;
    const snapshotElapsed = elapsedRef.current;
    setFinalScore(snapshotScore);
    setFinalElapsed(snapshotElapsed);
    setShowSummary(true);

    // POST /sessions/{id}/stop — non-blocking; updates summary when Jetson responds
    const tripId = activeSessionId ?? ('s_' + Date.now());
    callStopSession(tripId).then((summary) => {
      if (!summary) return;           // Jetson unreachable, keep local snapshot
      setFinalScore(summary.score);
      setFinalElapsed(summary.duration_seconds);
      setFinalEvents(summary.events);
    }).catch(() => {});
  }

  function openNameModal() {
    const defaultName = `Session · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    setSessionNameDraft(defaultName);
    setShowNameModal(true);
  }

  function handleSaveSession() {
    const title = sessionNameDraft.trim() ||
      `Session · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const session: DrivingSession = {
      id: uuidv4(),
      userId: user?.id ?? 'u_001',
      title,
      startedAt: new Date(Date.now() - finalElapsed * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationMinutes: Math.max(1, Math.ceil(finalElapsed / 60)),
      score: finalScore,
      scoreLabel: getScoreLabel(finalScore),
      // Prefer the server-confirmed event list; fall back to the locally-tracked alertLog
      // if the Jetson stopSession call failed or returned nothing.
      mistakes: finalEvents.length > 0
        ? finalEvents.map((e, idx) => ({
            id: `${e.event_type}_${idx}_${e.timestamp}`,
            type: e.event_type,
            label: eventLabel(e.event_type, e.subtype ?? undefined),
            timestamp: Math.round(e.session_time_s),
            severity: e.severity,
            subtype: e.subtype,
            is_vru: e.is_vru,
          }))
        : alertLog.map((a) => ({
            id: a.id,
            type: a.type,
            label: eventLabel(a.type, a.subtype ?? undefined),
            timestamp: a.timestamp,
            severity: a.severity === 'danger' ? 'high' as const : 'medium' as const,
            subtype: a.subtype,
          })),
    };
    stopSession(session);
    const uid = user?.id ?? 'u_001';
    getTripCache(uid).then((cached) => saveTripCache(uid, [session, ...cached]));

    // 'u_001' is the dev fallback ID that doesn't exist in Supabase , skip the DB write for it.
    if (uid !== 'u_001') {
      saveSessionToDb(
        session,
        uid,
        dashcamDevice?.id,
        finalEvents.length > 0 ? finalEvents : undefined,
      ).catch(() => {});
    }

    setShowNameModal(false);
    setShowSummary(false);
    router.replace('/(tabs)');
  }

  function handleDiscardSession() {
    Speech.stop();
    stopSession();
    setShowSummary(false);
    router.replace('/(tabs)');
  }

  const scoreCol = scoreColor(score);
  const dangerCount = alertLog.filter((a) => a.severity === 'danger').length;
  const warningCount = alertLog.filter((a) => a.severity === 'warning').length;
  const summaryLabel = getScoreLabel(finalScore);
  const summaryCol = scoreColor(finalScore);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/*  HUD bar  */}
      <View style={styles.hud}>
        <Text style={styles.timer}>{formatTime(elapsed)}</Text>

        <View style={styles.recBadge}>
          <Animated.View style={[styles.recDot, { opacity: recPulse }]} />
          <Text style={styles.recText}>REC</Text>
        </View>

        <View style={styles.hudRight}>
          {/* Voice toggle */}
          <TouchableOpacity
            onPress={() => setVoiceEnabled((v) => !v)}
            style={[styles.voiceBtn, !voiceEnabled && styles.voiceBtnOff]}
            hitSlop={8}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons
              name={voiceEnabled ? 'volume-high' : 'volume-off'}
              size={18}
              color={voiceEnabled ? Colors.secondary.DEFAULT : 'rgba(255,255,255,0.35)'}
            />
          </TouchableOpacity>

          {/* Stop button */}
          <TouchableOpacity onPress={handleStop} style={styles.stopBtn} hitSlop={8} activeOpacity={0.75}>
            <MaterialCommunityIcons name="stop-circle" size={15} color="#fff" />
            <Text style={styles.stopText}>STOP</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/*  Video / Road simulation  */}
      <View style={styles.video}>
        {/* Sky gradient */}
        <LinearGradient colors={['#0d1f1f', '#1a3535']} style={StyleSheet.absoluteFillObject} />

        {/* Road surface */}
        <View style={styles.road}>
          <LinearGradient colors={['#2a2a2a', '#1e1e1e']} style={StyleSheet.absoluteFillObject} />

          {/* Road edges */}
          <View style={styles.roadEdgeLeft} />
          <View style={styles.roadEdgeRight} />

          {/* Animated center dashes */}
          {Array.from({ length: N_DASHES }).map((_, i) => (
            <Animated.View
              key={i}
              style={[
                styles.centerDash,
                {
                  top: i * DASH_CYCLE - DASH_CYCLE,
                  transform: [{ translateY: roadAnim }],
                },
              ]}
            />
          ))}

          {/* Car — top-down view */}
          <View style={styles.carWrap}>
            <TopDownCar />
          </View>
        </View>

        {/* Live session label — centered in video, on top of road */}
        <View style={styles.liveLabel} pointerEvents="none">
          <Animated.View style={[styles.liveLabelDot, { opacity: recPulse }]} />
          <Text style={styles.liveLabelText}>LIVE SESSION</Text>
        </View>

        {/* Score badge — bottom-right */}
        <View style={[styles.scoreBadge, { borderColor: scoreCol }]}>
          <Text style={[styles.scoreBadgeNum, { color: scoreCol }]}>{score.toFixed(1)}</Text>
          <Text style={styles.scoreBadgeUnit}>/5.0</Text>
          <Text style={styles.scoreBadgeLabel}>CURRENT{'\n'}SCORE</Text>
        </View>

        {/* Speed sign — bottom-left */}
        <View style={styles.speedWrap}>
          <View style={styles.speedSign}>
            <Text style={styles.speedNum}>{detectedSpeed ?? '—'}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <View style={styles.detectedTag}>
            <Text style={styles.detectedText}>DETECTED</Text>
          </View>
        </View>

        {/* Bottom fade */}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={styles.videoFade} />
      </View>

      {/*  Bottom panel (height shrinks on drag, no gap possible)  */}
      <Animated.View
        style={[
          styles.panel,
          { paddingBottom: Math.max(insets.bottom, 12), height: panelHeight },
        ]}
      >
        {/* Drag zone — wider touch target around the handle */}
        <View {...panResponder.panHandlers} style={styles.dragZone}>
          <View style={styles.panelHandle} />
        </View>

        <View style={styles.panelHeader}>
          <MaterialCommunityIcons name="alert-circle" size={17} color={Colors.error.container} />
          <Text style={styles.panelTitle}>Live Alerts</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{alertLog.length}</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.alertListContent}
          showsVerticalScrollIndicator={false}
        >
          {alertLog.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="shield-check" size={28} color="rgba(238,241,241,0.25)" />
              <Text style={styles.emptyStateText}>Monitoring your drive…</Text>
            </View>
          ) : (
            alertLog.map((a) => (
              <View key={a.id} style={[styles.alertRow, { borderLeftColor: severityAccent(a.severity) }]}>
                <View style={[styles.alertDot, { backgroundColor: severityFg(a.severity) }]} />
                <Text style={styles.alertRowMsg} numberOfLines={1}>{a.message}</Text>
                <Text style={styles.alertRowTime}>{formatTime(a.timestamp)}</Text>
                <View style={[styles.alertChip, { backgroundColor: `${severityAccent(a.severity)}44` }]}>
                  <Text style={[styles.alertChipText, { color: severityFg(a.severity) }]}>
                    {a.severity === 'danger' ? 'DANGER' : 'WARN'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>

      {/*  Alert banner (slides from below HUD)  */}
      {bannerAlert && (
        <Animated.View
          style={[
            styles.banner,
            {
              top: bannerTop,
              borderLeftColor: severityAccent(bannerAlert.severity),
              transform: [{ translateY: bannerY }],
            },
          ]}
          pointerEvents="none"
        >
          <View style={[styles.bannerIconWrap, { backgroundColor: `${severityAccent(bannerAlert.severity)}33` }]}>
            <MaterialCommunityIcons
              name={bannerAlert.severity === 'danger' ? 'alert-circle' : 'alert'}
              size={22}
              color={severityFg(bannerAlert.severity)}
            />
          </View>
          <Text style={styles.bannerMsg} numberOfLines={2}>{bannerAlert.message}</Text>
          <View style={[styles.bannerChip, { backgroundColor: `${severityAccent(bannerAlert.severity)}44` }]}>
            <Text style={[styles.bannerChipTxt, { color: severityFg(bannerAlert.severity) }]}>
              {bannerAlert.severity === 'danger' ? 'DANGER' : 'WARN'}
            </Text>
          </View>
        </Animated.View>
      )}

      {/*  Session Summary Modal  */}
      <Modal
        visible={showSummary}
        animationType="slide"
        transparent={false}
        statusBarTranslucent
      >
        <StatusBar style="dark" />
        <View style={[styles.summaryRoot, { paddingTop: insets.top + 12 }]}>
          {/* Scrollable content */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.summaryScroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.summaryHeader}>
              <View style={styles.summaryHeaderIcon}>
                <MaterialCommunityIcons name="flag-checkered" size={26} color="#fff" />
              </View>
              <Text style={styles.summaryHeaderTitle}>Session Complete</Text>
            </View>

            {/* Score block */}
            <View style={[styles.summaryScoreBlock, { borderColor: `${summaryCol}44` }]}>
              <Text style={[styles.summaryScoreNum, { color: summaryCol }]}>
                {finalScore.toFixed(1)}
              </Text>
              <Text style={styles.summaryScoreDen}>/5.0</Text>
              <View style={[styles.summaryScoreLabel, { backgroundColor: `${summaryCol}22` }]}>
                <Text style={[styles.summaryScoreLabelText, { color: summaryCol }]}>{summaryLabel}</Text>
              </View>
            </View>

            {/* Stats */}
            <View style={styles.summaryStats}>
              <View style={styles.summaryStatRow}>
                <View style={[styles.summaryStatIcon, { backgroundColor: Colors.surface.containerHigh }]}>
                  <MaterialCommunityIcons name="timer-outline" size={20} color={Colors.outline.DEFAULT} />
                </View>
                <Text style={styles.summaryStatLabel}>Duration</Text>
                <Text style={styles.summaryStatValue}>{formatTime(finalElapsed)}</Text>
              </View>
              <View style={styles.summaryStatDivider} />
              <View style={styles.summaryStatRow}>
                <View style={[styles.summaryStatIcon, { backgroundColor: `${Colors.error.DEFAULT}22` }]}>
                  <MaterialCommunityIcons name="alert-circle" size={20} color={Colors.error.DEFAULT} />
                </View>
                <Text style={styles.summaryStatLabel}>Danger Alerts</Text>
                <Text style={[styles.summaryStatValue, { color: Colors.error.DEFAULT }]}>{dangerCount}</Text>
              </View>
              <View style={styles.summaryStatDivider} />
              <View style={styles.summaryStatRow}>
                <View style={[styles.summaryStatIcon, { backgroundColor: `${Colors.tertiary.DEFAULT}22` }]}>
                  <MaterialCommunityIcons name="alert" size={20} color={Colors.tertiary.DEFAULT} />
                </View>
                <Text style={styles.summaryStatLabel}>Warning Alerts</Text>
                <Text style={[styles.summaryStatValue, { color: Colors.tertiary.DEFAULT }]}>{warningCount}</Text>
              </View>
            </View>

            {/* Alert list */}
            {alertLog.length > 0 && (
              <View style={styles.summaryAlertSection}>
                <Text style={styles.summaryAlertSectionTitle}>ALERTS THIS SESSION</Text>
                {alertLog.map((a) => (
                  <View key={a.id} style={[styles.summaryAlertItem, { borderLeftColor: severityAccent(a.severity) }]}>
                    <MaterialCommunityIcons
                      name={a.severity === 'danger' ? 'alert-circle' : 'alert'}
                      size={15}
                      color={severityFg(a.severity)}
                    />
                    <Text style={styles.summaryAlertMsg} numberOfLines={1}>{a.message}</Text>
                    <View style={[styles.summaryAlertChip, { backgroundColor: `${severityAccent(a.severity)}33` }]}>
                      <Text style={[styles.summaryAlertChipText, { color: severityFg(a.severity) }]}>
                        {a.severity === 'danger' ? 'DANGER' : 'WARN'}
                      </Text>
                    </View>
                    <Text style={styles.summaryAlertTime}>{formatTime(a.timestamp)}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Fixed buttons at bottom */}
          <View style={[styles.summaryActions, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity onPress={openNameModal} activeOpacity={0.85} style={styles.saveBtn}>
              <LinearGradient
                colors={[Colors.primary.container, Colors.secondary.DEFAULT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveBtnGradient}
              >
                <MaterialCommunityIcons name="content-save" size={20} color="#fff" />
                <Text style={styles.saveBtnText}>Save Session</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleDiscardSession} activeOpacity={0.8} style={styles.discardBtn}>
              <MaterialCommunityIcons name="delete-outline" size={20} color={Colors.error.DEFAULT} />
              <Text style={styles.discardBtnText}>Discard Session</Text>
            </TouchableOpacity>
          </View>

          {/*  Naming overlay — lives inside the summary modal so it stacks correctly  */}
          {showNameModal && (
            <KeyboardAvoidingView
              style={styles.nameOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <View style={styles.nameCard}>
                <Text style={styles.nameCardTitle}>Name Your Session</Text>
                <Text style={styles.nameCardSub}>Give this drive a memorable name</Text>
                <TextInput
                  style={styles.nameInput}
                  value={sessionNameDraft}
                  onChangeText={setSessionNameDraft}
                  placeholder="e.g. Morning Commute"
                  placeholderTextColor={Colors.outline.variant}
                  maxLength={50}
                  autoFocus
                  selectTextOnFocus
                  returnKeyType="done"
                  onSubmitEditing={handleSaveSession}
                />
                <View style={styles.nameActions}>
                  <TouchableOpacity
                    style={styles.nameCancelBtn}
                    onPress={() => setShowNameModal(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.nameCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.nameSaveBtn}
                    onPress={handleSaveSession}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="content-save" size={18} color="#fff" />
                    <Text style={styles.nameSaveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>
    </View>
  );
}

//  Styles 
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface.inverse },

  //  HUD 
  hud: {
    height: HUD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#111e1e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  timer: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
    minWidth: 72,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: 'rgba(186,26,26,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(186,26,26,0.4)',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error.DEFAULT,
  },
  recText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.error.container,
    letterSpacing: 1.5,
  },
  hudRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  voiceBtnOff: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Colors.error.DEFAULT,
    borderRadius: 10,
    minWidth: 72,
    justifyContent: 'center',
  },
  stopText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.8,
  },

  //  Video / Road 
  video: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  road: {
    width: 200,
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  roadEdgeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#fff',
    opacity: 0.7,
  },
  roadEdgeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#fff',
    opacity: 0.7,
  },
  centerDash: {
    position: 'absolute',
    left: '50%',
    marginLeft: -2,
    width: 4,
    height: 40,
    backgroundColor: '#fff',
    opacity: 0.6,
    borderRadius: 2,
  },
  carWrap: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // Score badge
  scoreBadge: {
    position: 'absolute',
    bottom: 16,
    right: 14,
    backgroundColor: 'rgba(10,18,18,0.88)',
    borderRadius: 14,
    borderWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 1,
  },
  scoreBadgeNum: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  scoreBadgeUnit: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  scoreBadgeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 2,
  },

  // Speed sign
  speedWrap: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    alignItems: 'center',
    gap: 4,
  },
  speedSign: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 5,
    borderColor: Colors.error.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  speedNum: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111',
    lineHeight: 26,
  },
  speedUnit: {
    fontSize: 8,
    fontWeight: '700',
    color: '#444',
    letterSpacing: -0.2,
  },
  detectedTag: {
    backgroundColor: Colors.error.DEFAULT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detectedText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },

  liveLabel: {
    position: 'absolute',
    top: 82,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  liveLabelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error.DEFAULT,
  },
  liveLabelText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 2,
  },
  videoFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
  },

  //  Panel 
  panel: {
    backgroundColor: Colors.surface.containerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    marginTop: -16,
    overflow: 'hidden',
  },
  dragZone: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 12,
  },
  panelHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.outline.variant,
    alignSelf: 'center',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  panelTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${Colors.error.DEFAULT}33`,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.error.DEFAULT,
  },

  alertListContent: { gap: 2, paddingBottom: 8 },
  emptyState: { paddingVertical: 24, alignItems: 'center', gap: 8 },
  emptyStateText: {
    fontSize: 13,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },

  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.containerHigh,
    marginLeft: -16,
    paddingRight: 0,
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  alertRowMsg: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: Colors.surface.on,
    lineHeight: 18,
  },
  alertRowTime: {
    fontSize: 11,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  alertChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  alertChipText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  //  Banner 
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: BANNER_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(14,24,24,0.97)',
    borderRadius: 18,
    borderLeftWidth: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 14,
  },
  bannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerMsg: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.surface.inverseOn,
    lineHeight: 20,
  },
  bannerChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bannerChipTxt: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  //  Summary Modal 
  summaryRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  summaryScroll: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 20,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  summaryHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryHeaderTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  summaryScoreBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: Colors.surface.containerLow,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
  },
  summaryScoreNum: {
    fontSize: 72,
    fontWeight: '700',
    lineHeight: 76,
  },
  summaryScoreDen: {
    fontSize: 20,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
    marginBottom: 8,
  },
  summaryScoreLabel: {
    marginBottom: 8,
    marginLeft: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  summaryScoreLabelText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  summaryStats: {
    backgroundColor: Colors.surface.containerLow,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  summaryStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  summaryStatIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryStatLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },
  summaryStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.surface.on,
    fontVariant: ['tabular-nums'],
  },
  summaryStatDivider: {
    height: 1,
    backgroundColor: Colors.surface.containerHigh,
  },
  summaryActions: {
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.containerHigh,
    backgroundColor: Colors.background,
  },
  summaryAlertSection: {
    gap: 8,
  },
  summaryAlertSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.outline.DEFAULT,
    letterSpacing: 1,
    marginBottom: 4,
  },
  summaryAlertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 8,
    backgroundColor: Colors.surface.containerLow,
    borderRadius: 12,
    borderLeftWidth: 3,
    marginBottom: 6,
  },
  summaryAlertMsg: {
    flex: 1,
    fontSize: 13,
    color: Colors.surface.on,
    fontWeight: '500',
  },
  summaryAlertChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  summaryAlertChipText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  summaryAlertTime: {
    fontSize: 11,
    color: Colors.outline.DEFAULT,
    fontVariant: ['tabular-nums'],
  },
  saveBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveBtnGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  discardBtn: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: `${Colors.error.DEFAULT}66`,
    backgroundColor: `${Colors.error.DEFAULT}0d`,
  },
  discardBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error.DEFAULT,
  },

  //  Session Naming Modal 
  nameOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 99,
  },
  nameCard: {
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  nameCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  nameCardSub: {
    fontSize: 13,
    color: Colors.outline.DEFAULT,
    marginTop: -8,
  },
  nameInput: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Colors.outline.variant,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: Colors.surface.on,
    backgroundColor: Colors.surface.containerLow,
  },
  nameActions: {
    flexDirection: 'row',
    gap: 12,
  },
  nameCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.outline.variant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.onVariant,
  },
  nameSaveBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.primary.DEFAULT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nameSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
