import Constants from 'expo-constants';

type SupabaseExtra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const extra = Constants.expoConfig?.extra as SupabaseExtra | undefined;

const url = (extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '')
  .trim()
  .replace(/\/$/, '');
const anon = (extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon);
}

export function getSupabaseUrl(): string {
  return url;
}

export function getSupabaseAnonKey(): string {
  return anon;
}
