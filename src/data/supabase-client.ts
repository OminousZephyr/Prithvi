import { createClient } from '@supabase/supabase-js';
import type { AuthStorage } from '@/features/account/account-types';
import { localStore } from '@/data/storage/local-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const storage: AuthStorage = {
  async getItem(key) { return (await localStore.get<{ id: string; value: string }>('auth-session', key))?.value ?? null; },
  async setItem(key, value) { await localStore.save('auth-session', { id: key, value }); },
  async removeItem(key) { await localStore.remove?.('auth-session', key); },
};

export const supabaseConfigured = !!url && !!publicKey && isSupabaseUrl(url);
export const supabaseClient = makeClient();

function makeClient() {
  if (!supabaseConfigured) return undefined;
  try { return createClient(url!, publicKey!, { auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }); }
  catch { return undefined; }
}

function isSupabaseUrl(value: string) {
  try { const parsed = new URL(value); return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'; }
  catch { return false; }
}
