export type AuthStatus = 'signed_out' | 'offline_user' | 'otp_requested' | 'verifying' | 'signed_in' | 'session_expired';
export interface LocalAccount { id: 'current'; localUserId: string; remoteUserId?: string; phone?: string; displayName?: string; profileSyncStatus?: 'pending' | 'synced'; status: AuthStatus; updatedAt: string }
export interface AuthSnapshot { status: AuthStatus; localUserId: string; remoteUserId?: string; phone?: string; displayName?: string; profileSyncStatus?: 'pending' | 'synced'; configured: boolean; message?: string }
export interface AuthProvider {
  readonly configured: boolean;
  requestOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, otp: string): Promise<{ userId: string; phone?: string; displayName?: string }>;
  signOut(): Promise<void>;
  restoreSession(): Promise<{ userId: string; phone?: string; displayName?: string } | undefined>;
  updateProfile?(displayName: string): Promise<void>;
  getAccessToken?(): Promise<string | undefined>;
}
export interface AuthStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
