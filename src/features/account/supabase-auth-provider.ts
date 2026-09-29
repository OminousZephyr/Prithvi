import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthProvider } from './account-types.ts';

export class SupabaseAuthProvider implements AuthProvider {
  private readonly client?: SupabaseClient;
  constructor(client?: SupabaseClient) { this.client = client; }
  get configured() { return !!this.client; }
  async requestOtp(phone: string) {
    if (!this.client) throw new Error('Account sign-in is not configured on this app.');
    const { error } = await this.client.auth.signInWithOtp({ phone });
    if (error) throw error;
  }
  async verifyOtp(phone: string, otp: string) {
    if (!this.client) throw new Error('Account sign-in is not configured on this app.');
    const { data, error } = await this.client.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) throw error;
    if (!data.user?.id) throw new Error('The verification did not return an account.');
    return { userId: data.user.id, phone: data.user.phone ?? phone, displayName: profileName(data.user.user_metadata) };
  }
  async signOut() {
    if (!this.client) return;
    // Local sign-out must still work when the phone is offline.
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
  async restoreSession() {
    if (!this.client) return undefined;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    return session?.user ? { userId: session.user.id, phone: session.user.phone ?? undefined, displayName: profileName(session.user.user_metadata) } : undefined;
  }
  async updateProfile(displayName: string) {
    if (!this.client) throw new Error('Account sign-in is not configured on this app.');
    const { error } = await this.client.auth.updateUser({ data: { display_name: displayName } });
    if (error) throw error;
  }
  async getAccessToken() {
    if (!this.client) return undefined;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return data.session?.access_token;
  }
}

function profileName(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const name = (value as Record<string, unknown>).display_name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}
