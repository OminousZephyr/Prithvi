import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { alertService, appProvider } from '@/data/container';
import type { Alert, Field } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { alertPriorityKey as priorityKey, alertTypeIcon as typeIcon, displayAlertMessage, displayAlertTitle } from '@/features/alerts/alert-presentation';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function AlertsRoute() {
  const router = useRouter(); const language = useLanguage();
  const [alerts, setAlerts] = useState<Alert[]>([]); const [fields, setFields] = useState<Field[]>([]);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => { try { const [items, fieldItems] = await Promise.all([alertService.refresh(), appProvider.listFields()]); setAlerts(items); setFields(fieldItems); setFailed(false); } catch { setFailed(true); } }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const active = alerts.filter((item) => ['active', 'acknowledged'].includes(item.status));
  const attention = active.filter((item) => item.priority !== 'low');
  const monitoring = active.filter((item) => item.priority === 'low');
  const resolved = alerts.filter((item) => ['resolved', 'dismissed', 'expired'].includes(item.status));
  const t = (key: TranslationKey) => translate(language, key);
  return <PrithviPage title={t('alertsTitle')} eyebrow={t('alertsTitle').toLocaleUpperCase()} subtitle={t('alertsSubtitle')}>
    <AlertSection title={t('alertsNeedsAttention')} items={attention} fields={fields} t={t} onView={(item) => router.push({ pathname: '/alerts/[alertId]', params: { alertId: item.id } } as unknown as Href)} />
    <AlertSection title={t('alertsMonitoring')} items={monitoring} fields={fields} t={t} onView={(item) => router.push({ pathname: '/alerts/[alertId]', params: { alertId: item.id } } as unknown as Href)} />
    <AlertSection title={t('alertsResolved')} items={resolved} fields={fields} t={t} onView={(item) => router.push({ pathname: '/alerts/[alertId]', params: { alertId: item.id } } as unknown as Href)} />
    {!failed && !alerts.length ? <EmptyState title={t('alertsEmpty')} description={t('alertsEmptyDetail')} label={t('alertsTitle').toLocaleUpperCase()} /> : null}
    {failed ? <EmptyState title={t('alertNoDetails')} description={t('alertsEmptyDetail')} label={t('sensorStorageError')} /> : null}
    {active.length ? <Panel style={styles.countPanel}><Text style={styles.countText}>{t('alertCounts').replace('{attention}', String(attention.length)).replace('{monitoring}', String(monitoring.length))}</Text></Panel> : null}
  </PrithviPage>;
}

function AlertSection({ title, items, fields, t, onView }: { title: string; items: Alert[]; fields: Field[]; t: (key: TranslationKey) => string; onView: (alert: Alert) => void }) {
  return <View><SectionTitle>{title}</SectionTitle>{items.length ? items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => onView(item)} style={({ pressed }) => [pressed && styles.pressed]}><Panel style={styles.card}>
    <View style={styles.cardTop}><View style={[styles.icon, item.priority === 'low' ? styles.low : styles.attention]}><Text style={styles.iconText}>{typeIcon(item.type)}</Text></View><View style={styles.copy}><Text style={styles.title}>{displayAlertTitle(item, t)}</Text><Text style={styles.message}>{displayAlertMessage(item, t)}</Text><Text style={styles.where}>{fields.find((field) => field.id === item.fieldId)?.name ?? ''}{item.zoneId ? ` · ${t('alertInspectionArea')}` : ''}</Text></View><StatePill label={t(priorityKey(item.priority))} tone={item.priority === 'low' ? 'neutral' : 'amber'} /></View>
    <View style={styles.cardBottom}><Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleString()}</Text><Text style={styles.view}>{t('alertView')} ›</Text></View>
  </Panel></Pressable>) : null}</View>;
}
export function actionForAlert(alert: Alert) { return alert.type === 'crop_inspection' ? (alert.zoneId ? { href: `/scouting-zones/${alert.zoneId}` } : alert.fieldId ? { href: `/fields/${alert.fieldId}` } : { href: '/field-health' }) : alert.type === 'sensor' ? { href: '/sensors' } : alert.type === 'drone' ? { href: '/drone' } : alert.type === 'geofence' ? (alert.fieldId ? { href: `/fields/${alert.fieldId}` } : { href: '/drone' }) : { href: '/diagnostics' }; }
const styles = StyleSheet.create({ card: { padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm }, cardTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }, icon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, attention: { backgroundColor: colors.amberSoft }, low: { backgroundColor: colors.surfaceSoft }, iconText: { color: colors.green, fontSize: 18 }, copy: { flex: 1, gap: 3 }, title: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 15 }, message: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 18 }, where: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 12, minHeight: 15 }, cardBottom: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' }, timestamp: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 11 }, view: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 12 }, countPanel: { backgroundColor: colors.surfaceSoft, borderWidth: 0 }, countText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 13 }, pressed: { opacity: 0.78 } });
