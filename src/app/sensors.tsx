import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, LoadingState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { sensorService } from '@/data/container';
import type { Sensor, SensorConnection, SensorHealth, SensorKind, SensorNode, SensorReading } from '@/domain/models';
import { buildSensorGrid, type SensorCardValue } from '@/features/sensors/presentation/sensor-presentation';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, spacing } from '@/theme/tokens';

const labels: Record<Exclude<SensorKind, 'other'>, 'sensorTemperature' | 'sensorHumidity' | 'sensorSoilMoisture' | 'sensorRain'> = { temperature: 'sensorTemperature', humidity: 'sensorHumidity', soil_moisture: 'sensorSoilMoisture', rain: 'sensorRain' };

export default function SensorsRoute() {
  const router = useRouter();
  const { sensorId } = useLocalSearchParams<{ sensorId?: string }>();
  const language = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [connection, setConnection] = useState<SensorConnection>(sensorService.getConnection());
  const [nodes, setNodes] = useState<SensorNode[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [history, setHistory] = useState<SensorReading[]>([]);
  const [health, setHealth] = useState<SensorHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(0);
  const [details, setDetails] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [nodeRecords, sensorRecords, latest, records, healthRecords] = await Promise.all([
        sensorService.listNodes(), sensorService.listSensors(), sensorService.latestReadings(), sensorService.history(undefined, 12), sensorService.listHealth(),
      ]);
      setNodes(nodeRecords); setSensors(sensorRecords); setReadings(latest); setHistory(records); setHealth(healthRecords); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setClock(Date.now());
    const unsubscribe = sensorService.subscribe(() => { setConnection(sensorService.getConnection()); void refresh(); });
    void sensorService.start().then((state) => { if (active) setConnection(state); });
    void refresh();
    const timer = setInterval(() => { if (active) { setClock(Date.now()); setConnection(sensorService.getConnection()); void refresh(); } }, 2_000);
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, [refresh]));

  const cards = buildSensorGrid(readings, sensors, connection, clock);
  const staleAny = cards.some((card) => card.state === 'stale');
  const overall = connection.status === 'connected' ? staleAny ? t('sensorOverallStale') : t('sensorOverallConnected') : connection.status === 'stale' ? t('sensorOverallStale') : t('sensorOverallUnavailable');
  const tone = connection.status === 'connected' && !staleAny ? 'green' : connection.status === 'error' || connection.status === 'disconnected' ? 'red' : 'amber';

  return <PrithviPage title={t('sensorsTitle')} eyebrow={t('sensorEyebrow')} subtitle={t('sensorSubtitle')}>
    <Panel style={styles.summaryPanel}>
      <View style={styles.summaryHeading}><Text style={styles.summaryTitle}>{t('sensorsTitle')}</Text><StatePill label={overall} tone={tone} /></View>
      {connection.status === 'unconfigured' ? <Text style={styles.body}>{t('sensorsUnconfigured')}</Text> : connection.status === 'connecting' ? <Text style={styles.body}>{t('sensorsConnecting')}</Text> : connection.status === 'error' || connection.status === 'disconnected' ? <Text style={styles.body}>{t('sensorsOffline')}</Text> : staleAny || connection.status === 'stale' ? <Text style={styles.body}>{t('sensorsStale')}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => router.push('/diagnostics')} style={({ pressed }) => [styles.settingsLink, pressed && { opacity: 0.84 }]}><Text style={styles.settingsLinkText}>{t(connection.status === 'unconfigured' ? 'sensorsConnect' : 'sensorChange')} ›</Text></Pressable>
    </Panel>

    <View>
      <SectionTitle>{t('sensorsTitle')}</SectionTitle>
      {loading ? <LoadingState label={t('sensorWaiting')} /> : error ? <EmptyState title={t('sensorStorageError')} description={t('sensorStorageErrorDetail')} label="STORAGE ERROR" /> : <View style={styles.grid}>
        {cards.map((card) => {
          const sensor = sensors.find((item) => item.id === card.sensorId);
          const key = card.sensorId ?? card.kind;
          return <SensorTile key={key} card={card} reading={readings.find((item) => item.sensorId === sensor?.id)} healthDetail={sensor ? health.find((item) => item.sensorId === sensor.id)?.detail : undefined} label={t(labels[card.kind])} expanded={details === key || (!details && sensorId === key)} onDetails={() => setDetails(details === key ? undefined : key)} t={t} />;
        })}
      </View>}
    </View>

    <View><SectionTitle>{t('sensorDeviceHealth')}</SectionTitle>{nodes.length ? nodes.map((node) => <Panel key={node.id} style={styles.infoPanel}><View style={styles.summaryHeading}><Text style={styles.cardTitle}>{t('sensorUnit')}</Text><StatePill label={node.status === 'online' ? t('sensorLive') : node.status === 'stale' ? t('sensorStaleState') : t('sensorUnavailable')} tone={node.status === 'online' ? 'green' : node.status === 'stale' ? 'amber' : 'neutral'} /></View></Panel>) : <EmptyState title={t('sensorNoDevice')} description={t('sensorWaiting')} label="NO DEVICE DATA" />}</View>

    <View><SectionTitle>{t('sensorRecentReadings')}</SectionTitle>{history.length ? history.map((reading) => {
      const sensor = sensors.find((entry) => entry.id === reading.sensorId);
      const display = reading.value === undefined ? t('sensorReadingUnavailable') : sensor?.kind === 'temperature' ? `${reading.value.toFixed(1)} °C` : sensor?.kind === 'humidity' ? `${reading.value.toFixed(1)}%` : `${reading.value} · ${t('sensorRawValue')}`;
      const label = sensor && sensor.kind !== 'other' ? t(labels[sensor.kind]) : 'Sensor';
      return <Panel key={reading.id} style={styles.infoPanel}><View style={styles.summaryHeading}><Text style={styles.cardTitle}>{label}</Text><StatePill label={reading.quality === 'valid' ? (reading.source === 'device_wifi' ? t('sensorHistoryWifi') : t('sensorHistoryDevice')) : t('sensorHistoryInvalid')} tone={reading.quality === 'valid' ? 'blue' : 'amber'} /></View><Text style={styles.historyValue}>{display}</Text><Text style={styles.meta}>{formatTime(reading.receivedAt)}</Text></Panel>;
    }) : !loading && !error ? <EmptyState title={t('sensorNoHistory')} description={t('sensorWaiting')} label="NO RECORDS" /> : null}</View>
  </PrithviPage>;
}

function SensorTile({ card, reading, healthDetail, label, expanded, onDetails, t }: { card: SensorCardValue; reading?: SensorReading; healthDetail?: string; label: string; expanded: boolean; onDetails(): void; t(key: Parameters<typeof translate>[1]): string }) {
  const value = card.value === undefined ? t('sensorUnavailable') : card.kind === 'temperature' ? `${card.value.toFixed(1)} °C` : card.kind === 'humidity' ? `${card.value.toFixed(1)}%` : `${Math.round(card.value)}`;
  const stateLabel = card.state === 'live' ? t('sensorLive') : card.state === 'stale' ? t('sensorStaleState') : t('sensorUnavailable');
  const stateTone = card.state === 'live' ? 'green' : card.state === 'stale' ? 'amber' : 'neutral';
  return <Panel style={styles.tile}>
    <Text style={styles.tileLabel}>{label}</Text>
    <Text accessibilityLabel={`${label}: ${value}`} style={[styles.tileValue, card.value === undefined && styles.unavailable]}>{value}</Text>
    {card.raw && card.value !== undefined ? <Text style={styles.unit}>{t('sensorRawValue')}</Text> : null}
    <StatePill label={stateLabel} tone={stateTone} />
    <Text style={styles.meta}>{card.receivedAt ? `${t('sensorLastUpdated')} · ${formatTime(card.receivedAt)}` : t('sensorNoLastData')}</Text>
    <Pressable accessibilityRole="button" onPress={onDetails} style={styles.detailsButton}><Text style={styles.detailsText}>{t(expanded ? 'sensorHideDetails' : 'sensorDetails')}</Text></Pressable>
    {expanded ? <Text style={styles.detailCopy}>{card.raw ? t('sensorRawExplanation') : reading?.qualityDetail ?? reading?.unit ?? t('sensorReadingUnavailable')}{healthDetail ? ` · ${healthDetail}` : ''}</Text> : null}
  </Panel>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  summaryPanel: { gap: spacing.xs, backgroundColor: colors.surfaceSoft, borderWidth: 0 }, summaryHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, summaryTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' }, body: { color: colors.muted, fontSize: 13, lineHeight: 19 }, settingsLink: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center' }, settingsLinkText: { color: colors.green, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, tile: { flexGrow: 1, flexBasis: '46%', minWidth: 138, padding: spacing.md, gap: spacing.xs, borderWidth: 0, backgroundColor: colors.surface }, tileLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' }, tileValue: { color: colors.ink, fontSize: 23, lineHeight: 29, fontWeight: '700', marginTop: 2 }, unavailable: { color: colors.quiet, fontSize: 17 }, unit: { color: colors.muted, fontSize: 11, marginTop: -spacing.xs }, meta: { color: colors.muted, fontSize: 11, lineHeight: 15 }, detailsButton: { minHeight: 36, alignSelf: 'flex-start', justifyContent: 'center' }, detailsText: { color: colors.green, fontSize: 12, fontWeight: '700' }, detailCopy: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  infoPanel: { marginBottom: spacing.sm, padding: spacing.md }, cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', flex: 1 }, historyValue: { color: colors.ink, fontSize: 15, fontWeight: '600', marginTop: spacing.xs },
});
