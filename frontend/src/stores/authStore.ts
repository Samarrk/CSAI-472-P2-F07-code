import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, UserType } from '../types';
import { setAuthToken } from '../services/api';
import { supabase } from '../lib/supabase';
import { getUserProfile, signOut as supabaseSignOut } from '../services/supabaseService';

// Token goes into SecureStore (encrypted on-device) while the user profile
// goes into AsyncStorage , SecureStore can't hold large JSON objects.
const TOKEN_KEY = 'auth_token';
const USER_KEY  = 'auth_user';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  userType: UserType | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (user: User, token: string) => void;
  logout: () => void;
  setUserType: (type: UserType) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  userType: null,
  isLoading: false,

  // Two-stage restore: first try the live Supabase session (handles token refresh),
  // then fall back to the cached credentials for offline/cold-start scenarios.
  initialize: async () => {
    // 1. Try restoring from Supabase persisted session (AsyncStorage under the hood)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const user = await getUserProfile(session.user.id);
        if (user) {
          setAuthToken(session.access_token);
          // Keep SecureStore in sync for the API interceptor fallback
          SecureStore.setItemAsync(TOKEN_KEY, session.access_token).catch(() => {});
          AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
          set({ user, token: session.access_token, isAuthenticated: true, userType: user.userType });
          return;
        }
      }
    } catch { /* network down , fall through to local cache */ }

    // 2. Fallback: SecureStore / AsyncStorage from a previous session
    try {
      const token    = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await AsyncStorage.getItem(USER_KEY);
      if (token && userJson) {
        const user: User = JSON.parse(userJson);
        setAuthToken(token);
        set({ user, token, isAuthenticated: true, userType: user.userType });
      }
    } catch { /* proceed unauthenticated */ }
  },

  login: (user, token) => {
    setAuthToken(token);
    SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
    set({ user, token, isAuthenticated: true, userType: user.userType });
  },

  // Clear everything immediately so the UI redirects before storage catches up.
  // The Supabase sign-out and storage deletions run fire-and-forget.
  logout: () => {
    supabaseSignOut().catch(() => {});
    setAuthToken(null);
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    AsyncStorage.removeItem(USER_KEY).catch(() => {});
    set({ user: null, token: null, isAuthenticated: false, userType: null });
  },

  setUserType: (userType) => set({ userType }),
  setLoading:  (isLoading) => set({ isLoading }),
}));
