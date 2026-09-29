import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Panel, PrithviPage, PrimaryButton, StatePill, TextField } from '@/components/ui/prithvi-page';
import { cameraProvider, droneTelemetryProvider, sensorService } from '@/data/container';
import type { SensorConnection } from '@/domain/models';
import { colors, spacing } from '@/theme/tokens';

export default function SettingsRoute() {
  const router = useRouter();
  const [sensorAddress, setSensorAddress] = useState('');
  const [cameraAddress, setCameraAddress] = useState('');
  const [droneAddress, setDroneAddress] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sensorConnection, setSensorConnection] = useState<SensorConnection>(sensorService.getConnection());
  const [cameraDetail, setCameraDetail] = useState('Address not configured.');
  const [droneDetail, setDroneDetail] = useState('Drone telemetry is optional and read-only.');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ section: string; message: string }>();

  useFocusEffect(useCallback(() => {
    let active = true;
    const unsubscribe = sensorService.subscribe(() => setSensorConnection(sensorService.getConnection()));
    void Promise.all([sensorService.getConfiguredBaseUrl(), cameraProvider.getConfiguredBaseUrl(), droneTelemetryProvider.getConfiguredBaseUrl()]).then(([sensor, camera, drone]) => {
      if (active) { if (sensor) setSensorAddress(sensor); if (camera) setCameraAddress(camera); if (drone) setDroneAddress(drone); }
    });
    void cameraProvider.checkStatus().then((state) => { if (active) setCameraDetail(state.detail); });
    void sensorService.start().then(setSensorConnection);
    return () => { active = false; unsubscribe(); };
  }, []));

  const saveSensor = async () => {
    await save('sensor', async () => { await sensorService.configureBaseUrl(sensorAddress); await sensorService.start(); setSensorConnection(sensorService.getConnection()); });
  };
  const saveCamera = async () => {
    await save('camera', async () => { await cameraProvider.configureBaseUrl(cameraAddress); const status = await cameraProvider.checkStatus(); setCameraDetail(status.detail); if (!status.connected) throw new Error(status.detail); });
  };
  const saveDrone = async () => {
    await save('drone', async () => { await droneTelemetryProvider.configureBaseUrl(droneAddress); setDroneDetail('Address saved locally. Telemetry is read-only; no flight commands are sent.'); droneTelemetryProvider.stop(); await droneTelemetryProvider.start(); });
  };
  const save = async (section: string, action: () => Promise<void>) => {
    setBusy(section); setError(undefined);
    try { await action(); } catch (reason) { setError({ section, message: reason instanceof Error ? reason.message : 'Could not save this address.' }); }
    finally { setBusy(undefined); }
  };

  const sensorLabel = sensorConnection.status === 'connected' ? 'Connected' : sensorConnection.status === 'connecting' ? 'Connecting' : sensorConnection.status === 'unconfigured' ? 'Not configured' : sensorConnection.status === 'error' ? 'Error' : 'Disconnected';

  return <PrithviPage title="Developer diagnostics" eyebrow="TECHNICAL SETTINGS" subtitle="Local device connection addresses and raw status. Keep these details in developer setup.">
    <EndpointPanel title="Field sensor hub (ESP32)" status={sensorLabel} detail={sensorConnection.detail ?? 'DHT11, soil, and rain readings'} address={sensorAddress} placeholder="http://device-address" onChange={setSensorAddress} onSave={() => { void saveSensor(); }} busy={busy === 'sensor'} error={error?.section === 'sensor' ? error.message : undefined} button="Save sensor address" />
    <EndpointPanel title="Camera (ESP32-CAM)" status={cameraProvider.getState() === 'connected' ? 'Connected' : cameraProvider.getState() === 'unreachable' ? 'Disconnected' : cameraAddress ? 'Configured' : 'Not configured'} detail={cameraDetail} address={cameraAddress} placeholder="http://device-address" onChange={setCameraAddress} onSave={() => { void saveCamera(); }} busy={busy === 'camera'} error={error?.section === 'camera' ? error.message : undefined} button="Save camera address" />
    <EndpointPanel title="Drone connection · read only" status={droneAddress ? 'Configured · read only' : 'Not configured'} detail={droneDetail} address={droneAddress} placeholder="http://device-address" onChange={setDroneAddress} onSave={() => { void saveDrone(); }} busy={busy === 'drone'} error={error?.section === 'drone' ? error.message : undefined} button="Save drone address" />
    {__DEV__ ? <Pressable accessibilityRole="button" onPress={() => setAdvancedOpen((open) => !open)} style={styles.advancedButton}><Text style={styles.advancedTitle}>{advancedOpen ? 'Hide' : 'Advanced / Developer'}</Text><Text style={styles.detail}>Developer tools and diagnostics</Text></Pressable> : null}
    {__DEV__ && advancedOpen ? <>
      {__DEV__ ? <Pressable accessibilityRole="button" onPress={() => router.push('/diagnostics' as Href)} style={styles.diagnosticsButton}><Text style={styles.advancedTitle}>Developer diagnostics</Text><Text style={styles.detail}>Check local runtime and hardware status</Text></Pressable> : null}
    </> : null}
    <Text style={styles.note}>Crop-health screening runs on this device and works offline. Results are screening observations and need field verification.</Text>
  </PrithviPage>;
}

function EndpointPanel({ title, status, detail, address, placeholder, onChange, onSave, busy, error, button }: { title: string; status: string; detail: string; address: string; placeholder: string; onChange(value: string): void; onSave(): void; busy: boolean; error?: string; button: string }) {
  return <Panel style={styles.panel}>
    <View style={styles.heading}><Text style={styles.title}>{title}</Text><StatePill label={status} tone={status === 'Connected' ? 'green' : status === 'Disconnected' || status === 'Error' ? 'red' : 'amber'} /></View>
    <Text style={styles.detail}>{detail}</Text>
    <TextField label="Local address" value={address} onChangeText={onChange} placeholder={placeholder} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
    <PrimaryButton label={busy ? 'Saving…' : button} onPress={onSave} disabled={busy} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </Panel>;
}

const styles = StyleSheet.create({ panel: { gap: spacing.xs }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, title: { color: colors.ink, fontSize: 17, fontWeight: '700', flex: 1 }, detail: { color: colors.muted, fontSize: 13, lineHeight: 19 }, error: { color: colors.red, fontSize: 13, lineHeight: 19, marginTop: spacing.xs }, note: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }, advancedButton: { minHeight: 52, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.sm }, advancedTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' }, diagnosticsButton: { minHeight: 52, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.sm } });
