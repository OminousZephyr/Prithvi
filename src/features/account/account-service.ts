import type { AuthProvider, AuthSnapshot, AuthStatus, LocalAccount } from './account-types.ts';

export interface AccountStore {
  get<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

export class AccountService {
  private readonly store: AccountStore;
  private readonly provider?: AuthProvider;
  constructor(store: AccountStore, provider?: AuthProvider) { this.store = store; this.provider = provider; }

  get configured() { return this.provider?.configured ?? false; }

  async getAccessToken() { return this.provider?.getAccessToken?.(); }

  async snapshot(): Promise<AuthSnapshot> {
    const account = await this.ensureLocalAccount();
    return { status: account.status, localUserId: account.localUserId, remoteUserId: account.remoteUserId, phone: account.phone, displayName: account.displayName, profileSyncStatus: account.profileSyncStatus, configured: this.configured };
  }

  async continueOffline() { return this.saveStatus('offline_user'); }

  async requestOtp(phone: string) {
    const normalized = normalizeE164(phone);
    if (!this.provider?.configured) throw new Error('Account sign-in is not configured on this app.');
    const previous = await this.ensureLocalAccount();
    await this.saveStatus('otp_requested', normalized);
    try { await this.provider.requestOtp(normalized); }
    catch (error) { await this.store.save<LocalAccount>('local-account', { ...previous, updatedAt: new Date().toISOString() }); throw error; }
    return this.snapshot();
  }

  async verifyOtp(phone: string, otp: string) {
    const normalized = normalizeE164(phone);
    if (!/^\d{4,10}$/.test(otp.trim())) throw new Error('Enter the verification code from your message.');
    if (!this.provider?.configured) throw new Error('Account sign-in is not configured on this app.');
    const previous = await this.ensureLocalAccount();
    await this.saveStatus('verifying', normalized);
    let result: { userId: string; phone?: string; displayName?: string };
    try { result = await this.provider.verifyOtp(normalized, otp.trim()); }
    catch (error) { await this.store.save<LocalAccount>('local-account', { ...previous, status: 'otp_requested', phone: normalized, updatedAt: new Date().toISOString() }); throw error; }
    const account = await this.ensureLocalAccount();
    const name = account.displayName ?? result.displayName;
    const updated = await this.store.save<LocalAccount>('local-account', { ...account, remoteUserId: result.userId, phone: result.phone ?? normalized, displayName: name, status: 'signed_in', profileSyncStatus: name && name !== result.displayName ? 'pending' : name ? 'synced' : undefined, updatedAt: new Date().toISOString() });
    await this.pushProfileIfPending(updated);
    return this.snapshot();
  }

  async restoreSession() {
    const account = await this.ensureLocalAccount();
    if (!this.provider?.configured) return this.snapshot();
    try {
      const session = await this.provider.restoreSession();
      if (session) {
        const name = account.displayName ?? session.displayName;
        const updated = await this.store.save<LocalAccount>('local-account', { ...account, remoteUserId: session.userId, phone: session.phone ?? account.phone, displayName: name, profileSyncStatus: name && name !== session.displayName ? 'pending' : name ? 'synced' : account.profileSyncStatus, status: 'signed_in', updatedAt: new Date().toISOString() });
        await this.pushProfileIfPending(updated);
      } else if (account.status === 'signed_in') {
        await this.store.save<LocalAccount>('local-account', { ...account, remoteUserId: undefined, status: 'session_expired', updatedAt: new Date().toISOString() });
      }
    } catch {
      // Keep the local account usable when auth refresh cannot reach the network.
      return { ...(await this.snapshot()), message: 'Cloud sync unavailable. Your local data is safe.' };
    }
    return this.snapshot();
  }

  async signOut() {
    try { await this.provider?.signOut(); }
    finally {
      const account = await this.ensureLocalAccount();
      await this.store.save<LocalAccount>('local-account', { ...account, remoteUserId: undefined, status: 'offline_user', updatedAt: new Date().toISOString() });
    }
    return this.snapshot();
  }

  async setDisplayName(input: string) {
    const displayName = input.trim();
    if (displayName.length < 1 || displayName.length > 60) throw new Error('Enter a name up to 60 characters.');
    const account = await this.ensureLocalAccount();
    const updated = await this.store.save<LocalAccount>('local-account', { ...account, displayName, profileSyncStatus: account.status === 'signed_in' ? 'pending' : undefined, updatedAt: new Date().toISOString() });
    await this.pushProfileIfPending(updated);
    return this.snapshot();
  }

  private async pushProfileIfPending(account: LocalAccount) {
    if (account.status !== 'signed_in' || !account.remoteUserId || !account.displayName || !this.provider?.updateProfile) return;
    try {
      await this.provider.updateProfile(account.displayName);
      await this.store.save<LocalAccount>('local-account', { ...account, profileSyncStatus: 'synced', updatedAt: new Date().toISOString() });
    } catch {
      // Keep the local profile name usable; a later session restore can retry it.
    }
  }

  private async ensureLocalAccount() {
    const current = await this.store.get<LocalAccount>('local-account', 'current');
    if (current) return current;
    return this.store.save<LocalAccount>('local-account', { id: 'current', localUserId: createLocalId(), status: 'signed_out', updatedAt: new Date().toISOString() });
  }

  private async saveStatus(status: AuthStatus, phone?: string) {
    const current = await this.ensureLocalAccount();
    await this.store.save<LocalAccount>('local-account', { ...current, status, ...(phone ? { phone } : {}), updatedAt: new Date().toISOString() });
    return this.snapshot();
  }
}

export function normalizeE164(input: string) {
  const value = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error('Enter a phone number with country code, such as +91…');
  return value;
}

function createLocalId() { return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
