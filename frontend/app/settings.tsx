import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  GestureResponderEvent,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import { useSettingsStore } from '@/stores/settingsStore';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

//  Custom slider 

// Custom slider because Expo Go on Android doesn't ship the RN community slider at SDK 54.
// trackWidth is measured via onLayout because we can't know the rendered width at paint time.
function SensitivitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const pct = value / 100;

  function clamp(x: number): number {
    if (trackWidth === 0) return value;
    return Math.max(0, Math.min(100, Math.round((x / trackWidth) * 100)));
  }

  function handleTouch(e: GestureResponderEvent) {
    onChange(clamp(e.nativeEvent.locationX));
  }

  const thumbLeft = trackWidth > 0 ? pct * trackWidth - 12 : 0;
  const label = value < 34 ? 'Low' : value < 67 ? 'Medium' : 'High';

  return (
    <View style={sliderStyles.wrap}>
      <View style={sliderStyles.labelRow}>
        <Text style={sliderStyles.levelLabel}>{label}</Text>
        <Text style={sliderStyles.valueText}>{value}%</Text>
      </View>
      <View
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
        style={sliderStyles.trackArea}
      >
        <View style={sliderStyles.track}>
          <View style={[sliderStyles.fill, { width: trackWidth > 0 ? pct * trackWidth : 0 }]} />
        </View>
        {trackWidth > 0 && <View style={[sliderStyles.thumb, { left: thumbLeft }]} />}
      </View>
      <View style={sliderStyles.tickRow}>
        <Text style={sliderStyles.tickLabel}>Low</Text>
        <Text style={sliderStyles.tickLabel}>Medium</Text>
        <Text style={sliderStyles.tickLabel}>High</Text>
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrap: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelLabel: { fontSize: 13, fontWeight: '600', color: Colors.primary.DEFAULT },
  valueText: { fontSize: 13, color: Colors.outline.DEFAULT },
  trackArea: { height: 36, justifyContent: 'center' },
  track: { height: 6, backgroundColor: Colors.surface.containerHighest, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: Colors.primary.DEFAULT, borderRadius: 3 },
  thumb: {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.primary.DEFAULT, borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 4, top: 6,
  },
  tickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tickLabel: { fontSize: 11, color: Colors.outline.DEFAULT },
});

//  Row components 

function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

function ToggleRow({
  icon, label, subtitle, value, onToggle, disabled,
}: {
  icon: IconName; label: string; subtitle?: string;
  value: boolean; onToggle: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={icon} size={20}
          color={disabled ? Colors.outline.variant : Colors.primary.DEFAULT}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
        {subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: Colors.surface.containerHighest, true: Colors.primary.fixed }}
        thumbColor={value ? Colors.primary.DEFAULT : Colors.outline.variant}
        ios_backgroundColor={Colors.surface.containerHighest}
      />
    </View>
  );
}

//  Screen 

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { loaded, load, update, voiceAlertsEnabled, sensitivity, jetsonIp, hapticEnabled } =
    useSettingsStore();
  const [ipDraft, setIpDraft] = useState(jetsonIp);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Only sync the draft from the store once loading is complete — prevents overwriting
  // a partially-typed address if the component re-renders before the store finishes.
  useEffect(() => {
    if (loaded) setIpDraft(jetsonIp);
  }, [loaded, jetsonIp]);

  // Skips the update when nothing changed so we don't write AsyncStorage on every blur.
  function saveIp() {
    const trimmed = ipDraft.trim();
    if (trimmed !== jetsonIp) update({ jetsonIp: trimmed });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.surface.on} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Language */}
          <SectionTitle label="Language" />
          <View style={styles.card}>
            <View style={styles.langRow}>
              <TouchableOpacity style={[styles.langOption, styles.langOptionActive]}>
                <Text style={styles.langOptionTextActive}>EN</Text>
                <Text style={styles.langOptionCaptionActive}>English</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.langOption, styles.langOptionDisabled]} disabled>
                <Text style={styles.langOptionTextDisabled}>AR</Text>
                <Text style={styles.langOptionCaptionDisabled}>Arabic</Text>
                <View style={styles.soonPill}>
                  <Text style={styles.soonText}>Soon</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Alerts */}
          <SectionTitle label="Alerts" />
          <View style={styles.card}>
            <ToggleRow
              icon="volume-high"
              label="Voice Alerts"
              subtitle="Spoken warnings during your drive"
              value={voiceAlertsEnabled}
              onToggle={(v) => update({ voiceAlertsEnabled: v })}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="vibrate"
              label="Haptic Feedback"
              subtitle="Vibration on event detection"
              value={hapticEnabled}
              onToggle={(v) => update({ hapticEnabled: v })}
            />
          </View>

          {/* Detection */}
          <SectionTitle label="Detection Sensitivity" />
          <View style={[styles.card, { gap: 8 }]}>
            <Text style={styles.sensitivityHint}>
              Higher sensitivity detects more events but may produce false positives.
            </Text>
            <SensitivitySlider
              value={sensitivity}
              onChange={(v) => update({ sensitivity: v })}
            />
          </View>

          {/* Connection */}
          <SectionTitle label="Connection" />
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons name="ip-network-outline" size={20} color={Colors.primary.DEFAULT} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Jetson IP Address</Text>
                <Text style={styles.rowSubtitle}>Used when mDNS discovery fails</Text>
              </View>
            </View>
            <View style={styles.ipInputWrap}>
              <TextInput
                style={styles.ipInput}
                value={ipDraft}
                onChangeText={setIpDraft}
                onBlur={saveIp}
                onSubmitEditing={saveIp}
                placeholder="e.g. 192.168.4.1"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              {ipDraft !== jetsonIp && (
                <TouchableOpacity onPress={saveIp} style={styles.saveIpBtn}>
                  <Text style={styles.saveIpText}>Save</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 60, backgroundColor: '#fff',
    shadowColor: Colors.primary.tint, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06, shadowRadius: 20, elevation: 3,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.surface.on, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 8 },
  sectionTitle: {
    fontSize: 12, fontWeight: '600', color: Colors.outline.DEFAULT,
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 8, marginLeft: 4, marginBottom: 2,
  },
  card: {
    backgroundColor: Colors.surface.containerLowest, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 14,
    shadowColor: Colors.primary.tint, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  divider: { height: 1, backgroundColor: Colors.surface.containerHigh, marginVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowDisabled: { opacity: 0.45 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '500', color: Colors.surface.on },
  rowLabelDisabled: { color: Colors.outline.DEFAULT },
  rowSubtitle: { fontSize: 12, color: Colors.outline.DEFAULT },
  langRow: { flexDirection: 'row', gap: 10 },
  langOption: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, gap: 2 },
  langOptionActive: { borderColor: Colors.primary.DEFAULT, backgroundColor: `${Colors.primary.DEFAULT}10` },
  langOptionDisabled: { borderColor: Colors.outline.variant, backgroundColor: Colors.surface.containerLow, position: 'relative' },
  langOptionTextActive: { fontSize: 17, fontWeight: '700', color: Colors.primary.DEFAULT },
  langOptionCaptionActive: { fontSize: 12, color: Colors.primary.DEFAULT, fontWeight: '500' },
  langOptionTextDisabled: { fontSize: 17, fontWeight: '700', color: Colors.outline.DEFAULT },
  langOptionCaptionDisabled: { fontSize: 12, color: Colors.outline.DEFAULT },
  soonPill: { position: 'absolute', top: 6, right: 6, backgroundColor: Colors.surface.containerHighest, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  soonText: { fontSize: 9, fontWeight: '700', color: Colors.outline.DEFAULT, textTransform: 'uppercase' },
  sensitivityHint: { fontSize: 12, color: Colors.outline.DEFAULT, lineHeight: 18 },
  ipInputWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  ipInput: {
    flex: 1, height: 44, borderWidth: 1.5, borderColor: Colors.outline.variant,
    borderRadius: 12, paddingHorizontal: 14, fontSize: 15,
    color: Colors.surface.on, backgroundColor: Colors.surface.containerLow,
  },
  saveIpBtn: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.primary.DEFAULT, borderRadius: 10 },
  saveIpText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
