import { create } from 'zustand';
import { DrivingSession, DrivingStats, DrivingTip, DashcamDevice } from '../types';

interface SessionState {
  dashcamConnected: boolean;
  dashcamDevice: DashcamDevice | null;
  activeSessionId: string | null;
  sessions: DrivingSession[];
  stats: DrivingStats | null;
  dailyTip: DrivingTip | null;
  isLoadingStats: boolean;
  isLoadingSessions: boolean;
  savedDevices: DashcamDevice[];

  setDashcamConnected: (connected: boolean, device?: DashcamDevice) => void;
  setSessions: (sessions: DrivingSession[]) => void;
  setStats: (stats: DrivingStats) => void;
  setDailyTip: (tip: DrivingTip) => void;
  startSession: (sessionId: string) => void;
  stopSession: (completedSession?: DrivingSession) => void;
  setLoadingStats: (loading: boolean) => void;
  setLoadingSessions: (loading: boolean) => void;
  addSavedDevice: (device: DashcamDevice) => void;
  removeSavedDevice: (deviceId: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  dashcamConnected: false,
  dashcamDevice: null,
  activeSessionId: null,
  sessions: [],
  stats: null,
  dailyTip: null,
  isLoadingStats: false,
  isLoadingSessions: false,
  savedDevices: [],

  setDashcamConnected: (connected, device) =>
    set({ dashcamConnected: connected, dashcamDevice: device ?? null }),

  setSessions: (sessions) => set({ sessions }),
  setStats: (stats) => set({ stats }),
  setDailyTip: (dailyTip) => set({ dailyTip }),

  startSession: (sessionId) => set({ activeSessionId: sessionId }),

  // Prepend so the newest session always appears first on the history screen
  // without needing a re-sort pass.
  stopSession: (completedSession) =>
    set((state) => ({
      activeSessionId: null,
      sessions: completedSession
        ? [completedSession, ...state.sessions]
        : state.sessions,
    })),

  setLoadingStats: (isLoadingStats) => set({ isLoadingStats }),
  setLoadingSessions: (isLoadingSessions) => set({ isLoadingSessions }),

  // Remove any existing entry with the same id before inserting at the top,
  // so reconnecting an already-known device just refreshes its lastConnected timestamp.
  addSavedDevice: (device) => {
    const existing = get().savedDevices;
    const withoutDuplicate = existing.filter((d) => d.id !== device.id);
    set({ savedDevices: [device, ...withoutDuplicate] });
  },

  removeSavedDevice: (deviceId) =>
    set((state) => ({
      savedDevices: state.savedDevices.filter((d) => d.id !== deviceId),
    })),
}));
