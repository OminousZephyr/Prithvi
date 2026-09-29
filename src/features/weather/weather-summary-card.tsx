import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Field } from '@/domain/models';
import { weatherRepository } from '@/data/container';
import { compactWeatherLine, weatherUpdatedLabel } from './weather-presentation';
import { translate, type TranslationKey } from '@/localization/resources';
import { useLanguage } from '@/localization/use-language';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export function WeatherSummaryCard({ field, hideUnavailable = false }: { field?: Field; hideUnavailable?: boolean }) {
  const language = useLanguage(); const router = useRouter();
  const [view, setView] = useState<Awaited<ReturnType<typeof weatherRepository.forField>>>(); const [updatedNow, setUpdatedNow] = useState(0);
  useFocusEffect(useCallback(() => { let alive = true; void weatherRepository.forField(field).then((result) => { if (alive) { setView(result); setUpdatedNow(Date.now()); } }).catch(() => { if (alive) { setView({ status: 'unavailable', reason: 'network' }); setUpdatedNow(Date.now()); } }); return () => { alive = false; }; }, [field]));
  if (!field || (hideUnavailable && !view?.data)) return null;
  const t = (key: TranslationKey, value?: string) => interpolate(translate(language, key), value);
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/weather', params: { fieldId: field.id } } as unknown as Href)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.mark}><Text style={styles.markText}>☼</Text></View>
    <View style={styles.copy}>
      <Text style={styles.label}>{t('weatherTitle')} · {field.name}</Text>
      {view?.data ? <><Text style={styles.value}>{compactWeatherLine(view.data, (key) => translate(language, key))}</Text><Text style={styles.updated}>{updatedNow ? weatherUpdatedLabel(view.data.fetchedAt, updatedNow, (key, value) => t(key, value)) : translate(language, 'weatherUpdatedJustNow')}</Text></> : <Text style={styles.updated}>{translate(language, view?.reason === 'no_field_location' ? 'weatherNoLocation' : 'weatherUnavailable')}</Text>}
    </View><Text style={styles.arrow}>›</Text>
  </Pressable>;
}
function interpolate(template: string, value?: string) { return value === undefined ? template : template.replace('{0}', value); }
const styles = StyleSheet.create({ card: { minHeight: 68, backgroundColor: colors.blueSoft, borderRadius: 19, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, mark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, markText: { color: colors.blue, fontSize: 19 }, copy: { flex: 1 }, label: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 11 }, value: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 15, marginTop: 2 }, updated: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 11, marginTop: 2 }, arrow: { color: colors.muted, fontSize: 24 }, pressed: { opacity: 0.82 } });
