import { useEffect, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PrithviPage, PrimaryButton } from '@/components/ui/prithvi-page';
import { accountService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, spacing } from '@/theme/tokens';

export default function IndexRoute() {
  const router = useRouter(); const language = useLanguage(); const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [ready, setReady] = useState(false); const [welcome, setWelcome] = useState(false);
  useEffect(() => { let active = true; void localStore.get<{ completed?: boolean }>('app-config', 'welcome-complete').then((value) => { if (active) { setWelcome(!value?.completed); setReady(true); } }).catch(() => { if (active) { setWelcome(true); setReady(true); } }); return () => { active = false; }; }, []);
  useEffect(() => { if (ready && !welcome) router.replace('/(tabs)'); }, [ready, welcome, router]);
  const continueOffline = async () => { await accountService.continueOffline(); await localStore.save('app-config', { id: 'welcome-complete', completed: true }); setWelcome(false); router.replace('/(tabs)'); };
  const openAccount = async () => { await localStore.save('app-config', { id: 'welcome-complete', completed: true }); router.push({ pathname: '/account', params: { fromWelcome: '1' } } as unknown as Href); };
  if (!ready || !welcome) return <View style={styles.loading} />;
  return <PrithviPage title={t('welcomeTitle')} eyebrow={t('brand')} subtitle={t('welcomeIntro')}>
    <View style={styles.actions}><PrimaryButton label={t('continueOffline')} onPress={() => { void continueOffline(); }} /><PrimaryButton label={t('signInCreateAccount')} onPress={() => { void openAccount(); }} /></View>
  </PrithviPage>;
}

const styles = StyleSheet.create({ loading: { flex: 1, backgroundColor: colors.canvas }, actions: { gap: spacing.sm } });
