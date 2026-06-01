import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';
import { useAuthStore } from '@/stores/authStore';
import { login as apiLogin } from '@/services/api';
import { validateSaudiId } from '@/utils/validators';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const storeLogin = useAuthStore((s) => s.login);

  const [idNumber, setIdNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [idFocused, setIdFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  // Validate locally before touching the network — no point making an API call
  // when the ID format is obviously wrong.
  const handleSignIn = async () => {
    setError('');
    if (!validateSaudiId(idNumber)) {
      setError('Please enter a valid 10-digit Saudi ID (starts with 1 or 2).');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      const { user, token } = await apiLogin(idNumber, password);
      storeLogin(user, token);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primary.DEFAULT} />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <AppLogo size="mini" />
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.contactBtn}
            onPress={() =>
              Alert.alert(
                'Contact Us',
                'Phone: 0555779488\nEmail: Tamakkan.contact@gmail.com',
                [
                  { text: 'Call', onPress: () => Linking.openURL('tel:0555779488') },
                  { text: 'Email', onPress: () => Linking.openURL('mailto:Tamakkan.contact@gmail.com') },
                  { text: 'Close', style: 'cancel' },
                ]
              )
            }
          >
            <MaterialCommunityIcons name="headset" size={18} color={Colors.primary.DEFAULT} />
            <Text style={styles.contactText}>CONTACT US</Text>
          </TouchableOpacity>
          <TouchableOpacity hitSlop={8}>
            <Text style={styles.langToggle}>EN</Text>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero icon */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="account" size={48} color="#fff" />
            </View>
            <Text style={styles.heroTitle}>Welcome Back</Text>
            <Text style={styles.heroSub}>Log in to track your driving excellence.</Text>
          </View>

          {/* Tab toggle: Login / Sign Up */}
          <View style={styles.tabs}>
            <View style={styles.activeTab}>
              <Text style={styles.activeTabText}>Login</Text>
            </View>
            <TouchableOpacity
              style={styles.inactiveTab}
              onPress={() => router.replace('/(auth)/signup')}
            >
              <Text style={styles.inactiveTabText}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* ID Number field */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>ID NUMBER</Text>
            <View
              style={[
                styles.inputRow,
                idFocused && styles.inputRowFocused,
              ]}
            >
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={20}
                color={idFocused ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={idNumber}
                // Strip non-digits on every keystroke so the user can't accidentally
              // type dashes or spaces and get confused by a validation error.
              onChangeText={(t) => {
                  setIdNumber(t.replace(/\D/g, '').slice(0, 10));
                  setError('');
                }}
                placeholder="Enter your 10-digit ID"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="number-pad"
                maxLength={10}
                onFocus={() => setIdFocused(true)}
                onBlur={() => setIdFocused(false)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password field */}
          <View style={styles.fieldBlock}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TouchableOpacity
                onPress={() => Alert.alert('Forgot Password', 'Password reset coming soon.')}
                style={styles.forgotBtn}
              >
                <Text style={styles.forgotText}>Forgot?</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputRow, passFocused && styles.inputRowFocused]}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={20}
                color={passFocused ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                placeholder="••••••••"
                placeholderTextColor={Colors.outline.variant}
                secureTextEntry={!showPass}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
              <TouchableOpacity
                onPress={() => setShowPass((v) => !v)}
                hitSlop={8}
                style={{ paddingRight: 4 }}
              >
                <MaterialCommunityIcons
                  name={showPass ? 'eye-off' : 'eye'}
                  size={20}
                  color={Colors.outline.DEFAULT}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Error message */}
          {error ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={16}
                color={Colors.error.DEFAULT}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Sign In button */}
          <TouchableOpacity
            onPress={handleSignIn}
            disabled={loading}
            activeOpacity={0.85}
            style={styles.signInBtn}
          >
            <LinearGradient
              colors={
                loading
                  ? ['#9ecece', '#9ecece']
                  : [Colors.primary.container, Colors.secondary.DEFAULT]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.signInGradient}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.signInText}>Sign In</Text>
                  <MaterialCommunityIcons name="login" size={20} color="#fff" />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* OR divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR SECURE LOGIN WITH</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Biometric buttons */}
          <View style={styles.biometricRow}>
            <TouchableOpacity
              style={styles.biometricBtn}
              onPress={() => Alert.alert('Biometrics', 'Biometric login coming soon.')}
            >
              <MaterialCommunityIcons
                name="fingerprint"
                size={32}
                color={Colors.outline.DEFAULT}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.biometricBtn}
              onPress={() => Alert.alert('Biometrics', 'Face ID login coming soon.')}
            >
              <MaterialCommunityIcons
                name="face-recognition"
                size={32}
                color={Colors.outline.DEFAULT}
              />
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <MaterialCommunityIcons
                name="shield-lock-outline"
                size={13}
                color={Colors.outline.DEFAULT}
              />
              <Text style={styles.footerText}>END-TO-END ENCRYPTED AUTHENTICATION</Text>
            </View>
            <Text style={styles.footerCopy}>© 2026 TAMAKKAN AI DRIVING ASSISTANT</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Background accents */}
      <View style={[styles.accent, { bottom: -48, left: -48 }]} />
      <View style={[styles.accent, { top: -48, right: -48, backgroundColor: Colors.primary.container }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 60,
    backgroundColor: '#ffffff',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  logoRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    pointerEvents: 'none',
  } as any,
  langToggle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary.DEFAULT,
    paddingHorizontal: 4,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 32,
    gap: 20,
  },
  hero: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary.container,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  heroSub: {
    fontSize: 14,
    color: Colors.surface.onVariant,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface.containerLow,
    borderRadius: 16,
    padding: 6,
  },
  activeTab: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  activeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary.container,
  },
  inactiveTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  inactiveTabText: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.surface.onVariant,
  },
  fieldBlock: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary.DEFAULT,
    letterSpacing: 0.5,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forgotBtn: {
    backgroundColor: `${Colors.primary.container}18`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  forgotText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondary.container,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface.containerHighest,
    borderRadius: 16,
    height: 56,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputRowFocused: {
    borderColor: Colors.primary.container,
    backgroundColor: Colors.surface.containerLowest,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.surface.on,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.error.container,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error.onContainer,
  },
  signInBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  signInGradient: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  signInText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.outline.variant,
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.outline.DEFAULT,
    letterSpacing: 0.5,
  },
  biometricRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  biometricBtn: {
    width: 64,
    height: 64,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.outline.variant,
  },
  footer: {
    alignItems: 'center',
    gap: 4,
    opacity: 0.5,
    marginTop: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1,
    color: Colors.surface.on,
  },
  footerCopy: {
    fontSize: 9,
    color: Colors.surface.onVariant,
  },
  accent: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: Colors.secondary.container,
    opacity: 0.15,
    zIndex: -1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  contactText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.primary.DEFAULT,
    letterSpacing: 0.5,
  },
});
