import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { EmptyState, Panel, PrithviPage, PrimaryButton, StatePill } from '@/components/ui/prithvi-page';
import { appProvider, sensorService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import type { Sensor, SensorConnection, SensorNode, SensorReading } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function ConnectFieldHubRoute() {
  const { fieldId } = useLocalSearchParams<{ fieldId: string }>(); const router = useRouter(); const language = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [connection, setConnection] = useState<SensorConnection>(sensorService.getConnection());
  const [hub, setHub] = useState<SensorNode>(); const [working, setWorking] = useState(false);
  const refresh = useCallback(async () => {
    setConnection(sensorService.getConnection());
    const nodes = await appProvider.listNodes();
    const field = await appProvider.getField(fieldId);
    const linked = (nodes as SensorNode[]).filter((node) => node.fieldId === fieldId || field?.sensorNodeIds.includes(node.id));
    setHub(linked.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))[0]);
  }, [fieldId]);
  useFocusEffect(useCallback(() => {
    let active = true; const unsubscribe = sensorService.subscribe(() => { if (active) { setConnection(sensorService.getConnection()); void refresh(); } });
    void refresh(); return () => { active = false; unsubscribe(); };
  }, [refresh]));
  const connect = async () => {
    setWorking(true);
    try {
      const state = await sensorService.start(); setConnection(state);
      if (state.status === 'connected' && state.deviceId) {
        const [field, nodes] = await Promise.all([appProvider.getField(fieldId), appProvider.listNodes()]);
        const found = (nodes as SensorNode[]).find((node) => node.id === state.deviceId);
        if (field && found && (!found.fieldId || found.fieldId === fieldId || field.sensorNodeIds.includes(found.id))) {
          await localStore.save('sensor-node', { ...found, fieldId });
          await localStore.save('field', { ...field, sensorNodeIds: [...new Set([...field.sensorNodeIds, found.id])] });
          const [allSensors, allReadings] = await Promise.all([localStore.list<Sensor>('sensor'), localStore.list<SensorReading>('sensor-reading')]);
          const linked = allSensors.filter((sensor) => sensor.nodeId === found.id);
          await Promise.all(allReadings.filter((reading) => linked.some((sensor) => sensor.id === reading.sensorId)).map((reading) => {
            const sensor = linked.find((item) => item.id === reading.sensorId)!;
            return localStore.save('sensor-reading', { ...reading, hubId: found.id, fieldId, zonePosition: sensor.zonePosition ?? reading.zonePosition });
          }));
        }
      }
      await refresh();
    } catch { setConnection(sensorService.getConnection()); }
    finally { setWorking(false); }
  };
  const connected = connection.status === 'connected' && Boolean(hub);
  return <PrithviPage title={t('hubConnectTitle')} eyebrow={t('fieldDevices')} subtitle={t('hubConnectHelp')}>
    <Panel style={styles.summary}><Text style={styles.heading}>{t('sensorFieldHub')}</Text><StatePill label={connected ? t('deviceConnected') : t('deviceNotConnected')} tone={connected ? 'green' : 'neutral'} />
      {hub ? <><Text style={styles.detail}>{t('hubSensorsDetected').replace('{count}', String(hub.sensorIds.length))}</Text><Text style={styles.detail}>{t('hubLastUpdate')}: {relativeTime(hub.lastSeenAt, language)}</Text></> : null}
    </Panel>
    {!connected ? <EmptyState title={t('hubPowerTitle')} description={t('hubPowerHelp')} /> : null}
    {connection.status === 'unconfigured' ? <Panel><Text style={styles.detail}>{t('hubNeedsSetup')}</Text><Pressable accessibilityRole="button" onPress={() => router.push('/diagnostics')} style={styles.link}><Text style={styles.linkText}>{t('hubContinueSetup')} ›</Text></Pressable></Panel> : null}
    <PrimaryButton label={working ? t('hubConnecting') : connected ? t('hubConnectedDone') : t('hubConnectAction')} disabled={working || connected} onPress={() => { void connect(); }} />
    {connected ? <PrimaryButton label={t('hubDone')} onPress={() => router.back()} /> : null}
  </PrithviPage>;
}
function relativeTime(value: string | undefined, language: 'en' | 'hi') { if (!value) return '—'; const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (!Number.isFinite(seconds)) return '—'; return language === 'hi' ? `${seconds} सेकंड पहले` : `${seconds} seconds ago`; }
const styles = StyleSheet.create({ summary: { gap: spacing.sm, backgroundColor: colors.greenSoft, borderWidth: 0 }, heading: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 18 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20 }, link: { minHeight: 44, justifyContent: 'center' }, linkText: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 14 } });
