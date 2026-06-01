import axios, { AxiosInstance } from 'axios';
import {
  User,
  DrivingSession,
  DrivingStats,
  DashcamDevice,
  DrivingTip,
  AuthResponse,
} from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import * as sb from './supabaseService';

//  Jetson REST client 
// Only used for Jetson-specific calls: /sessions/start, /sessions/{id}/stop, /health.
// Auth, history, stats, tips → Supabase (see below).

const api: AxiosInstance = axios.create({
  baseURL: 'http://192.168.1.137:8000',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

// Reading the IP from the store on every request means the user can update it
// in Settings and the next call immediately picks up the new address without restarting.
api.interceptors.request.use((config) => {
  const { jetsonIp } = useSettingsStore.getState();
  config.baseURL = `http://${jetsonIp}:8000`;
  if (_authToken) config.headers.Authorization = `Bearer ${_authToken}`;
  return config;
});

//  Session DTOs (used by session/index.tsx and supabaseService) 

export interface SessionEventDTO {
  event_type: 'lane_departure' | 'tailgating' | 'red_light' | 'near_miss';
  subtype: 'ahead' | 'ran' | null;
  severity: 'medium' | 'high' | 'critical';
  is_vru: boolean;
  session_time_s: number;
  timestamp: number;
}

export interface SessionSummary {
  session_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  score: number;
  score_label: 'EXCELLENT' | 'GOOD' | 'IMPROVING' | 'NEEDS WORK';
  event_counts: Record<string, number>;
  events: SessionEventDTO[];
  metadata: { speed_limits_seen?: number[]; model_fps_avg?: number };
}

//  Auth — Supabase 

export async function login(nationalId: string, password: string): Promise<AuthResponse> {
  return sb.signIn(nationalId, password);
}

//  Team-backend data — Supabase 

export async function getSessions(userId: string): Promise<DrivingSession[]> {
  const { trips } = await sb.getSessions(userId, 1, 50);
  return trips;
}

export async function getStats(userId: string): Promise<DrivingStats> {
  try {
    return await sb.computeStats(userId);
  } catch {
    return {
      currentScore: 0, maxScore: 5.0, scoreChange: 0,
      totalMistakes: 0, safePoints: 0, trainingHours: 0,
      sessionsThisWeek: 0, topImprovementArea: 'Keep driving!',
    };
  }
}

export async function getDailyTip(): Promise<DrivingTip> {
  try {
    return await sb.getDailyTip();
  } catch {
    return {
      id: 't_0',
      content: 'Maintain a safe following distance of at least 3 seconds from the vehicle ahead.',
      category: 'general',
      date: new Date().toISOString(),
    };
  }
}

export async function getTrips(
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<{ trips: DrivingSession[]; hasMore: boolean }> {
  return sb.getSessions(userId, page, pageSize);
}

//  Device — still local (Jetson handshake is Wi-Fi / SSID based) 

export async function connectDashcam(deviceId: string): Promise<DashcamDevice> {
  try {
    const res = await api.post<DashcamDevice>('/devices/connect', { device_id: deviceId });
    return res.data;
  } catch {
    return {
      id: deviceId,
      name: 'Tamakkan_Cam',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      isConnected: true,
      firmwareVersion: '1.0.0',
    };
  }
}

//  Session — Jetson REST 

// If the Jetson isn't reachable yet (still booting, wrong IP), fall back to a
// timestamp-based local ID so the session can still start and collect alerts.
export async function startSession(deviceId: string): Promise<{ session_id: string }> {
  try {
    const res = await api.post<{ session_id: string }>('/sessions/start', {
      device_id: deviceId,
    });
    return res.data;
  } catch {
    return { session_id: 's_' + Date.now() };
  }
}

// Returning null instead of throwing lets the caller decide whether to use
// the locally computed score or wait for the Jetson's authoritative version.
export async function stopSession(sessionId: string): Promise<SessionSummary | null> {
  try {
    const res = await api.post<SessionSummary>(`/sessions/${sessionId}/stop`);
    return res.data;
  } catch {
    return null;
  }
}

// Keep for any legacy import that may reference the default export
export default api;

// Re-export Supabase helpers used elsewhere
export { User, DrivingStats, DashcamDevice, DrivingTip };
