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
import { signUp as supabaseSignUp } from '@/services/supabaseService';
import { validateSaudiId, validateSaudiPhone } from '@/utils/validators';

// Auto-inserts the slashes as the user types, so they never have to type DD/MM/YYYY manually.
// Strips non-digits first so pasting a formatted date still works correctly.
const formatDob = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

type FieldKey =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'password'
  | 'dob'
  | 'idNumber';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const storeLogin = useAuthStore((s) => s.login);
  const [focused, setFocused] = useState<FieldKey | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [idNumber, setIdNumber] = useState('');

  const isFocused = (key: FieldKey) => focused === key;

  const handleSignUp = async () => {
    setError('');

    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.');
      return;
    }
    if (!validateSaudiId(idNumber)) {
      setError('Please enter a valid 10-digit Saudi ID (starts with 1 or 2).');
      return;
    }
    if (phone.length > 0 && !validateSaudiPhone('+966' + phone)) {
      setError('Please enter a valid Saudi phone number.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!agreed) {
      setError('Please agree to the Terms & Conditions.');
      return;
    }

    setLoading(true);
    try {
      const { user, token } = await supabaseSignUp({
        nationalId: idNumber,
        password,
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim() || undefined,
        phone: phone ? `+966${phone}` : undefined,
        dob: dob || undefined,
      });
      // Supabase sometimes requires email verification before issuing a session token.
      // In that case we skip auto-login and send the user to the login screen manually.
      if (token) {
        storeLogin(user, token);
        router.replace('/(tabs)');
      } else {
        Alert.alert(
          'Account Created!',
          'Your account has been created. Please log in to continue.',
          [{ text: 'Log In', onPress: () => router.replace('/(auth)/login') }],
        );
      }
    } catch (e: any) {
      setError(e?.message ?? 'Sign-up failed. Please try again.');
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
            { paddingBottom: insets.bottom + 140 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Heading */}
          <View style={styles.heading}>
            <Text style={styles.headTitle}>Create Account</Text>
            <Text style={styles.headSub}>Join Tamakkan and start improving your driving today.</Text>
          </View>

          {/* Tab toggle: Login / Sign Up */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={styles.inactiveTab}
              onPress={() => router.replace('/(auth)/login')}
            >
              <Text style={styles.inactiveTabText}>Login</Text>
            </TouchableOpacity>
            <View style={styles.activeTab}>
              <Text style={styles.activeTabText}>Sign Up</Text>
            </View>
          </View>

          {/* First Name + Last Name row */}
          <View style={styles.nameRow}>
            <View style={[styles.fieldBlock, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>FIRST NAME</Text>
              <View style={[styles.inputRow, isFocused('firstName') && styles.inputRowFocused]}>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={(t) => { setFirstName(t); setError(''); }}
                  placeholder="First"
                  placeholderTextColor={Colors.outline.variant}
                  onFocus={() => setFocused('firstName')}
                  onBlur={() => setFocused(null)}
                  returnKeyType="next"
                />
              </View>
            </View>
            <View style={[styles.fieldBlock, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>LAST NAME</Text>
              <View style={[styles.inputRow, isFocused('lastName') && styles.inputRowFocused]}>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={(t) => { setLastName(t); setError(''); }}
                  placeholder="Last"
                  placeholderTextColor={Colors.outline.variant}
                  onFocus={() => setFocused('lastName')}
                  onBlur={() => setFocused(null)}
                  returnKeyType="next"
                />
              </View>
            </View>
          </View>

          {/* Email */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <View style={[styles.inputRow, isFocused('email') && styles.inputRowFocused]}>
              <MaterialCommunityIcons
                name="email-outline"
                size={20}
                color={isFocused('email') ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(''); }}
                placeholder="your@email.com"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="email-address"
                autoCapitalize="none"
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
            <View style={[styles.inputRow, isFocused('phone') && styles.inputRowFocused]}>
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>+966</Text>
              </View>
              <View style={styles.phoneDivider} />
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 9)); setError(''); }}
                placeholder="5X XXXX XXXX"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="number-pad"
                maxLength={9}
                onFocus={() => setFocused('phone')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <View style={[styles.inputRow, isFocused('password') && styles.inputRowFocused]}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={20}
                color={isFocused('password') ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.outline.variant}
                secureTextEntry={!showPass}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)} hitSlop={8} style={{ paddingRight: 4 }}>
                <MaterialCommunityIcons
                  name={showPass ? 'eye-off' : 'eye'}
                  size={20}
                  color={Colors.outline.DEFAULT}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Date of Birth */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>DATE OF BIRTH</Text>
            <View style={[styles.inputRow, isFocused('dob') && styles.inputRowFocused]}>
              <MaterialCommunityIcons
                name="calendar-outline"
                size={20}
                color={isFocused('dob') ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={dob}
                onChangeText={(t) => { setDob(formatDob(t)); setError(''); }}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="number-pad"
                maxLength={10}
                onFocus={() => setFocused('dob')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* ID Number */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>ID NUMBER</Text>
            <View style={[styles.inputRow, isFocused('idNumber') && styles.inputRowFocused]}>
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={20}
                color={isFocused('idNumber') ? Colors.primary.DEFAULT : Colors.outline.DEFAULT}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={idNumber}
                onChangeText={(t) => { setIdNumber(t.replace(/\D/g, '').slice(0, 10)); setError(''); }}
                placeholder="10-digit Saudi ID"
                placeholderTextColor={Colors.outline.variant}
                keyboardType="number-pad"
                maxLength={10}
                onFocus={() => setFocused('idNumber')}
                onBlur={() => setFocused(null)}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Terms checkbox */}
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setAgreed((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && (
                <MaterialCommunityIcons name="check" size={14} color="#fff" />
              )}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.termsLink}>Terms & Conditions</Text>
              {' '}and{' '}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={Colors.error.DEFAULT} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fixed bottom CTA */}
      <View style={[styles.bottomCta, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.85}
          style={styles.signUpBtn}
        >
          <LinearGradient
            colors={
              loading
                ? ['#9ecece', '#9ecece']
                : [Colors.primary.container, Colors.secondary.DEFAULT]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.signUpGradient}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.signUpText}>Create Account</Text>
                <MaterialCommunityIcons name="account-plus" size={20} color="#fff" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/login')}
          style={styles.loginLink}
          hitSlop={8}
        >
          <Text style={styles.loginLinkText}>
            Already have an account?{' '}
            <Text style={styles.loginLinkBold}>Log In</Text>
          </Text>
        </TouchableOpacity>
      </View>

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
    paddingTop: 28,
    gap: 18,
  },
  heading: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  headTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  headSub: {
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface.containerHighest,
    borderRadius: 16,
    height: 52,
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
    fontSize: 15,
    color: Colors.surface.on,
  },
  phonePrefix: {
    paddingRight: 10,
  },
  phonePrefixText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  phoneDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.outline.variant,
    marginRight: 12,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.outline.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary.container,
    borderColor: Colors.primary.container,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.surface.onVariant,
    lineHeight: 20,
  },
  termsLink: {
    color: Colors.primary.container,
    fontWeight: '600',
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
  bottomCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.outline.variant,
    gap: 12,
  },
  signUpBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  signUpGradient: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  signUpText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  loginLink: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  loginLinkText: {
    fontSize: 14,
    color: Colors.surface.onVariant,
  },
  loginLinkBold: {
    color: Colors.primary.container,
    fontWeight: '700',
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
