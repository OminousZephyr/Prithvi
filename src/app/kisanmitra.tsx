import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle } from '@/components/ui/prithvi-page';
import { accountService, advisoryRepository, alertService, appProvider, kisanMitraProvider, scoutingRepository, sensorService, weatherRepository } from '@/data/container';
import { buildKisanContext } from '@/features/kisanmitra/kisanmitra-context';
import type { KisanResponse } from '@/features/kisanmitra/kisanmitra-types';
import type { Field } from '@/domain/models';
import { localStore } from '@/data/storage/local-store';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

const promptKeys: TranslationKey[] = ['kisanmitraSuggestedAttention', 'kisanmitraSuggestedToday', 'kisanmitraSuggestedConditions', 'kisanmitraSuggestedResult'];
export default function KisanMitraRoute() {
  const language = useLanguage(); const [fields, setFields] = useState<Field[]>([]); const [fieldId, setFieldId] = useState<string>();
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState<KisanResponse>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<'offline' | 'unavailable' | undefined>();
  const t = (key: TranslationKey) => translate(language, key);
  useFocusEffect(useCallback(() => { let active = true; void appProvider.listFields().then((rows) => { if (active) { setFields(rows); if (!fieldId && rows.length === 1) setFieldId(rows[0].id); } }).catch(() => undefined); return () => { active = false; }; }, [fieldId]));
  async function ask(text = question) {
    const prompt = text.trim(); if (!prompt || busy) return;
    setQuestion(prompt); setBusy(true); setError(undefined); setAnswer(undefined);
    try {
      const [farmRows, fieldRows, observations, evidence, advisories, alerts] = await Promise.all([appProvider.listFarms(), appProvider.listFields(), appProvider.listObservations(), scoutingRepository.listEvidence(), advisoryRepository.refresh(), alertService.refresh()]);
      const selected = fieldRows.find((item) => item.id === fieldId);
      const weather = selected ? (await weatherRepository.forField(selected)).data : undefined;
      const context = await buildKisanContext({
        listFarms: async () => farmRows, getFarm: async (id) => farmRows.find((row) => row.id === id), listFields: async (farmId) => fieldRows.filter((row) => !farmId || row.farmId === farmId),
        listObservations: async (query) => observations.filter((row) => (!query?.fieldId || row.fieldId === query.fieldId) && (!query?.farmId || fieldRows.find((field) => field.id === row.fieldId)?.farmId === query.farmId)),
        listEvidence: async (id) => evidence.filter((row) => !id || row.fieldId === id), listAdvisories: async () => advisories, listAlerts: async () => alerts,
        listSensors: () => sensorService.listSensors(), listNodes: () => localStore.list<import('@/domain/models').SensorNode>('sensor-node'), latestReadings: () => sensorService.latestReadings(),
      }, fieldId, language, weather);
      const token = await accountService.getAccessToken().catch(() => undefined);
      setAnswer(await kisanMitraProvider.ask(prompt, context, token));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.toLowerCase() : '';
      setError(/configur|unavailable|invalid response|try again|not configured/.test(message) ? 'unavailable' : 'offline');
    } finally { setBusy(false); }
  }
  return <PrithviPage title={t('kisanmitra')} eyebrow={t('kisanmitraSubtitle')} subtitle={t('kisanmitraGreeting')}>
    {fields.length > 1 ? <View><SectionTitle>{t('kisanmitraNeedField')}</SectionTitle><View style={styles.fields}>{fields.map((field) => <Pressable key={field.id} onPress={() => setFieldId(field.id)} style={[styles.chip, field.id === fieldId && styles.selectedChip]}><Text style={[styles.chipText, field.id === fieldId && styles.selectedChipText]}>{field.name}</Text></Pressable>)}</View></View> : null}
    <View><SectionTitle>{t('kisanmitraSuggestedHeading')}</SectionTitle>{promptKeys.map((key) => <Pressable key={key} accessibilityRole="button" disabled={busy} onPress={() => { void ask(t(key)); }} style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}><Text style={styles.promptText}>{t(key)}</Text><Text style={styles.arrow}>›</Text></Pressable>)}</View>
    <Panel style={styles.askPanel}><TextInput value={question} onChangeText={setQuestion} placeholder={t('kisanmitraInput')} placeholderTextColor={colors.quiet} multiline maxLength={1000} style={styles.input} accessibilityLabel={t('kisanmitraInput')} /><PrimaryButton label={busy ? t('kisanmitraThinking') : t('kisanmitraSend')} disabled={busy || !question.trim()} onPress={() => { void ask(); }} />{busy ? <ActivityIndicator color={colors.green} /> : null}</Panel>
    {error ? <EmptyState title={t(error === 'offline' ? 'kisanmitraOffline' : 'kisanmitraError')} description={t('kisanmitraDisclaimer')} label={t('kisanmitra')} /> : null}
    {answer ? <Panel style={styles.answer}><Text style={styles.answerText}>{answer.answer}</Text>{answer.actions.length ? <View><SectionTitle>{t('kisanmitraActions')}</SectionTitle>{answer.actions.map((action, index) => <View key={`${action.title}-${index}`} style={styles.action}><Text style={styles.actionTitle}>{action.title}</Text><Text style={styles.actionReason}>{action.reason}</Text></View>)}</View> : null}{answer.sources.length ? <Text style={styles.sources}>{t('kisanmitraBasedOn')}</Text> : null}<Text style={styles.verify}>{t('kisanmitraDisclaimer')}</Text></Panel> : null}
  </PrithviPage>;
}
const styles = StyleSheet.create({ fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 36, paddingHorizontal: 13, borderRadius: 18, justifyContent: 'center', backgroundColor: colors.surfaceSoft }, selectedChip: { backgroundColor: colors.green }, chipText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, selectedChipText: { color: colors.white }, prompt: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingVertical: spacing.sm }, promptText: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, arrow: { color: colors.green, fontSize: 22 }, pressed: { opacity: 0.75 }, askPanel: { gap: spacing.xs, padding: spacing.md }, input: { minHeight: 76, color: colors.ink, fontFamily: fontFamilies.body, fontSize: 15, textAlignVertical: 'top' }, answer: { gap: spacing.md }, answerText: { color: colors.ink, fontFamily: fontFamilies.body, fontSize: 16, lineHeight: 24 }, action: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingVertical: spacing.sm, gap: 3 }, actionTitle: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 14 }, actionReason: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 18 }, sources: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, verify: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18 } });
