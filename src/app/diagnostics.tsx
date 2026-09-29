import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill, TextField } from '@/components/ui/prithvi-page';
import { accountService, aiProvider, cameraProvider, droneTelemetryProvider, onDeviceAIProvider, optionalAIProvider, sensorService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import { MOBILENETV3_MODEL_VERSION } from '@/features/ai/on-device/mobilenetv3-model';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

type Diagnostic = { title: string; status: string; detail: string };

export default function DiagnosticsRoute() {
  const router = useRouter();
  const [rows, setRows] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [error, setError] = useState<string>();
  const [aiServerUrl, setAiServerUrl] = useState('');
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [aiServerMessage, setAiServerMessage] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true); setError(undefined);
    try {
      const [model, sensorUrl, sensorHealth, cameraUrl, cameraStatus, droneUrl, sqlite, account, syncQueue, syncMeta] = await Promise.all([
        onDeviceAIProvider.getStatus(), sensorService.getConfiguredBaseUrl(), sensorService.checkEndpointHealth(),
        cameraProvider.getConfiguredBaseUrl(), cameraProvider.checkStatus(), droneTelemetryProvider.getConfiguredBaseUrl(),
        localStore.list('farm'), accountService.snapshot(), localStore.list('sync-queue'), localStore.get<{ lastSyncedAt?: string }>('sync-metadata', 'current'),
      ]);
      if (droneUrl) await droneTelemetryProvider.start();
      const serverUrl = await optionalAIProvider.getConfiguredBaseUrl().catch(() => undefined);
      const fallback = await aiProvider.isOptionalServerFallbackEnabled();
      setAiServerUrl(serverUrl ?? ''); setFallbackEnabled(fallback);
      const drone = droneTelemetryProvider.getStatus();
      setRows([
        { title: 'On-device AI', status: model.status, detail: `${MOBILENETV3_MODEL_VERSION} · ${model.detail}` },
        { title: 'ESP32 sensors', status: sensorHealth.available ? sensorService.getConnection().status : 'unavailable', detail: `${sensorUrl ?? 'Not configured'} · ${sensorHealth.detail}` },
        { title: 'ESP32-CAM', status: cameraStatus.connected ? 'connected' : cameraProvider.getState(), detail: `${cameraUrl ?? 'Not configured'} · ${cameraStatus.detail}` },
        { title: 'Drone telemetry', status: drone.status, detail: `${droneUrl ?? 'Not configured'} · ${drone.detail}` },
        { title: 'SQLite', status: 'available', detail: `Local database responded; ${sqlite.length} farm record(s) found.` },
        { title: 'Account and sync', status: account.configured ? 'configured' : 'not configured', detail: `Pending changes: ${syncQueue.length} · Last sync: ${syncMeta?.lastSyncedAt ?? 'not yet'}` },
        { title: 'Optional AI server', status: serverUrl ? 'configured · optional' : 'not configured · optional', detail: serverUrl ?? 'Not required for crop-health scans.' },
      ]);
      setUpdatedAt(new Date().toLocaleString());
    } catch {
      setError('Some diagnostics could not be read. Reopen this screen or check local device settings.');
    } finally { setBusy(false); }
  }, []);

  const saveOptionalServer = async () => {
    setAiServerMessage('');
    try {
      const saved = await optionalAIProvider.configureBaseUrl(aiServerUrl);
      setAiServerUrl(saved); setAiServerMessage('Optional developer URL saved on this device.');
      await refresh();
    } catch (reason) { setAiServerMessage(reason instanceof Error ? reason.message : 'Could not save this URL.'); }
  };
  const setFallback = async (enabled: boolean) => {
    setFallbackEnabled(enabled);
    await aiProvider.setOptionalServerFallbackEnabled(enabled);
  };

  useFocusEffect(useCallback(() => { void refresh(); return () => droneTelemetryProvider.stop(); }, [refresh]));

  return <PrithviPage title="Developer diagnostics" eyebrow="DEVELOPER TOOLS" subtitle="Local runtime and hardware status for development builds.">
    <Text style={styles.note}>This screen is for development checks. It does not send flight commands or require the optional AI server.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/developer-connections')}><Panel><Text style={styles.title}>Configure local device connections</Text><Text style={styles.detail}>Technical connection addresses for developers</Text></Panel></Pressable>
    <PrimaryButton label={busy ? 'Checking…' : 'Refresh diagnostics'} onPress={() => { void refresh(); }} disabled={busy} />
    {busy && !rows.length ? <ActivityIndicator color={colors.green} /> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <SectionTitle>Runtime status</SectionTitle>
    {rows.map((row) => <Panel key={row.title} style={styles.panel}>
      <View style={styles.heading}><Text style={styles.title}>{row.title}</Text><StatePill label={row.status} tone={row.status === 'ready' || row.status === 'connected' || row.status === 'available' ? 'green' : row.status.includes('unavailable') || row.status === 'error' ? 'red' : 'amber'} /></View>
      <Text selectable style={styles.detail}>{row.detail}</Text>
    </Panel>)}
    <SectionTitle>Optional local AI server</SectionTitle>
    <Panel style={styles.panel}>
      <Text style={styles.detail}>Developer fallback only. Crop scans use on-device AI first and do not check this server during normal inference.</Text>
      <TextField label="Optional server URL" value={aiServerUrl} onChangeText={setAiServerUrl} placeholder="http://COMPUTER-IP:8000" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <PrimaryButton label="Save developer URL" onPress={() => { void saveOptionalServer(); }} />
      <View style={styles.fallbackRow}><Text style={styles.detail}>Allow fallback only when on-device AI is unavailable</Text><Switch value={fallbackEnabled} onValueChange={(value) => { void setFallback(value); }} accessibilityLabel="Allow optional local AI server fallback" /></View>
      {aiServerMessage ? <Text style={styles.detail}>{aiServerMessage}</Text> : null}
    </Panel>
    {updatedAt ? <Text style={styles.timestamp}>Checked {updatedAt}</Text> : null}
  </PrithviPage>;
}

const styles = StyleSheet.create({ note: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19 }, panel: { gap: spacing.xs }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, title: { flex: 1, color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, flex: 1 }, fallbackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }, error: { color: colors.red, fontFamily: fontFamilies.medium, fontSize: 13 }, timestamp: { textAlign: 'center', color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12 } });
