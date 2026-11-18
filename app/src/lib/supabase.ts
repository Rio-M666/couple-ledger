import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// AsyncStorage reads window.localStorage on web and crashes during SSR,
// so the server render gets a throwaway in-memory storage instead.
const serverMemory = new Map<string, string>();
const storage = typeof window === 'undefined'
  ? {
      getItem: (key: string) => Promise.resolve(serverMemory.get(key) ?? null),
      setItem: (key: string, value: string) => {
        serverMemory.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        serverMemory.delete(key);
        return Promise.resolve();
      },
    }
  : AsyncStorage;

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
}) : null;

if (supabase && Platform.OS !== 'web') {
  const auth = supabase.auth;
  AppState.addEventListener('change', state => {
    if (state === 'active') void auth.startAutoRefresh();
    else void auth.stopAutoRefresh();
  });
}
