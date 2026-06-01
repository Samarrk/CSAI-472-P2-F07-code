import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';

const { width } = Dimensions.get('window');

type WelcomeSlide = { key: string; type: 'welcome' };
type FeatureSlide = {
  key: string;
  type: 'feature';
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  gradient: readonly [string, string];
  badgeLabel: string;
  badgeValue: string;
  badgeValueColor: string;
  badgeIconBg: string;
  badgeIconColor: string;
  desc: string;
};
type Slide = WelcomeSlide | FeatureSlide;

const SLIDES: Slide[] = [
  { key: 'welcome', type: 'welcome' },
  {
    key: 'detect',
    type: 'feature',
    icon: 'eye-outline',
    gradient: ['#003a3a', '#001c1c'],
    badgeLabel: 'AI SAFETY',
    badgeValue: 'Detects Dangers',
    badgeValueColor: Colors.primary.container,
    badgeIconBg: Colors.primary.onContainer,
    badgeIconColor: Colors.primary.container,
    desc: 'Spots lane departures, tailgating, and near-miss events the moment they happen.',
  },
  {
    key: 'alerts',
    type: 'feature',
    icon: 'microphone-outline',
    gradient: ['#002e1e', '#001209'],
    badgeLabel: 'VOICE AI',
    badgeValue: 'Speaks Alerts',
    badgeValueColor: Colors.secondary.DEFAULT,
    badgeIconBg: Colors.secondary.fixed,
    badgeIconColor: Colors.secondary.DEFAULT,
    desc: 'Real-time audio warnings reach you before a risk turns into an accident.',
  },
  {
    key: 'tracks',
    type: 'feature',
    icon: 'chart-line',
    gradient: ['#3a2800', '#1c1200'],
    badgeLabel: 'ANALYTICS',
    badgeValue: 'Tracks Progress',
    badgeValueColor: Colors.tertiary.container,
    badgeIconBg: Colors.tertiary.onContainer,
    badgeIconColor: Colors.tertiary.DEFAULT,
    desc: 'Every session is scored and analyzed so you improve with every drive.',
  },
];

export default function SplashScreen() {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList<Slide>>(null);

  const isLast = index === SLIDES.length - 1;

  // Manually scroll the FlatList AND update the index state so the dots stay
  // in sync whether the user taps Next or physically swipes between slides.
  const goNext = () => {
    const next = index + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };

  // Permissions are requested here, once, before any screen that actually needs them.
  // Denying either one is fine — the app degrades gracefully, so we never block the user.
  const getStarted = async () => {
    setLoading(true);
    try {
      await Audio.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    } catch {
      // proceed regardless
    } finally {
      setLoading(false);
      router.replace('/(auth)/user-type');
    }
  };

  const renderSlide = ({ item }: { item: Slide }) => {
    if (item.type === 'welcome') {
      return (
        <View style={[styles.slide, styles.welcomeSlide, { width }]}>
          <AppLogo size="large" />
          <View style={styles.headingWrap}>
            <Text style={styles.heading}>Welcome to Tamakkan</Text>
            <Text style={styles.subtitle}>Smart Driving Assessment</Text>
          </View>
        </View>
      );
    }

    // Feature slide — same visual structure as the welcome slide
    return (
      <View style={[styles.slide, { width }]}>
        <View style={styles.imageWrap}>
          {/* Gradient box with large icon */}
          <View style={styles.featureBox}>
            <LinearGradient
              colors={item.gradient}
              style={styles.featureGradient}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={110}
                color="rgba(255,255,255,0.88)"
              />
            </LinearGradient>
          </View>

          {/* Floating badge */}
          <View style={styles.badge}>
            <View style={[styles.badgeIconWrap, { backgroundColor: item.badgeIconBg }]}>
              <MaterialCommunityIcons
                name={item.icon}
                size={20}
                color={item.badgeIconColor}
              />
            </View>
            <View>
              <Text style={styles.badgeLabel}>{item.badgeLabel}</Text>
              <Text style={[styles.badgeValue, { color: item.badgeValueColor }]}>
                {item.badgeValue}
              </Text>
            </View>
          </View>
        </View>

        {/* Small explanation */}
        <Text style={styles.featureDesc}>{item.desc}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Decorative glow circles */}
      <View style={[styles.glowTL, { top: -80, left: -80 }]} />
      <View style={[styles.glowBR, { bottom: -80, right: -80 }]} />

      {/* Swipeable slides — fills all available space */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setIndex(newIndex);
        }}
        style={styles.list}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      {/* Bottom: dots + button + skip */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity
          onPress={isLast ? getStarted : goNext}
          activeOpacity={0.85}
          disabled={loading}
          style={styles.btn}
        >
          <Text style={styles.btnText}>
            {isLast ? (loading ? 'Setting up…' : 'Get Started') : 'Next'}
          </Text>
          <MaterialCommunityIcons
            name={isLast ? 'check-circle-outline' : 'arrow-right'}
            size={20}
            color="#fff"
          />
        </TouchableOpacity>

        {!isLast && (
          <TouchableOpacity onPress={getStarted} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  glowTL: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: Colors.primary.fixed,
    opacity: 0.1,
  },
  glowBR: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: Colors.secondary.fixed,
    opacity: 0.1,
  },

  // ── Slides ──
  list: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 28,
  },
  welcomeSlide: {
    gap: 20,
  },

  // Welcome slide
  headingWrap: {
    alignItems: 'center',
    gap: 6,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.surface.on,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.surface.onVariant,
    textAlign: 'center',
  },
  // Shared: image/feature box + badge
  imageWrap: {
    position: 'relative',
    marginBottom: 24,
  },
  featureBox: {
    width: 264,
    height: 264,
    borderRadius: 32,
    overflow: 'hidden',
  },
  featureGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  badge: {
    position: 'absolute',
    bottom: -16,
    right: -16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  badgeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary.container,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.surface.onVariant,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  badgeValue: {
    fontSize: 14,
    fontWeight: '700',
  },

  // Feature description
  featureDesc: {
    fontSize: 15,
    color: Colors.surface.onVariant,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 8,
  },

  // ── Bottom ──
  bottom: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.outline.variant,
  },
  dotActive: {
    width: 24,
    backgroundColor: Colors.primary.container,
  },
  btn: {
    width: '100%',
    height: 56,
    backgroundColor: Colors.primary.container,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: Colors.primary.container,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  skip: {
    fontSize: 14,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },
});
