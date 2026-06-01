import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { getDevices } from '@/services/supabaseService';
import { DashcamDevice } from '@/types';
import { formatDate } from '@/utils/formatters';

function DeviceCard({
  device,
  isActive,
  isConnecting,
  onPress,
  onRemove,
}: {
  device: DashcamDevice;
  isActive: boolean;
  isConnecting: boolean;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.deviceCard, isActive && styles.deviceCardActive]}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={isConnecting}
    >
      {/* Icon */}
      <View style={[styles.deviceIcon, isActive && styles.deviceIconActive]}>
        <MaterialCommunityIcons
          name="camera"
          size={26}
          color={isActive ? '#fff' : Colors.primary.container}
        />
      </View>

      {/* Info */}
      <View style={styles.deviceInfo}>
        <View style={styles.deviceNameRow}>
          <Text style={styles.deviceName} numberOfLines={1}>{device.name}</Text>
          {isActive && (
            <View style={styles.connectedBadge}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedBadgeText}>Connected</Text>
            </View>
          )}
        </View>
        <Text style={styles.deviceMac}>{device.macAddress}</Text>
        {device.lastConnected && (
          <Text style={styles.deviceLastSeen}>
            Last connected · {formatDate(device.lastConnected)}
          </Text>
        )}
      </View>

      {/* Right: connecting spinner OR chevron+remove */}
      {isConnecting ? (
        <ActivityIndicator size="small" color={Colors.primary.container} />
      ) : (
        <View style={styles.deviceActions}>
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={8}
            style={styles.removeBtn}
          >
            <MaterialCommunityIcons name="close" size={16} color={Colors.outline.DEFAULT} />
          </TouchableOpacity>
          <MaterialCommunityIcons
            name="chevron-right"
            size={22}
            color={isActive ? Colors.primary.container : Colors.outline.DEFAULT}
          />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function DevicesScreen() {
  const insets = useSafeAreaInsets();
  const savedDevices = useSessionStore((s) => s.savedDevices);
  const dashcamDevice = useSessionStore((s) => s.dashcamDevice);
  const dashcamConnected = useSessionStore((s) => s.dashcamConnected);
  const setDashcamConnected = useSessionStore((s) => s.setDashcamConnected);
  const removeSavedDevice = useSessionStore((s) => s.removeSavedDevice);
  const addSavedDevice = useSessionStore((s) => s.addSavedDevice);
  const user = useAuthStore((s) => s.user);

  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Load previously paired devices from Supabase on mount.
  // addSavedDevice deduplicates by ID, so calling it per-device on every mount is safe.
  useEffect(() => {
    if (!user?.id) return;
    getDevices(user.id).then((devices) => {
      devices.forEach((d) => addSavedDevice(d));
    }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDevicePress = async (device: DashcamDevice) => {
    if (connectingId) return;
    // Already connected to this device — go home
    if (dashcamConnected && dashcamDevice?.id === device.id) {
      router.navigate('/(tabs)');
      return;
    }
    setConnectingId(device.id);
    // Placeholder delay until the real reconnect handshake with the Jetson is wired up.
    await new Promise((r) => setTimeout(r, 1500));
    setDashcamConnected(true, { ...device, lastConnected: new Date().toISOString() });
    setConnectingId(null);
    router.navigate('/(tabs)/');
  };

  const handleRemove = (deviceId: string, deviceName: string) => {
    Alert.alert(
      'Remove Device',
      `Remove "${deviceName}" from your devices?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (dashcamDevice?.id === deviceId) setDashcamConnected(false);
            removeSavedDevice(deviceId);
          },
        },
      ]
    );
  };

  // Two completely different layouts live in the same component: device list when the user
  // has at least one paired device, setup guide when they have none. Avoids a separate route
  // for the "first-time onboarding" case and keeps the back navigation natural.
  if (savedDevices.length > 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.navigate('/(tabs)')}
            hitSlop={8}
            style={styles.backBtn}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primary.container} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Devices</Text>
          <TouchableOpacity
            onPress={() => router.push('/wifi-connection?from=devices')}
            hitSlop={8}
            style={styles.addBtn}
          >
            <MaterialCommunityIcons name="plus" size={24} color={Colors.primary.container} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.listScroll, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>MY DEVICES</Text>

          {savedDevices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isActive={dashcamConnected && dashcamDevice?.id === device.id}
              isConnecting={connectingId === device.id}
              onPress={() => handleDevicePress(device)}
              onRemove={() => handleRemove(device.id, device.name)}
            />
          ))}

          <Text style={styles.hintText}>
            Tap a device to connect · Swipe × to remove
          </Text>
        </ScrollView>

      </View>
    );
  }

  //  Empty / setup view (no saved devices yet) 
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.navigate('/(tabs)')}
          hitSlop={8}
          style={styles.backBtn}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primary.container} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Devices</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 104 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Headline */}
        <View style={styles.headline}>
          <Text style={styles.headlineTitle}>Connect Your DashCam</Text>
          <Text style={styles.headlineSubtitle}>
            Follow these simple steps to link your device and start tracking your safety metrics.
          </Text>
        </View>

        {/* Hero icon */}
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <MaterialCommunityIcons name="cctv" size={72} color={Colors.primary.container} />
          </View>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {STEPS.map((step) => (
            <View key={step.num} style={styles.stepCard}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{step.num}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>
                  {step.desc}
                  {step.highlight != null ? (
                    <Text style={styles.stepHighlight}>{step.highlight}</Text>
                  ) : null}
                  {step.suffix ?? ''}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Help */}
        <View style={styles.helpCard}>
          <View style={styles.helpLeft}>
            <MaterialCommunityIcons
              name="help-circle-outline"
              size={22}
              color={Colors.primary.container}
            />
            <Text style={styles.helpText}>Need help connecting?</Text>
          </View>
          <TouchableOpacity hitSlop={8}>
            <Text style={styles.troubleshootBtn}>Troubleshoot</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Connect button */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          onPress={() => router.push('/wifi-connection?from=devices')}
          activeOpacity={0.85}
          style={styles.startWrap}
        >
          <LinearGradient
            colors={[Colors.primary.container, Colors.secondary.DEFAULT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startInner}
          >
            <MaterialCommunityIcons name="wifi" size={22} color="#fff" />
            <Text style={styles.startText}>Connect to Wi-Fi</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

//  Setup steps data 
const STEPS: {
  num: number;
  title: string;
  desc: string;
  highlight?: string;
  suffix?: string;
}[] = [
  {
    num: 1,
    title: 'Power On Device',
    desc: "Plug the DashCam into your vehicle's power outlet and wait for the status LED to blink blue.",
  },
  {
    num: 2,
    title: 'Enable Wi-Fi Mode',
    desc: 'Press the \'Wi-Fi\' button on the side of the device until you hear the "Hotspot Active" voice prompt.',
  },
  {
    num: 3,
    title: 'Join Network',
    desc: 'Look for a Wi-Fi network named ',
    highlight: 'Tamakkan_Cam_XXXX',
    suffix: ' in your phone settings.',
  },
];

// Styles 

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
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  //  Device list 
  listScroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.surface.onVariant,
    letterSpacing: 1,
    marginBottom: 4,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 20,
    padding: 16,
    gap: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  deviceCardActive: {
    borderColor: Colors.primary.container,
    backgroundColor: `${Colors.primary.container}0a`,
  },
  deviceIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deviceIconActive: {
    backgroundColor: Colors.primary.container,
  },
  deviceInfo: {
    flex: 1,
    gap: 3,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${Colors.secondary.DEFAULT}20`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary.DEFAULT,
  },
  connectedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.secondary.DEFAULT,
  },
  deviceMac: {
    fontSize: 11,
    color: Colors.outline.DEFAULT,
    fontFamily: 'monospace',
  },
  deviceLastSeen: {
    fontSize: 11,
    color: Colors.surface.onVariant,
  },
  deviceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface.containerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    fontSize: 12,
    color: Colors.outline.DEFAULT,
    textAlign: 'center',
    marginTop: 8,
  },

  //  Bottom bar 
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.outline.variant,
  },
  startWrap: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  startInner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },

  //  Setup / empty view 
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 20,
  },
  headline: {
    gap: 8,
  },
  headlineTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  headlineSubtitle: {
    fontSize: 14,
    color: Colors.surface.onVariant,
    lineHeight: 20,
  },
  heroCard: {
    borderRadius: 24,
    overflow: 'hidden',
    height: 160,
    backgroundColor: `${Colors.primary.container}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconWrap: {
    width: 120,
    height: 120,
    borderRadius: 32,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  steps: {
    gap: 12,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 20,
    padding: 16,
    gap: 14,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  stepBody: {
    flex: 1,
    paddingTop: 2,
    gap: 4,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  stepDesc: {
    fontSize: 13,
    color: Colors.surface.onVariant,
    lineHeight: 19,
  },
  stepHighlight: {
    fontWeight: '700',
    color: Colors.primary.container,
  },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 16,
    padding: 16,
  },
  helpLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  helpText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.surface.on,
  },
  troubleshootBtn: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary.container,
  },
});
