import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Panel, PrithviPage, SectionTitle } from '@/components/ui/prithvi-page';
import { localStore } from '@/data/storage/local-store';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function SettingsRoute() {
  const router = useRouter(); const language = useLanguage();
  const saveLanguage = async (value: 'en' | 'hi') => { await localStore.save('app-config', { id: 'language', language: value, syncState: 'local' }); router.replace('/(tabs)/more'); };
  return <PrithviPage title={translate(language, 'settingsTitle')} eyebrow={translate(language, 'moreApp')} subtitle={translate(language, 'settingsSubtitle')}>
    <View><SectionTitle>{translate(language, 'settingsLanguage')}</SectionTitle><View style={styles.languages}>{(['en', 'hi'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: language === value }} onPress={() => { void saveLanguage(value); }} style={[styles.language, language === value && styles.selected]}><Text style={[styles.languageText, language === value && styles.selectedText]}>{value === 'en' ? 'English' : 'हिन्दी'}</Text></Pressable>)}</View></View>
    <View><SectionTitle>{translate(language, 'fieldDevices')}</SectionTitle><Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/fields')}><Panel><Text style={styles.itemTitle}>{translate(language, 'fieldSetupTitle')}</Text><Text style={styles.detail}>{translate(language, 'fieldSetupSubtitle')}</Text></Panel></Pressable></View>
  </PrithviPage>;
}
const styles = StyleSheet.create({ languages: { flexDirection: 'row', gap: spacing.sm }, language: { minHeight: 48, flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, selected: { backgroundColor: colors.green, borderColor: colors.green }, languageText: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15 }, selectedText: { color: colors.white }, itemTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, marginTop: 4 } });
