import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { startSession as apiStartSession } from '@/services/api';
import { upsertDevice } from '@/services/supabaseService';
import { DashcamDevice } from '@/types';

type Status = 'idle' | 'connecting' | 'connected' | 'failed';

type Step = {
  num: number;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  desc: string;
};

const STEPS: Step[] = [
  {
    num: 1,
    icon: 'server-network',
    title: 'Power On Your Tamakkan Device',
    desc: 'Make sure your Tamakkan device is powered on and the status LED is on.',
  },
  {
    num: 2,
    icon: 'wifi',
    title: 'Join the Same Wi-Fi Network',
    desc: 'Connect your phone to the same Wi-Fi network as your Tamakkan device.',
  },
  {
    num: 3,
    icon: 'gesture-tap-button',
    title: 'Tap "Connect" to Establish Connection',
    desc: 'Once on the same network, tap the Connect button below to start the session.',
  },
];

// Real WebSocket constants are commented out until the Jetson backend is deployed.
// const WS_URL = 'ws://tamakkan.local:8000/ws/drive';  // restore when backend is ready
// const TIMEOUT_MS = 6000;

export default function WifiConnectionScreen() {
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [status, setStatus] = useState<Status>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addSavedDevice = useSessionStore((s) => s.addSavedDevice);
  const setDashcamConnected = useSessionStore((s) => s.setDashcamConnected);
  const user = useAuthStore((s) => s.user);

  // Cleanup both the timeout and the WebSocket so there's no dangling callback
  // if the user navigates away mid-connection.
  useEffect(() => {
    return () => {
      timerRef.current && clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const handleConnect = () => {
    if (status === 'connecting') return;
    setStatus('connecting');

    timerRef.current && clearTimeout(timerRef.current);

    //  MOCK: always succeeds after 2 s (swap for real WebSocket when backend is ready) 
    timerRef.current = setTimeout(() => {
      const device: DashcamDevice = {
        id: 'cam_' + Date.now(),
        name: 'Tamakkan_Cam_' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        macAddress: 'AA:BB:CC:DD:EE:FF',
        isConnected: true,
        firmwareVersion: '1.0.0',
        lastConnected: new Date().toISOString(),
        ssid: 'Tamakkan_WiFi',
      };
      addSavedDevice(device);
      setDashcamConnected(true, device);
      setStatus('connected');

      // Persist device to Supabase so it survives app restarts
      if (user?.id) {
        upsertDevice(user.id, device).catch(() => {});
      }

      // Second timeout gives the user a moment to see the "Connected" status before navigating.
      // When coming from the Devices tab, skip starting a session and just go home.
      timerRef.current = setTimeout(async () => {
        if (from === 'devices') {
          router.replace('/(tabs)/');
          return;
        }
        try {
          const result = await apiStartSession(device.id);
          useSessionStore.getState().startSession(result.session_id);
          router.replace('/session');
        } catch {
          Alert.alert(
            'Session Error',
            'Could not start a session with the device. Please try again.',
            [{ text: 'OK' }],
          );
          setStatus('failed');
        }
      }, 1000);
    }, 2000);

    //  REAL WebSocket (uncomment when backend is ready) 
    // const ws = new WebSocket(WS_URL);
    // wsRef.current = ws;
    // timerRef.current = setTimeout(() => { ws.close(); setStatus('failed'); }, TIMEOUT_MS);
    // ws.onopen = () => { ... };
    // ws.onerror = () => { setStatus('failed'); };
  };

  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isFailed = status === 'failed';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primary.DEFAULT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Start Session</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 160 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page heading */}
        <View style={styles.titleBlock}>
          <Text style={styles.pageTitle}>Wi-Fi Setup</Text>
          <Text style={styles.pageSub}>
            Complete these steps before connecting to your Jetson device.
          </Text>
        </View>

        {/* Step cards */}
        <View style={styles.steps}>
          {STEPS.map((step) => (
            <View key={step.num} style={styles.stepCard}>
              <View style={styles.stepLeft}>
                <View style={styles.stepNumBadge}>
                  <Text style={styles.stepNumText}>{step.num}</Text>
                </View>
                {step.num < STEPS.length && <View style={styles.stepConnector} />}
              </View>
              <View style={styles.stepRight}>
                <View style={styles.stepIconBox}>
                  <MaterialCommunityIcons name={step.icon} size={26} color={Colors.primary.container} />
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Fixed bottom: status + button */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>

        {/* Status indicator */}
        {status !== 'idle' && (
          <View style={[
            styles.statusCard,
            isConnecting && styles.statusConnecting,
            isConnected && styles.statusConnected,
            isFailed && styles.statusFailed,
          ]}>
            {isConnecting && (
              <>
                <ActivityIndicator size="small" color={Colors.primary.container} />
                <Text style={[styles.statusText, { color: Colors.primary.container }]}>
                  Connecting…
                </Text>
              </>
            )}
            {isConnected && (
              <>
                <MaterialCommunityIcons name="check-circle" size={22} color={Colors.secondary.DEFAULT} />
                <Text style={[styles.statusText, { color: Colors.secondary.DEFAULT }]}>
                  Connected ✓  —  Launching session
                </Text>
              </>
            )}
            {isFailed && (
              <>
                <MaterialCommunityIcons name="wifi-off" size={22} color={Colors.error.DEFAULT} />
                <Text style={[styles.statusText, { color: Colors.error.DEFAULT }]}>
                  Connection Failed
                </Text>
              </>
            )}
          </View>
        )}

        {/* Connect / Retry button */}
        {!isConnected && (
          <TouchableOpacity
            onPress={handleConnect}
            disabled={isConnecting}
            activeOpacity={0.85}
            style={styles.connectBtn}
          >
            <LinearGradient
              colors={
                isConnecting
                  ? ['#9ecece', '#9ecece']
                  : isFailed
                  ? [Colors.error.DEFAULT, Colors.error.DEFAULT]
                  : [Colors.primary.container, Colors.secondary.DEFAULT]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.connectGradient}
            >
              {isConnecting ? (
                <ActivityIndicator color="#fff" />
              ) : isFailed ? (
                <>
                  <MaterialCommunityIcons name="refresh" size={22} color="#fff" />
                  <Text style={styles.connectText}>Retry</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="wifi" size={22} color="#fff" />
                  <Text style={styles.connectText}>Connect</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* Background accent */}
      <View style={styles.bgAccent} />
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
    paddingHorizontal: 16,
    height: 60,
    backgroundColor: '#fff',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.surface.on,
  },

  //  Scroll 
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 28,
    gap: 24,
  },

  //  Title block 
  titleBlock: {
    gap: 8,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  pageSub: {
    fontSize: 15,
    color: Colors.surface.onVariant,
    lineHeight: 22,
  },

  //  Steps 
  steps: {
    gap: 0,
  },
  stepCard: {
    flexDirection: 'row',
    gap: 16,
    minHeight: 88,
  },
  stepLeft: {
    alignItems: 'center',
    width: 36,
  },
  stepNumBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  stepConnector: {
    flex: 1,
    width: 2,
    backgroundColor: `${Colors.primary.container}33`,
    marginVertical: 4,
  },
  stepRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingBottom: 24,
  },
  stepIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepBody: {
    flex: 1,
    paddingTop: 4,
    gap: 4,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  stepDesc: {
    fontSize: 13,
    color: Colors.surface.onVariant,
    lineHeight: 20,
  },

  //  Bottom bar 
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.outline.variant,
  },

  //  Status card 
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  statusConnecting: {
    backgroundColor: `${Colors.primary.container}18`,
  },
  statusConnected: {
    backgroundColor: `${Colors.secondary.DEFAULT}18`,
  },
  statusFailed: {
    backgroundColor: `${Colors.error.DEFAULT}12`,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
  },

  //  Connect button 
  connectBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  connectGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  connectText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },

  bgAccent: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.primary.container,
    opacity: 0.04,
    zIndex: -1,
  },
});
