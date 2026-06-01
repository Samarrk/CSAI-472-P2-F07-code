import { supabase } from '../lib/supabase';
import { User, DrivingSession, DrivingStats, DrivingTip, DashcamDevice, ScoreLabel, MistakeType } from '../types';
import type { SessionEventDTO } from './api';

//  Helpers 

export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function alertLabel(type: string, subtype?: string | null): string {
  switch (type) {
    case 'lane_departure': return 'Lane Departure';
    case 'tailgating':     return 'Tailgating';
    case 'red_light':      return subtype === 'ran' ? 'Ran Red Light' : 'Red Light Ahead';
    case 'near_miss':      return 'Near Miss';
    default:               return type;
  }
}

function mapDbToUser(profile: Record<string, any>): User {
  return {
    id: profile.id,
    name: profile.full_name,
    nationalId: profile.national_id,
    phone: profile.phone ?? '',
    userType: profile.role as User['userType'],
    joinedAt: profile.created_at,
  };
}

function mapDbToSession(row: Record<string, any>): DrivingSession {
  return {
    id: row.id,
    userId: row.user_id,
    title:
      row.name ??
      `Session · ${new Date(row.started_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMinutes: Math.max(1, Math.ceil((row.duration_seconds ?? 0) / 60)),
    score: row.score ?? 0,
    scoreLabel: (row.score_label as ScoreLabel) ?? 'NEEDS WORK',
    mistakes: ((row.alerts ?? []) as Record<string, any>[]).map((a) => ({
      id: a.id as string,
      type: a.event_type as MistakeType,
      label: alertLabel(a.event_type as string, a.subtype as string | null),
      timestamp: Math.round(a.session_time_s as number),
      severity: a.severity as 'medium' | 'high' | 'critical',
      subtype: a.subtype ?? undefined,
      is_vru: a.is_vru as boolean,
    })),
  };
}

//  Auth 

export async function signIn(
  nationalId: string,
  password: string,
): Promise<{ user: User; token: string }> {
  // Supabase Auth requires an email field. Since users register by national ID,
  // we construct a virtual email using a tamakkan.sa domain that never actually receives mail.
  const email = `${nationalId}@tamakkan.sa`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .single();
  if (profileError || !profile) throw new Error('User profile not found.');

  return { user: mapDbToUser(profile), token: data.session.access_token };
}

export async function signUp(params: {
  nationalId: string;
  password: string;
  fullName: string;
  email?: string;
  phone?: string;
  dob?: string; // "DD/MM/YYYY"
}): Promise<{ user: User; token: string }> {
  const { nationalId, password, fullName, email, phone, dob } = params;
  const authEmail = `${nationalId}@tamakkan.sa`;

  const { data, error } = await supabase.auth.signUp({ email: authEmail, password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Sign-up failed. Please try again.');

  let dateOfBirth: string | null = null;
  if (dob && dob.length === 10) {
    const [dd, mm, yyyy] = dob.split('/');
    if (dd && mm && yyyy) dateOfBirth = `${yyyy}-${mm}-${dd}`;
  }

  const { error: insertError } = await supabase.from('users').insert({
    id: data.user.id,
    full_name: fullName,
    national_id: nationalId,
    email: email || null,
    phone: phone || null,
    date_of_birth: dateOfBirth,
    role: 'individual',
  });
  if (insertError) throw new Error(insertError.message);

  const user: User = {
    id: data.user.id,
    name: fullName,
    nationalId,
    phone: phone ?? '',
    userType: 'individual',
    joinedAt: data.user.created_at,
  };

  return { user, token: data.session?.access_token ?? '' };
}

export async function getUserProfile(userId: string): Promise<User | null> {
  const { data } = await supabase.from('users').select('*').eq('id', userId).single();
  return data ? mapDbToUser(data) : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

//  Sessions 

export async function saveSessionToDb(
  session: DrivingSession,
  userId: string,
  deviceId?: string,
  _jetsonEvents?: SessionEventDTO[],
): Promise<void> {
  const laneDep   = session.mistakes.filter((m) => m.type === 'lane_departure').length;
  const tailgating = session.mistakes.filter((m) => m.type === 'tailgating').length;
  const redLight  = session.mistakes.filter((m) => m.type === 'red_light').length;
  const nearMiss  = session.mistakes.filter((m) => m.type === 'near_miss').length;
  const dangerCount  = session.mistakes.filter((m) => m.severity !== 'medium').length;
  const warningCount = session.mistakes.filter((m) => m.severity === 'medium').length;

  // device_id is a foreign key in Supabase. Local mock IDs like 'cam_1234567'
  // aren't valid UUIDs, so we null them out to avoid a constraint violation.
  const { error: sessionError } = await supabase.from('sessions').insert({
    id: session.id,
    user_id: userId,
    device_id: deviceId && isUUID(deviceId) ? deviceId : null,
    name: session.title,
    score: session.score,
    score_label: session.scoreLabel,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? new Date().toISOString(),
    duration_seconds: session.durationMinutes * 60,
    total_alerts: session.mistakes.length,
    lane_departure_count: laneDep,
    tailgating_count: tailgating,
    red_light_count: redLight,
    near_miss_count: nearMiss,
    danger_count: dangerCount,
    warning_count: warningCount,
  });
  if (sessionError) throw new Error(sessionError.message);

  if (session.mistakes.length > 0) {
    const startMs = new Date(session.startedAt).getTime();
    const alertRows = session.mistakes.map((m) => ({
      session_id: session.id,
      user_id: userId,
      event_type: m.type,
      subtype: m.subtype ?? null,
      severity: m.severity,
      is_vru: m.is_vru ?? false,
      session_time_s: m.timestamp,
      timestamp: new Date(startMs + m.timestamp * 1000).toISOString(),
    }));
    await supabase.from('alerts').insert(alertRows);
  }

  // Rolling 7-day average gives a smoother trend line than a single session score.
  // This is what the Home screen's "vs last week" percentage is based on.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentScores } = await supabase
    .from('score_history')
    .select('score')
    .eq('user_id', userId)
    .gte('recorded_at', sevenDaysAgo);

  const scorePool = [...(recentScores?.map((r) => r.score as number) ?? []), session.score];
  const avg7d =
    scorePool.reduce((a, b) => a + b, 0) / scorePool.length;

  const topType = (['lane_departure', 'tailgating', 'red_light', 'near_miss'] as MistakeType[])
    .map((t) => ({ t, n: session.mistakes.filter((m) => m.type === t).length }))
    .sort((a, b) => b.n - a.n)[0];

  await supabase.from('score_history').insert({
    user_id: userId,
    session_id: session.id,
    score: session.score,
    avg_7d: Math.round(avg7d * 100) / 100,
    top_improvement: session.mistakes.length > 0 ? alertLabel(topType.t) : null,
  });
}

export async function getSessions(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ trips: DrivingSession[]; hasMore: boolean }> {
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  const { data, error, count } = await supabase
    .from('sessions')
    .select(
      'id, user_id, name, score, score_label, started_at, ended_at, duration_seconds, alerts(id, event_type, subtype, severity, is_vru, session_time_s)',
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .range(start, end);

  if (error) throw new Error(error.message);

  return {
    trips: (data ?? []).map(mapDbToSession),
    hasMore: (count ?? 0) > end + 1,
  };
}

export async function computeStats(userId: string): Promise<DrivingStats> {
  const { data: sessions } = await supabase
    .from('sessions')
    .select(
      'score, duration_seconds, total_alerts, lane_departure_count, tailgating_count, red_light_count, near_miss_count, started_at',
    )
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (!sessions || sessions.length === 0) {
    return {
      currentScore: 0,
      maxScore: 5.0,
      scoreChange: 0,
      totalMistakes: 0,
      safePoints: 0,
      trainingHours: 0,
      sessionsThisWeek: 0,
      topImprovementArea: 'Keep driving!',
    };
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const thisWeek = sessions.filter((s) => s.started_at >= weekAgo);
  const prevWeek = sessions.filter((s) => s.started_at >= twoWeeksAgo && s.started_at < weekAgo);

  const currentScore = sessions[0].score ?? 0;
  const lastScore: number | undefined = sessions[1]?.score ?? undefined;
  const totalMistakes = sessions.reduce((s, d) => s + (d.total_alerts ?? 0), 0);
  const trainingHours =
    sessions.reduce((s, d) => s + (d.duration_seconds ?? 0), 0) / 3600;

  const thisWeekAvg = thisWeek.length
    ? thisWeek.reduce((s, d) => s + (d.score as number), 0) / thisWeek.length
    : 0;
  const prevWeekAvg = prevWeek.length
    ? prevWeek.reduce((s, d) => s + (d.score as number), 0) / prevWeek.length
    : thisWeekAvg;
  const scoreChange =
    prevWeekAvg > 0 ? Math.round(((thisWeekAvg - prevWeekAvg) / prevWeekAvg) * 100) : 0;

  const typeCounts: Record<string, number> = {
    'Lane Departure': sessions.reduce((s, d) => s + (d.lane_departure_count ?? 0), 0),
    'Tailgating':     sessions.reduce((s, d) => s + (d.tailgating_count ?? 0), 0),
    'Red Light':      sessions.reduce((s, d) => s + (d.red_light_count ?? 0), 0),
    'Near Miss':      sessions.reduce((s, d) => s + (d.near_miss_count ?? 0), 0),
  };
  const topEntry = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  const topImprovementArea = (topEntry?.[1] ?? 0) > 0 ? topEntry[0] : 'Safe Driving';

  return {
    currentScore,
    maxScore: 5.0,
    scoreChange,
    totalMistakes,
    safePoints: Math.round(currentScore * 100),
    trainingHours: Math.round(trainingHours * 10) / 10,
    sessionsThisWeek: thisWeek.length,
    topImprovementArea,
    lastScore,
  };
}

//  Tips 

const FALLBACK_TIP =
  'Maintain a safe following distance of at least 3 seconds from the vehicle ahead.';

export async function getDailyTip(): Promise<DrivingTip> {
  const { count } = await supabase
    .from('tips')
    .select('*', { count: 'exact', head: true });

  if (!count) {
    return { id: 't_0', content: FALLBACK_TIP, category: 'general', date: new Date().toISOString() };
  }

  const offset = Math.floor(Math.random() * count);
  const { data } = await supabase
    .from('tips')
    .select('id, message_en')
    .range(offset, offset);

  const tip = data?.[0];
  return {
    id: String(tip?.id ?? 't_0'),
    content: (tip?.message_en as string | null) ?? FALLBACK_TIP,
    category: 'general',
    date: new Date().toISOString(),
  };
}

//  Devices 

export async function getDevices(userId: string): Promise<DashcamDevice[]> {
  const { data } = await supabase
    .from('devices')
    .select('id, name, mac_address, is_connected, last_seen')
    .eq('user_id', userId)
    .order('last_seen', { ascending: false });

  return ((data ?? []) as Record<string, any>[]).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    macAddress: d.mac_address as string,
    isConnected: d.is_connected as boolean,
    firmwareVersion: '1.0.0',
    lastConnected: d.last_seen as string | undefined,
  }));
}

// MAC address is the conflict key — if the same physical device pairs again
// on a different session, this just updates the record rather than creating a duplicate.
export async function upsertDevice(
  userId: string,
  device: DashcamDevice,
): Promise<string> {
  const { data, error } = await supabase
    .from('devices')
    .upsert(
      {
        user_id: userId,
        mac_address: device.macAddress,
        name: device.name,
        is_connected: device.isConnected,
        last_seen: device.lastConnected ?? new Date().toISOString(),
      },
      { onConflict: 'mac_address' },
    )
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function deleteDevice(macAddress: string): Promise<void> {
  await supabase.from('devices').delete().eq('mac_address', macAddress);
}
