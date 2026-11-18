import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
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
