import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill, TextField } from '@/components/ui/prithvi-page';
import { accountService, syncService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import type { AuthSnapshot } from '@/features/account/account-types';
import type { SyncSnapshot } from '@/features/sync/sync-types';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function AccountRoute() {
  const router = useRouter(); const params = useLocalSearchParams<{ fromWelcome?: string }>();
  const language = useLanguage(); const t = (key: TranslationKey) => translate(language, key);
  const [account, setAccount] = useState<AuthSnapshot>();
  const [sync, setSync] = useState<SyncSnapshot>(syncService.getSnapshot());
  const [phone, setPhone] = useState(''); const [otp, setOtp] = useState(''); const [displayName, setDisplayName] = useState('');
  const [otpSent, setOtpSent] = useState(false); const [busy, setBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(); const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const restored = await accountService.restoreSession(); setAccount(restored); setDisplayName(restored.displayName ?? '');
      const saved = await localStore.get<{ lastSyncedAt?: string }>('sync-metadata', 'current'); setLastSyncedAt(saved?.lastSyncedAt);
      if (restored.status === 'signed_in') setSync(await syncService.syncNow());
    } catch { setError(translate(language, 'accountLocalSafe')); }
  }, [language]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function sendOtp() {
    setError(undefined); setNotice(undefined); setBusy(true);
    try { const result = await accountService.requestOtp(phone); setAccount(result); setOtpSent(true); setNotice(t('accountCodeSent')); }
    catch { setError(t('accountOtpError')); }
    finally { setBusy(false); }
  }
  async function verifyOtp() {
    setError(undefined); setNotice(undefined); setBusy(true);
    try {
      const result = await accountService.verifyOtp(phone, otp); setAccount(result); setDisplayName(result.displayName ?? ''); setOtpSent(false); setSync(await syncService.syncNow());
      if (!result.displayName) setNotice(t('accountNamePrompt'));
    } catch { setError(t('accountOtpError')); }
    finally { setBusy(false); }
  }
  async function chooseOffline() {
    setError(undefined); setBusy(true);
    try { setAccount(await accountService.continueOffline()); if (params.fromWelcome === '1') router.replace('/(tabs)'); else setNotice(t('accountOfflineWelcome')); }
    catch { setError(t('accountLocalSafe')); }
    finally { setBusy(false); }
  }
  async function runSync() { setError(undefined); setBusy(true); try { const next = await syncService.retry(); setSync(next); if (next.status === 'error' || next.status === 'offline') setError(t('accountSyncFailed')); else setNotice(t('accountSynced')); const saved = await localStore.get<{ lastSyncedAt?: string }>('sync-metadata', 'current'); setLastSyncedAt(saved?.lastSyncedAt); } catch { setError(t('accountSyncFailed')); } finally { setBusy(false); } }
  async function signOut() { setBusy(true); try { setAccount(await accountService.signOut()); setSync(syncService.getSnapshot()); setNotice(t('accountOfflineWelcome')); } catch { setError(t('accountLocalSafe')); } finally { setBusy(false); } }
  async function saveProfileName() { setBusy(true); setError(undefined); setNotice(undefined); try { const saved = await accountService.setDisplayName(displayName); setAccount(saved); setNotice(t(saved.profileSyncStatus === 'pending' ? 'accountProfilePending' : 'accountProfileSaved')); } catch { setError(t('accountProfileNameRequired')); } finally { setBusy(false); } }

  const signedIn = account?.status === 'signed_in';
  const statusLabel = signedIn ? t('accountSignedIn') : account?.status === 'session_expired' ? t('accountSessionExpired') : account?.status === 'offline_user' ? t('accountOffline') : account?.status === 'otp_requested' || otpSent ? t('accountOtpSent') : t('accountSignedOut');
  const syncLabel = sync.status === 'syncing' ? t('accountSyncing') : sync.status === 'synced' ? t('accountSynced') : sync.status === 'error' || sync.status === 'offline' ? t('accountCloudUnavailable') : sync.status === 'auth_required' ? t('accountSyncNeedsSignIn') : (sync.pendingCount ? t('accountPending') : t('accountNeverSynced'));

  return <PrithviPage title={t('accountTitle')} eyebrow={t('accountManage')} subtitle={t('accountSubtitle')} right={<Pressable accessibilityRole="button" onPress={() => params.fromWelcome === '1' ? router.replace('/(tabs)') : router.back()}><Text style={styles.back}>{t('accountBack')}</Text></Pressable>}>
    <Panel style={styles.panel}>
      <View style={styles.row}><Text style={styles.heading}>{t('accountStatus')}</Text><StatePill label={statusLabel} tone={signedIn ? 'green' : 'neutral'} /></View>
      {signedIn ? <Text style={styles.body}>{t('accountPhoneMasked')}: {maskPhone(account?.phone)}</Text> : null}
      {account?.message ? <Text style={styles.body}>{t('accountLocalSafe')}</Text> : null}
      {signedIn ? <><SectionTitle>{t('accountProfile')}</SectionTitle>{!account?.displayName ? <Text style={styles.body}>{t('accountNamePrompt')}</Text> : null}<TextField label={t('accountName')} value={displayName} onChangeText={setDisplayName} placeholder={t('accountNameHint')} maxLength={60} autoCapitalize="words" autoCorrect={false} /><PrimaryButton label={busy ? t('accountSyncing') : t('accountSaveName')} onPress={() => { void saveProfileName(); }} disabled={busy || !displayName.trim()} />{account?.profileSyncStatus === 'pending' ? <Text style={styles.body}>{t('accountProfileSyncPending')}</Text> : null}</> : null}
      {!signedIn && !otpSent ? <>
        <PrimaryButton label={t('accountOfflineUse')} onPress={() => { void chooseOffline(); }} disabled={busy} />
        {account?.configured ? <>
          <TextField label={t('accountPhone')} value={phone} onChangeText={setPhone} placeholder={t('accountPhoneHint')} autoCapitalize="none" autoCorrect={false} keyboardType="phone-pad" />
          <PrimaryButton label={busy ? t('accountSyncing') : t('accountRequestOtp')} onPress={() => { void sendOtp(); }} disabled={busy || !phone.trim()} />
        </> : <Text style={styles.body}>{t('accountNotConfigured')}</Text>}
      </> : null}
      {otpSent && !signedIn ? <>
        <Text style={styles.body}>{t('accountOtpSent')}</Text>
        <TextField label={t('accountOtp')} value={otp} onChangeText={setOtp} placeholder={t('accountOtpHint')} keyboardType="number-pad" autoComplete="one-time-code" />
        <PrimaryButton label={busy ? t('accountSyncing') : t('accountVerifyOtp')} onPress={() => { void verifyOtp(); }} disabled={busy || !otp.trim()} />
      </> : null}
      {signedIn ? <><PrimaryButton label={busy ? t('accountSyncing') : t('accountSignOut')} onPress={() => { void signOut(); }} disabled={busy} />{params.fromWelcome === '1' ? <PrimaryButton label={t('accountContinueToFarm')} onPress={() => router.replace('/(tabs)')} disabled={busy} /> : null}</> : null}
    </Panel>

    <SectionTitle>{t('accountSyncStatus')}</SectionTitle>
    <Panel style={styles.panel}>
      <View style={styles.row}><Text style={styles.heading}>{t('accountSyncStatus')}</Text><StatePill label={syncLabel} tone={sync.status === 'synced' ? 'green' : sync.status === 'error' ? 'amber' : 'neutral'} /></View>
      <Text style={styles.body}>{lastSyncedAt ? `${t('accountLastSync')}: ${formatTime(lastSyncedAt, language === 'hi')}` : t('accountNeverSynced')}</Text>
      <Text style={styles.body}>{sync.pendingCount > 0 ? `${t('accountPending')} · ${sync.pendingCount}` : t('accountLocalSafe')}</Text>
      {signedIn ? <PrimaryButton label={busy ? t('accountSyncing') : t('accountSyncNow')} onPress={() => { void runSync(); }} disabled={busy} /> : null}
      {sync.status === 'syncing' ? <ActivityIndicator color={colors.green} /> : null}
    </Panel>
    {error ? <EmptyState title={error} description={t('accountLocalSafe')} /> : null}
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
  </PrithviPage>;
}

function formatTime(value: string, hindi: boolean) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(hindi ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function maskPhone(value?: string) { return value ? `${value.slice(0, 3)}${'•'.repeat(Math.max(0, value.length - 7))}${value.slice(-4)}` : '—'; }
const styles = StyleSheet.create({ panel: { gap: spacing.sm }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, heading: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15 }, body: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19 }, notice: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13 }, back: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13, padding: spacing.xs } });
