import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={Colors.primary.container} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={danger ? Colors.error.DEFAULT : Colors.primary.DEFAULT}
        />
      </View>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {!danger && (
        <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.outline.DEFAULT} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setDashcamConnected = useSessionStore((s) => s.setDashcamConnected);

  // First letter of each word, capped at 2 characters , handles both "Ahmed" and "Ahmed Al-Rashidi".
  const initials = user
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '??';

  function handleLogout() {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          // Clear the dashcam connection first so the home screen doesn't render the
          // "connected" state if a different user logs in during the same app session.
          setDashcamConnected(false);
          logout();
          // replace() so the back gesture can't bring the logged-out user back to their data.
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <AppLogo size="mini" />
        </View>
        <Text style={styles.langToggle}>EN</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + name block */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.userName}>{user?.name ?? 'Unknown User'}</Text>
          <View style={styles.rolePill}>
            <MaterialCommunityIcons name="account-check" size={13} color={Colors.secondary.onContainer} />
            <Text style={styles.roleText}>
              {user?.userType === 'individual' ? 'Individual Driver' : user?.userType ?? 'Driver'}
            </Text>
          </View>
        </View>

        {/* Info card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account Info</Text>
          <InfoRow icon="card-account-details" label="National ID" value={user?.nationalId ?? '—'} />
          <View style={styles.divider} />
          <InfoRow icon="phone" label="Phone" value={user?.phone ?? '—'} />
          <View style={styles.divider} />
          <InfoRow
            icon="calendar-check"
            label="Member Since"
            value={
              user?.joinedAt
                ? new Date(user.joinedAt).toLocaleDateString('en-SA', {
                    year: 'numeric',
                    month: 'long',
                  })
                : '—'
            }
          />
        </View>

        {/* Menu */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>
          <MenuRow icon="cog-outline" label="App Settings" onPress={() => router.push('/settings')} />
          <View style={styles.divider} />
          <MenuRow icon="bell-outline" label="Notifications" />
          <View style={styles.divider} />
          <MenuRow icon="shield-check-outline" label="Privacy & Security" />
          <View style={styles.divider} />
          <MenuRow icon="help-circle-outline" label="Help & Support" />
        </View>

        {/* App version */}
        <Text style={styles.version}>Tamakkan v5.0.0 · SDK 54</Text>

        {/* Log out */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="logout" size={20} color={Colors.error.DEFAULT} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingRight: 20,
    height: 60,
    backgroundColor: '#fff',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  langToggle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary.DEFAULT,
  },
  //  Scroll 
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  //  Avatar section 
  avatarSection: {
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.primary.fixed,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarInitials: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: `${Colors.secondary.container}66`,
    borderRadius: 999,
  },
  roleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondary.onContainer,
  },
  //  Card 
  card: {
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 0,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.outline.DEFAULT,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.surface.containerHigh,
    marginVertical: 4,
  },
  //  Info row 
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    gap: 2,
  },
  infoLabel: {
    fontSize: 12,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  //  Menu row 
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconDanger: {
    backgroundColor: `${Colors.error.DEFAULT}15`,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.surface.on,
  },
  menuLabelDanger: {
    color: Colors.error.DEFAULT,
  },
  //  App version 
  version: {
    fontSize: 12,
    color: Colors.outline.DEFAULT,
    textAlign: 'center',
    marginTop: 4,
  },
  //  Log out 
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.error.DEFAULT,
    backgroundColor: `${Colors.error.DEFAULT}10`,
    marginBottom: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error.DEFAULT,
  },
});
