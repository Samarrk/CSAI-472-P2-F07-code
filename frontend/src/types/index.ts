// Three roles are planned, but only 'individual' is live right now.
// Trainee and instructor flows get unlocked in future releases.
export type UserType = 'individual' | 'trainee' | 'instructor';

export interface User {
  id: string;
  name: string;
  nationalId: string;
  phone: string;
  userType: UserType;
  avatarUrl?: string;
  joinedAt: string;
}

export type ScoreLabel = 'EXCELLENT' | 'GOOD' | 'IMPROVING' | 'NEEDS WORK';

// Only what the Jetson's sensors can actually detect (see BACKEND_SPEC.md §2).
export type MistakeType =
  | 'lane_departure'
  | 'tailgating'
  | 'red_light'
  | 'near_miss';

// A single safety event captured during a session.
// timestamp is relative to session start, not a wall-clock time.
export interface Mistake {
  id: string;
  type: MistakeType;
  label: string;
  timestamp: number;                          // seconds since session start
  severity: 'medium' | 'high' | 'critical';
  subtype?: string | null;                    // red_light: 'ahead' | 'ran'
  is_vru?: boolean;                           // near_miss: pedestrian/VRU flag
}

export interface DrivingSession {
  id: string;
  userId: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes: number;
  score: number;
  scoreLabel: ScoreLabel;
  thumbnailUrl?: string;
  mistakes: Mistake[];
  videoUrl?: string;
}

export interface DrivingStats {
  currentScore: number;
  maxScore: number;
  scoreChange: number;
  totalMistakes: number;
  safePoints: number;
  trainingHours: number;
  sessionsThisWeek: number;
  topImprovementArea: string;
  lastScore?: number;
}

// Represents a paired Jetson device. The id here is a local UUID assigned at pairing time,
// not the MAC address , the MAC is used for deduplication on the Supabase side.
export interface DashcamDevice {
  id: string;
  name: string;
  macAddress: string;
  isConnected: boolean;
  batteryLevel?: number;
  firmwareVersion: string;
  lastConnected?: string;
  ssid?: string;
}

export interface DrivingTip {
  id: string;
  content: string;
  category: MistakeType | 'general';
  date: string;
}

export interface LoginPayload {
  nationalId: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
