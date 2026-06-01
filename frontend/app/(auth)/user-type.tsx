import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';

type RoleCardProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  onPress: () => void;
  // Optional flag so we can show future roles on the screen without wiring them up yet.
  // The card renders at 0.7 opacity and fires an Alert instead of navigating.
  comingSoon?: boolean;
};

function RoleCard({
  icon,
  iconBg,
  iconColor,
  title,
  description,
  onPress,
  comingSoon = false,
}: RoleCardProps) {
  return (
    <TouchableOpacity
      style={[styles.card, comingSoon && styles.cardDisabled]}
      activeOpacity={comingSoon ? 0.6 : 0.8}
      onPress={onPress}
    >
      <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={icon} size={32} color={iconColor} />
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {comingSoon && (
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>COMING SOON</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardDesc}>{description}</Text>
      </View>

      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={comingSoon ? Colors.outline.variant : Colors.outline.DEFAULT}
      />
    </TouchableOpacity>
  );
}

export default function UserTypeScreen() {
  const insets = useSafeAreaInsets();

  const handleIndividual = () => router.push('/(auth)/login');

  // Single handler shared by both locked roles — keeps the Alert wording consistent
  // and avoids duplicating the same two-line function for Trainee and Instructor.
  const handleComingSoon = (role: string) => {
    Alert.alert(
      `${role} Flow`,
      'This user type is coming in a future update.',
      [{ text: 'OK' }]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.primary.DEFAULT} />
        </TouchableOpacity>

        {/* Logo center */}
        <View style={styles.logoRow}>
          <AppLogo size="mini" />
        </View>

        {/* Right: Contact Us + EN */}
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

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page heading */}
        <View style={styles.headingBlock}>
          <Text style={styles.pageTitle}>Choose User Type</Text>
          <Text style={styles.pageSubtitle}>
            Select the profile that best describes your role in the Tamakkan driving ecosystem.
          </Text>
        </View>

        {/* Role cards */}
        <View style={styles.cards}>
          <RoleCard
            icon="account"
            iconBg="rgba(0,128,128,0.1)"
            iconColor={Colors.primary.container}
            title="Individual"
            description="Review your personal driving performance and safety metrics."
            onPress={handleIndividual}
          />
          <RoleCard
            icon="card-account-details-outline"
            iconBg="rgba(0,108,79,0.12)"
            iconColor={Colors.secondary.DEFAULT}
            title="Trainee"
            description="Access learning modules and track your progress through driving courses."
            onPress={() => handleComingSoon('Trainee')}
            comingSoon
          />
          <RoleCard
            icon="account-group"
            iconBg="#ffdea8"
            iconColor="#5e4200"
            title="Instructor"
            description="Manage students, evaluate sessions, and monitor fleet performance."
            onPress={() => handleComingSoon('Instructor')}
            comingSoon
          />
        </View>

      </ScrollView>

      {/* Background accent */}
      <View style={styles.bgAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface.DEFAULT,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
  } as any,
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
  langToggle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary.DEFAULT,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
  },
  headingBlock: {
    alignItems: 'center',
    marginBottom: 32,
    maxWidth: 320,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.surface.on,
    textAlign: 'center',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 16,
    color: Colors.surface.onVariant,
    textAlign: 'center',
    lineHeight: 24,
  },
  cards: {
    width: '100%',
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 24,
    gap: 16,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardDisabled: {
    opacity: 0.7,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  comingSoonBadge: {
    backgroundColor: Colors.tertiary.container,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  comingSoonText: {
    fontSize: 8,
    fontWeight: '700',
    color: Colors.tertiary.onContainer,
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: 13,
    color: Colors.surface.onVariant,
    lineHeight: 18,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bgAccent: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.primary.container,
    opacity: 0.05,
    zIndex: -1,
  },
});
