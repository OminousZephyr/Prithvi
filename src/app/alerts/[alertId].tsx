import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { alertService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import type { Advisory, Alert, CropObservation, Farm, Field, ScoutingEvidence } from '@/domain/models';
import { actionForAlert } from '../alerts';
import { alertPriorityKey as priorityKey, alertStatusKey as statusKey, alertTypeKey as typeKey, displayAlertMessage, displayAlertTitle } from '@/features/alerts/alert-presentation';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function AlertDetailsRoute() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>(); const router = useRouter(); const language = useLanguage();
  const [alert, setAlert] = useState<Alert>(); const [observation, setObservation] = useState<CropObservation>(); const [advisory, setAdvisory] = useState<Advisory>(); const [evidence, setEvidence] = useState<ScoutingEvidence[]>([]);
  const [field, setField] = useState<Field>(); const [farm, setFarm] = useState<Farm>();
  const [failed, setFailed] = useState(false); const t = (key: TranslationKey) => translate(language, key);
  const refresh = useCallback(async () => { try { const items = await alertService.refresh(); const item = items.find((value) => value.id === alertId); setAlert(item); if (!item) return; const [obs, adv, evidenceItems, fieldRecord, farmRecord] = await Promise.all([item.observationId ? localStore.get<CropObservation>('crop-observation', item.observationId) : undefined, item.advisoryId ? localStore.get<Advisory>('advisory', item.advisoryId) : undefined, localStore.list<ScoutingEvidence>('scouting-evidence'), item.fieldId ? localStore.get<Field>('field', item.fieldId) : undefined, item.farmId ? localStore.get<Farm>('farm', item.farmId) : undefined]); setObservation(obs); setAdvisory(adv); setField(fieldRecord); setFarm(farmRecord); setEvidence(evidenceItems.filter((row) => row.zoneId === item.zoneId || (item.observationId && row.observationIds.includes(item.observationId)))); setFailed(false); } catch { setFailed(true); } }, [alertId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  if (!alert) return <PrithviPage title={t('alertDetails')} eyebrow={t('alertsTitle')}><EmptyState title={t(failed ? 'alertNoDetails' : 'alertNotFound')} description={t('alertsEmptyDetail')} label={t('alertsTitle').toLocaleUpperCase()} /><PrimaryButton label={t('alertBack')} onPress={() => router.replace('/alerts')} /></PrithviPage>;
  const target = actionForAlert(alert); const active = ['active', 'acknowledged'].includes(alert.status);
  const update = async (status: 'acknowledged' | 'dismissed' | 'resolved') => { await alertService.setStatus(alert.id, status); await refresh(); };
  return <PrithviPage title={t('alertDetails')} eyebrow={t(typeKey(alert.type))} subtitle={alert.title}>
    <Panel style={styles.summary}><View style={styles.badges}><StatePill label={t(priorityKey(alert.priority))} tone={alert.priority === 'low' ? 'neutral' : 'amber'} /><StatePill label={t(statusKey(alert.status))} tone={alert.status === 'resolved' ? 'green' : alert.status === 'dismissed' ? 'neutral' : 'amber'} /></View><Text style={styles.message}>{displayAlertMessage(alert, t)}</Text></Panel>
    <SectionTitle>{t('alertWhat')}</SectionTitle><Panel><Text style={styles.body}>{displayAlertTitle(alert, t)}</Text><Text style={styles.copy}>{displayAlertMessage(alert, t)}</Text></Panel>
    <SectionTitle>{t('alertWhy')}</SectionTitle><Panel>{advisory ? <><Text style={styles.body}>{advisory.reason}</Text><Text style={styles.copy}>{advisory.action}</Text></> : observation ? <><Text style={styles.body}>{observation.title}</Text><Text style={styles.copy}>{observation.crop ?? ''}{observation.condition ? ` · ${observation.condition}` : ''}{observation.confidence !== undefined ? ` · ${Math.round(observation.confidence * 100)}%` : ''}</Text></> : evidence.length ? evidence.map((item) => <Text key={item.id} style={styles.copy}>{`${item.observationCount} observation(s) · ${item.evidenceLevel.replaceAll('_', ' ')}`}</Text>) : <Text style={styles.copy}>{t('alertNoDetails')}</Text>}</Panel>
    <SectionTitle>{t('alertWhere')}</SectionTitle><Panel><Text style={styles.body}>{field?.name ?? farm?.name ?? t('alertNoDetails')}{alert.zoneId ? ` · ${t('alertInspectionArea')}` : ''}</Text></Panel>
    <SectionTitle>{t('alertWhen')}</SectionTitle><Panel><Text style={styles.body}>{new Date(alert.createdAt).toLocaleString()}</Text><Text style={styles.copy}>{t('alertSource')}: {t(typeKey(alert.type))} · {t('alertPriority')}: {t(priorityKey(alert.priority))}</Text></Panel>
    {observation ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/observations/[observationId]', params: { observationId: observation.id } })}><SectionTitle>{t('alertRelatedObservation')}</SectionTitle><Panel><Text style={styles.body}>{observation.title}</Text><Text style={styles.copy}>{t('alertView')} ›</Text></Panel></Pressable> : null}
    {advisory ? <Panel><Text style={styles.body}>{t('alertRelatedAdvisory')}</Text><Text style={styles.copy}>{advisory.title} · {advisory.message}</Text></Panel> : null}
    {evidence.length ? <Panel><Text style={styles.body}>{t('alertRelatedEvidence')}</Text>{evidence.map((item) => <Text key={item.id} style={styles.copy}>{item.evidenceLevel.replaceAll('_', ' ')} · {item.observationCount} observations · {new Date(item.firstObservedAt).toLocaleString()} – {new Date(item.lastObservedAt).toLocaleString()}</Text>)}</Panel> : null}
    <SectionTitle>{t('alertCurrentState')}</SectionTitle><Panel><StatePill label={t(statusKey(alert.status))} tone={active ? 'amber' : 'neutral'} />{active ? <View style={styles.actions}><PrimaryButton label={t('alertOpenAction')} onPress={() => router.push(target.href as Href)} />{alert.status === 'active' ? <PrimaryButton label={t('alertAcknowledge')} onPress={() => void update('acknowledged')} /> : null}<PrimaryButton label={t('alertDismissAction')} onPress={() => void update('dismissed')} /><PrimaryButton label={t('alertResolveAction')} onPress={() => void update('resolved')} /></View> : null}</Panel>
  </PrithviPage>;
}

const styles = StyleSheet.create({ summary: { backgroundColor: colors.amberSoft, borderWidth: 0, gap: spacing.sm }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, message: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, lineHeight: 22 }, body: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, copy: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 20, marginTop: spacing.xs }, actions: { gap: spacing.xs, marginTop: spacing.sm } });
