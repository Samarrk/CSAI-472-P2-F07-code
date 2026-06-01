import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/theme/colors';
import AppLogo from '@/components/AppLogo';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { getTrips } from '@/services/api';
import { getTripCache, saveTripCache } from '@/utils/tripCache';
import { DrivingSession } from '@/types';
import { formatDate, formatDuration, getScoreColor } from '@/utils/formatters';

const PAGE_SIZE = 10;

//  Stats helpers 

type TripStats = {
  totalTrips: number;
  avgScore: number;
  totalEvents: number;
  totalMinutes: number;
  topAlertLabel: string | null;
  topAlertCount: number;
};

function computeStats(trips: DrivingSession[]): TripStats | null {
  if (trips.length === 0) return null;
  const totalEvents = trips.reduce((s, t) => s + t.mistakes.length, 0);
  const avgScore = trips.reduce((s, t) => s + t.score, 0) / trips.length;
  const totalMinutes = trips.reduce((s, t) => s + t.durationMinutes, 0);
  const typeCounts: Record<string, { count: number; label: string }> = {};
  trips.forEach((t) =>
    t.mistakes.forEach((m) => {
      if (!typeCounts[m.type]) typeCounts[m.type] = { count: 0, label: m.label };
      typeCounts[m.type].count++;
    }),
  );
  const top = Object.values(typeCounts).sort((a, b) => b.count - a.count)[0];
  return {
    totalTrips: trips.length,
    avgScore,
    totalEvents,
    totalMinutes,
    topAlertLabel: top?.label ?? null,
    topAlertCount: top?.count ?? 0,
  };
}

function StatCell({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.statCell}>
      <MaterialCommunityIcons name={icon} size={20} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatsCard({ stats }: { stats: TripStats }) {
  const avgColor = getScoreColor(stats.avgScore);
  return (
    <View style={styles.statsCard}>
      <Text style={styles.statsCardTitle}>Overview</Text>
      <View style={styles.statsRow}>
        <StatCell
          icon="car-multiple"
          label="Trips"
          value={String(stats.totalTrips)}
          color={Colors.primary.DEFAULT}
        />
        <View style={styles.statsVDivider} />
        <StatCell
          icon="star-circle-outline"
          label="Avg Score"
          value={`${stats.avgScore.toFixed(1)}/5`}
          color={avgColor}
        />
        <View style={styles.statsVDivider} />
        <StatCell
          icon="clock-time-four-outline"
          label="Drive Time"
          value={formatDuration(stats.totalMinutes)}
          color={Colors.secondary.DEFAULT}
        />
        <View style={styles.statsVDivider} />
        <StatCell
          icon="alert-outline"
          label="Alerts"
          value={String(stats.totalEvents)}
          color={stats.totalEvents > 0 ? Colors.tertiary.DEFAULT : Colors.secondary.DEFAULT}
        />
      </View>

      {stats.topAlertLabel && (
        <>
          <View style={styles.statsHDivider} />
          <View style={styles.topAlertRow}>
            <View style={styles.topAlertIconWrap}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={Colors.tertiary.DEFAULT}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topAlertCaption}>Most Frequent Alert</Text>
              <Text style={styles.topAlertLabel}>{stats.topAlertLabel}</Text>
            </View>
            <View style={styles.topAlertBadge}>
              <Text style={styles.topAlertCount}>{stats.topAlertCount}×</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = getScoreColor(score);
  return (
    <View style={[styles.scoreBadge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[styles.scoreNum, { color }]}>{score.toFixed(1)}</Text>
      <Text style={[styles.scoreMax, { color }]}>/5</Text>
    </View>
  );
}

function TripCard({ session, onPress }: { session: DrivingSession; onPress: () => void }) {
  const accentColor = getScoreColor(session.score);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.cardWrap}>
      <View style={[styles.card, { borderLeftColor: accentColor }]}>
        <View style={styles.cardIconWrap}>
          <MaterialCommunityIcons name="video-outline" size={22} color={Colors.primary.DEFAULT} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{session.title}</Text>
          <View style={styles.cardMeta}>
            <MaterialCommunityIcons name="calendar-outline" size={13} color={Colors.outline.DEFAULT} />
            <Text style={styles.cardMetaText}>{formatDate(session.startedAt)}</Text>
            <Text style={styles.cardMetaDot}>·</Text>
            <MaterialCommunityIcons name="clock-outline" size={13} color={Colors.outline.DEFAULT} />
            <Text style={styles.cardMetaText}>{formatDuration(session.durationMinutes)}</Text>
            {session.mistakes.length > 0 && (
              <>
                <Text style={styles.cardMetaDot}>·</Text>
                <MaterialCommunityIcons name="alert-outline" size={13} color={Colors.tertiary.DEFAULT} />
                <Text style={[styles.cardMetaText, { color: Colors.tertiary.DEFAULT }]}>
                  {session.mistakes.length} alert{session.mistakes.length !== 1 ? 's' : ''}
                </Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.cardRight}>
          <ScoreBadge score={session.score} />
          <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.outline.DEFAULT} style={{ marginTop: 4 }} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name="car-clock" size={48} color={Colors.primary.container} />
      </View>
      <Text style={styles.emptyTitle}>No history yet</Text>
      <Text style={styles.emptySubtitle}>Start and save a driving session to see your trip history here.</Text>
    </View>
  );
}

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? 'u_001';
  const setSessions = useSessionStore((s) => s.setSessions);

  const [trips, setTrips] = useState<DrivingSession[]>([]);
  // computeStats iterates over all trips — memo keeps it from re-running on every parent render.
  const stats = useMemo(() => computeStats(trips), [trips]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const fetchingRef = useRef(false);

  // Cache loads synchronously on mount so the list is populated before any network call completes.
  // This avoids a spinner flash when navigating back to this tab after the first load.
  const loadFromCache = useCallback(async () => {
    const cached = await getTripCache(userId);
    if (cached.length > 0) {
      setTrips(cached);
      setSessions(cached);
    }
  }, [userId, setSessions]);

  const fetchPage = useCallback(
    async (page: number, append = false) => {
      // ref guard instead of state so toggling it never triggers a re-render.
      // onEndReached can fire multiple times before the previous fetch resolves.
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const { trips: fresh, hasMore: more } = await getTrips(userId, page, PAGE_SIZE);
        setHasMore(more);
        setTrips((prev) => {
          // On a fresh page-1 fetch, keep any sessions the user saved in-app that the API
          // doesn't know about yet (e.g. saved mid-session before the backend caught up).
          const freshIds = new Set(fresh.map((s) => s.id));
          const localOnly = page === 1 ? prev.filter((s) => !freshIds.has(s.id)) : [];
          const next = append ? [...prev, ...fresh] : [...localOnly, ...fresh];
          saveTripCache(userId, next);
          setSessions(next);
          return next;
        });
        pageRef.current = page;
      } finally {
        fetchingRef.current = false;
      }
    },
    [userId, setSessions],
  );

  // Show cached data immediately, then flip loading off without waiting for the network.
  // Pull-to-refresh is the user-driven path to get fresh data from the server.
  useEffect(() => {
    (async () => {
      await loadFromCache();
      setLoading(false);
    })();
  }, [loadFromCache]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPage(1);
    setRefreshing(false);
  }, [fetchPage]);

  const onLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await fetchPage(pageRef.current + 1, true);
    setLoadingMore(false);
  }, [hasMore, loadingMore, fetchPage]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header — preserved from original Lamar design */}
      <View style={styles.header}>
        <AppLogo size="mini" />
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/profile')}
          hitSlop={12}
          style={styles.profileBtn}
        >
          <MaterialCommunityIcons name="account" size={22} color={Colors.primary.container} />
        </TouchableOpacity>
      </View>

      {/* Page title */}
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>History</Text>
        {trips.length > 0 && (
          <Text style={styles.tripCount}>{trips.length} trips</Text>
        )}
      </View>

      {loading && trips.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary.DEFAULT} />
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
            trips.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[Colors.primary.DEFAULT]}
              tintColor={Colors.primary.DEFAULT}
            />
          }
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={stats ? <StatsCard stats={stats} /> : null}
          ListEmptyComponent={<EmptyState />}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={Colors.primary.DEFAULT} style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <TripCard
              session={item}
              onPress={() => router.push(`/trip/${item.id}`)}
            />
          )}
        />
      )}
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
    backgroundColor: '#fff',
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  profileBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${Colors.primary.container}22`,
    borderWidth: 2,
    borderColor: Colors.primary.container,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  tripCount: {
    fontSize: 13,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 4,
  },
  listEmpty: {
    flex: 1,
  },
  //  Stats card 
  statsCard: {
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    marginBottom: 6,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  statsCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.outline.DEFAULT,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
    textAlign: 'center',
  },
  statsVDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.surface.containerHigh,
  },
  statsHDivider: {
    height: 1,
    backgroundColor: Colors.surface.containerHigh,
    marginTop: 14,
    marginBottom: 12,
  },
  topAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topAlertIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${Colors.tertiary.DEFAULT}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  topAlertCaption: {
    fontSize: 11,
    color: Colors.outline.DEFAULT,
    fontWeight: '500',
  },
  topAlertLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.surface.on,
    marginTop: 1,
  },
  topAlertBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: `${Colors.tertiary.DEFAULT}18`,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${Colors.tertiary.DEFAULT}40`,
  },
  topAlertCount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.tertiary.DEFAULT,
  },
  //  Trip card 
  cardWrap: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface.containerLowest,
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: Colors.primary.tint,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 2,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 5,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.surface.on,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 3,
  },
  cardMetaText: {
    fontSize: 12,
    color: Colors.outline.DEFAULT,
  },
  cardMetaDot: {
    fontSize: 12,
    color: Colors.outline.variant,
  },
  cardRight: {
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  //  Score badge 
  scoreBadge: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 44,
    alignItems: 'center',
  },
  scoreNum: {
    fontSize: 16,
    fontWeight: '700',
  },
  scoreMax: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: -1,
  },
  //  Empty state 
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
    paddingTop: 48,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: `${Colors.primary.container}18`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.surface.on,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.outline.DEFAULT,
    textAlign: 'center',
    lineHeight: 20,
  },
});
