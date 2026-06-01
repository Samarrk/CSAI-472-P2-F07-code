import AsyncStorage from '@react-native-async-storage/async-storage';
import { DrivingSession } from '@/types';

// Per-user keys so two accounts on the same device never bleed into each other.
const cacheKey = (userId: string) => `tripCache_${userId}`;

// Silent failure is intentional , a failed cache write shouldn't surface as an error.
export async function saveTripCache(userId: string, trips: DrivingSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(trips));
  } catch {}
}

export async function getTripCache(userId: string): Promise<DrivingSession[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as DrivingSession[]) : [];
  } catch {
    return [];
  }
}
