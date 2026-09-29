import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrithviPage } from '@/components/ui/prithvi-page';
import { accountService, alertService, appProvider, sensorService } from '@/data/container';
import { selectHomeAlert } from '@/features/alerts/alert-service';
import { displayAlertMessage, displayAlertTitle } from '@/features/alerts/alert-presentation';
import type { Alert, CropObservation, Field, SensorConnection, SensorKind, SensorReading } from '@/domain/models';
import { buildHomeSensorSummary } from '@/features/sensors/presentation/sensor-presentation';
import { buildSensorAlerts, type SensorAlert } from '@/features/sensors/presentation/sensor-interpretation';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, radius, spacing } from '@/theme/tokens';
import { WeatherSummaryCard } from '@/features/weather/weather-summary-card';
import { localStore } from '@/data/storage/local-store';
import { homeHeaderPresentation } from './home-presentation';
import type { AuthSnapshot } from '@/features/account/account-types';

export function DashboardScreen() {
  const router = useRouter();
  const language = useLanguage();
  const [fields, setFields] = useState<Field[]>([]);
  const [observations, setObservations] = useState<CropObservation[]>([]);
  const [observationsUnavailable, setObservationsUnavailable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [connection, setConnection] = useState<SensorConnection>(sensorService.getConnection());
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [sensorKinds, setSensorKinds] = useState<Map<string, SensorKind>>(new Map());
  const [sensorAlerts, setSensorAlerts] = useState<SensorAlert[]>([]);
  const [homeAlert, setHomeAlert] = useState<Alert>();
  const [account, setAccount] = useState<Pick<AuthSnapshot, 'status' | 'displayName'>>();
  const [weatherFieldId, setWeatherFieldId] = useState<string>();

  const refreshSensors = useCallback(async () => {
    try {
      const [latest, sensors, nodes, savedFields, preference] = await Promise.all([sensorService.history(undefined, 200), sensorService.listSensors(), sensorService.listNodes(), appProvider.listFields(), localStore.get<{ fieldId?: string }>('weather-preference', 'current')]);
      const currentField = savedFields.find((field) => field.id === preference?.fieldId) ?? savedFields[0];
      const linkedNodes = nodes.filter((node) => node.fieldId === currentField?.id || currentField?.sensorNodeIds.includes(node.id));
      const linkedSensors = sensors.filter((sensor) => linkedNodes.some((node) => node.id === sensor.nodeId));
      const linkedReadings = latest.filter((reading) => linkedSensors.some((sensor) => sensor.id === reading.sensorId));
      const calibrations = Object.fromEntries(await Promise.all(linkedSensors.map(async (sensor) => [sensor.id, await sensorService.getCalibration(sensor.id)] as const)));
      setReadings(latest); setSensorKinds(new Map(linkedSensors.map((sensor) => [sensor.id, sensor.kind])));
      setSensorAlerts(buildSensorAlerts(linkedReadings, linkedSensors, sensorService.getConnection().status, Date.now(), calibrations));
    } catch { setReadings([]); setSensorKinds(new Map()); setSensorAlerts([]); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    void accountService.snapshot().then((snapshot) => { if (active) setAccount(snapshot); }).catch(() => { if (active) setAccount(undefined); });
    void localStore.get<{ fieldId?: string }>('weather-preference', 'current').then((value) => { if (active) setWeatherFieldId(value?.fieldId); }).catch(() => undefined);
    void appProvider.listFields().then(async (fieldRecords) => {
      if (!active) return;
      setFields(fieldRecords); setLoadFailed(false);
      const alerts = await alertService.refresh();
      if (!active) return;
      const candidate = selectHomeAlert(alerts.filter((item) => !item.fieldId || fieldRecords.some((field) => field.id === item.fieldId)));
      setHomeAlert(candidate);
    }).catch(() => { if (active) setLoadFailed(true); });
    void appProvider.listObservations().then((records) => { if (active) { setObservations(records); setObservationsUnavailable(false); } }).catch(() => { if (active) setObservationsUnavailable(true); });
    const unsubscribe = sensorService.subscribe(() => { setConnection(sensorService.getConnection()); void refreshSensors(); });
    void sensorService.start().then((state) => { if (active) setConnection(state); });
    void refreshSensors();
    return () => { active = false; unsubscribe(); };
  }, [refreshSensors]));

  // Treat every legacy Farm/Field pair as one farmer-facing field list.
  const fieldsForFarm = fields;
  const fieldNeedsAttention = fieldsForFarm.find((field) => field.healthStatus === 'requires_attention');
  const latestObservation = observations.filter((item) => !item.fieldId || fields.some((field) => field.id === item.fieldId)).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const homeSensorSummary = buildHomeSensorSummary(readings, [...sensorKinds].map(([id, kind]) => ({ id, kind })), connection, undefined, {
      humidity: translate(language, 'sensorHumidity'), soil: translate(language, 'sensorSoilMoisture'), rain: translate(language, 'sensorRain'), raw: translate(language, 'sensorRawShort'), stale: translate(language, 'sensorStaleState'), disconnected: translate(language, 'sensorsOffline'),
  });
  const primaryField = fieldsForFarm.find((item) => item.id === weatherFieldId) ?? fieldsForFarm[0];

  const header = homeHeaderPresentation(account, language);
  return <PrithviPage title={header.greeting} eyebrow={translate(language, 'homeFarmContext')} right={<Pressable accessibilityRole="button" accessibilityLabel={header.accessibleAccountLabel} onPress={() => router.push('/account' as Href)} style={styles.profileButton}>{header.profileName ? <Text numberOfLines={1} style={styles.profileName}>{header.profileName}</Text> : null}<Text style={styles.profileInitial}>{header.profileInitial}</Text></Pressable>}>
    <Pressable accessibilityRole="button" accessibilityLabel={translate(language, 'fieldChooseCurrent')} accessibilityHint={translate(language, 'fieldListHeading')} onPress={() => router.push({ pathname: '/(tabs)/fields', params: { selectField: '1' } })} style={({ pressed }) => [styles.farmLine, pressed && styles.pressed]}><View style={styles.farmText}><Text style={styles.metricLabel}>{translate(language, 'homeCurrentField')}</Text><Text style={styles.farmName}>{loadFailed ? translate(language, 'fieldDetailsUnavailable') : primaryField?.name ?? translate(language, 'addField')}</Text><Text style={styles.location}>{primaryField?.crop?.name ?? translate(language, 'fieldCropNotAdded')}</Text></View><View style={styles.farmSwitch}><Text style={styles.farmSwitchText}>⌄</Text></View></Pressable>

    {primaryField ? <WeatherSummaryCard field={primaryField} /> : <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/fields')}><WeatherSummaryCard hideUnavailable /></Pressable>}

    {homeAlert || sensorAlerts.length ? <Pressable accessibilityRole="button" onPress={() => router.push('/alerts')} style={({ pressed }) => [styles.scoutSuggestion, pressed && styles.pressed]}><View style={styles.attentionDot} /><View style={styles.attentionCopy}><Text style={styles.attentionLabel}>{translate(language, 'alertAttentionCount')}</Text><Text style={styles.attentionTitle}>{homeAlert ? displayAlertTitle(homeAlert, (key) => translate(language, key)) : translate(language, sensorAlertTitleKey(sensorAlerts[0]))}{(homeAlert?.fieldId ? fields.find((item) => item.id === homeAlert.fieldId)?.name : primaryField?.name) ? ` · ${homeAlert?.fieldId ? fields.find((item) => item.id === homeAlert.fieldId)?.name : primaryField?.name}` : ''}</Text><Text numberOfLines={2} style={styles.recentDetail}>{homeAlert ? displayAlertMessage(homeAlert, (key) => translate(language, key)) : sensorAlerts[0].position ?? translate(language, 'sensorFieldHub')}</Text></View><Text style={styles.rowArrow}>›</Text></Pressable> : null}

    {primaryField ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/fields/[fieldId]', params: { fieldId: primaryField.id } })}><View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricLabel}>{translate(language, 'fieldStatus')}</Text><Text style={styles.metricValue}>{translate(language, fieldNeedsAttention ? 'fieldNeedsAttention' : latestObservation ? 'fieldObservationSaved' : 'fieldReadyToExplore')}</Text></View></View></Pressable> : <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/fields')}><View style={styles.metrics}><View style={styles.metric}><Text style={styles.metricLabel}>{translate(language, 'yourFieldTitle')}</Text><Text style={styles.metricValue}>{translate(language, 'addField')}</Text></View></View></Pressable>}
    {homeSensorSummary ? <SensorHomeSummary summary={homeSensorSummary} language={language} /> : null}

    <View style={styles.recent}><Text style={styles.recentHeading}>{translate(language, latestObservation ? 'latestCropObservation' : 'recentObservations')}</Text><Pressable accessibilityRole="button" onPress={() => latestObservation ? router.push({ pathname: '/observations/[observationId]', params: { observationId: latestObservation.id } }) : router.push('/(tabs)/health')} style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}><View style={[styles.observationDot, !latestObservation && styles.emptyObservationDot]} /><View style={styles.recentCopy}><Text style={styles.recentTitle}>{latestObservation?.title ?? translate(language, observationsUnavailable ? 'observationsUnavailable' : 'noObservationYet')}</Text><Text style={styles.recentDetail}>{latestObservation ? `${latestObservation.crop ?? translate(language, 'fieldCropNotAdded')}${latestObservation.condition ? ` · ${latestObservation.condition}` : ''}` : translate(language, observationsUnavailable ? 'tryAgain' : 'noCropObservations')}</Text><Text style={styles.recentDetail}>{latestObservation ? `${fields.find((item) => item.id === latestObservation.fieldId)?.name ?? ''} · ${new Date(latestObservation.timestamp ?? latestObservation.observedAt).toLocaleDateString()}` : ''}</Text></View><Text style={styles.rowArrow}>›</Text></Pressable></View>

    <View style={styles.homeActions}><Pressable accessibilityRole="button" onPress={() => primaryField ? router.push({ pathname: '/crop-health-scan', params: { fieldId: primaryField.id } }) : router.push('/(tabs)/fields')} style={styles.primaryAction}><Text style={styles.primaryActionText}>{translate(language, primaryField ? 'quickScanCrop' : 'addField')}</Text><Text style={styles.actionArrow}>›</Text></Pressable><Pressable accessibilityRole="button" onPress={() => primaryField ? router.push({ pathname: '/fields/[fieldId]', params: { fieldId: primaryField.id } }) : router.push('/(tabs)/fields')} style={styles.viewFieldAction}><Text style={styles.viewFieldText}>{translate(language, primaryField ? 'quickViewField' : 'addField')}</Text></Pressable></View>
  </PrithviPage>;
}

function sensorAlertTitleKey(alert: SensorAlert): Parameters<typeof translate>[1] {
  return alert.key === 'rainDetected' ? 'rainDetected' : alert.key === 'soilDry' ? 'soilDryAlert' : alert.key === 'sensorStale' ? 'sensorStaleAlert' : 'sensorDisconnectedAlert';
}

function SensorHomeSummary({ summary, language }: { summary: string; language: 'en' | 'hi' }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" onPress={() => router.push('/sensors')} style={({ pressed }) => [styles.sensorRow, pressed && styles.pressed]}><View style={styles.sensorMark}><Text style={styles.sensorMarkText}>◌</Text></View><View style={styles.sensorText}><Text style={styles.sensorTitle}>{translate(language, 'sensorHomeTitle')} · {translate(language, 'sensorHomeLive')}</Text><Text style={styles.sensorDetail}>{summary}</Text></View><Text style={styles.rowArrow}>›</Text></Pressable>;
}

const styles = StyleSheet.create({
  homeActions: { flexDirection: 'row', gap: spacing.sm }, viewFieldAction: { minHeight: 46, paddingHorizontal: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }, viewFieldText: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 14 },
  profileButton: { minHeight: 42, maxWidth: 156, paddingHorizontal: 5, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }, profileName: { maxWidth: 112, color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 12 }, profileInitial: { width: 34, height: 34, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', borderRadius: 17, backgroundColor: colors.greenSoft, color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 15 },
  farmLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -spacing.sm, marginBottom: spacing.xs }, farmText: { flex: 1 }, farmName: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17 }, location: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, marginTop: 2 }, farmSwitch: { width: 42, height: 42, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, farmSwitchText: { fontSize: 22, color: colors.green, marginTop: -4 },
  statusCard: { overflow: 'hidden', position: 'relative', minHeight: 218, borderRadius: radius.feature, padding: spacing.lg, backgroundColor: '#E6EEE1', justifyContent: 'flex-start' }, statusAttention: { backgroundColor: colors.amberSoft }, statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, statusMark: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F8F8EF', alignItems: 'center', justifyContent: 'center' }, markAttention: { backgroundColor: '#FFF8E9' }, statusSymbol: { color: colors.green, fontSize: 19, fontFamily: fontFamilies.semibold }, statusTitle: { color: colors.ink, fontFamily: fontFamilies.display, fontSize: 25, lineHeight: 32, marginTop: spacing.md, maxWidth: '82%' }, statusDetail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19, marginTop: 3, maxWidth: '86%' }, primaryAction: { minHeight: 46, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: 16, backgroundColor: colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'flex-start', minWidth: 174, gap: spacing.lg }, primaryActionText: { color: colors.white, fontFamily: fontFamilies.semibold, fontSize: 14 }, actionArrow: { color: colors.white, fontSize: 22, lineHeight: 24 }, actionPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] }, orbit: { position: 'absolute', right: -34, top: 48, width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: 'rgba(36,93,67,0.12)', alignItems: 'center', justifyContent: 'center' }, orbitInner: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: 'rgba(36,93,67,0.1)' },
  metrics: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: colors.surface, borderRadius: 20, paddingVertical: spacing.sm }, metric: { flex: 1, alignItems: 'center', gap: 3 }, metricLabel: { color: colors.muted, fontFamily: fontFamilies.semibold, fontSize: 9, letterSpacing: 0.4 }, metricValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 18 }, connected: { color: colors.green }, metricDivider: { height: 34, width: StyleSheet.hairlineWidth, backgroundColor: colors.lineStrong },
  sensorRow: { minHeight: 68, backgroundColor: colors.blueSoft, borderRadius: 20, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, sensorMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, sensorMarkText: { color: colors.blue, fontSize: 19 }, sensorText: { flex: 1, gap: 2 }, sensorTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 14 }, sensorDetail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 17 }, rowArrow: { color: colors.muted, fontSize: 24 }, pressed: { opacity: 0.8 }, attentionRow: { minHeight: 64, borderRadius: 18, backgroundColor: colors.amberSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md }, scoutSuggestion: { minHeight: 72, borderRadius: 18, backgroundColor: colors.amberSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, attentionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber }, attentionCopy: { flex: 1 }, attentionLabel: { color: colors.amber, fontFamily: fontFamilies.semibold, fontSize: 10, letterSpacing: 0.5 }, attentionTitle: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, marginTop: 2 }, recent: { marginTop: spacing.xs }, recentHeading: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16, marginBottom: spacing.xs }, recentRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: spacing.sm }, observationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green }, emptyObservationDot: { backgroundColor: colors.quiet }, recentCopy: { flex: 1 }, recentTitle: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, recentDetail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, marginTop: 3 }, syncRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, marginTop: -spacing.xs }, syncDot: { color: colors.sage, fontSize: 8 }, syncText: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 11 },
});
