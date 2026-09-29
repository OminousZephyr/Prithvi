import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, aiRepository, appProvider, scoutingRepository } from '@/data/container';
import type { CropObservation, ScoutingEvidence, ScoutingTask, ScoutingZone } from '@/domain/models';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function ScoutingZoneDetailsRoute() {
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const router = useRouter();
  const [zone, setZone] = useState<ScoutingZone>();
  const [items, setItems] = useState<CropObservation[]>([]);
  const [evidence, setEvidence] = useState<ScoutingEvidence>();
  const [tasks, setTasks] = useState<ScoutingTask[]>([]);
  const [fieldName, setFieldName] = useState('Field not assigned');
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    const [current, observations, evidenceRows, taskRows, fields] = await Promise.all([
      scoutingRepository.getZone(zoneId), appProvider.listObservations(), scoutingRepository.listEvidence(), scoutingRepository.listTasks(), appProvider.listFields(),
    ]);
    if (!current) { setError(true); return; }
    setZone(current);
    setItems(current.observationIds.map((id) => observations.find((item) => item.id === id)).filter((item): item is CropObservation => !!item));
    setEvidence(evidenceRows.find((item) => item.zoneId === current.id || item.observationIds.some((id) => current.observationIds.includes(id))));
    setTasks(taskRows.filter((item) => item.zoneId === current.id));
    setFieldName(fields.find((item) => item.id === current.fieldId)?.name ?? 'Field not assigned');
  }, [zoneId]);
  useFocusEffect(useCallback(() => { void refresh().catch(() => setError(true)); }, [refresh]));
  const verify = async (state: CropObservation['verificationStatus']) => {
    if (!zone) return;
    await Promise.all(zone.observationIds.map((id) => aiRepository.updateObservationVerification(id, state)));
    const evidenceStatus = state === 'verified' ? 'verified' : state === 'dismissed' ? 'dismissed' : 'needs_verification';
    await scoutingRepository.verifyZone(zone.id, evidenceStatus);
    await advisoryRepository.refresh();
    await refresh();
  };
  if (!zone) return <PrithviPage title="Inspection area" eyebrow="SCOUTING"><EmptyState title={error ? 'Inspection area unavailable' : 'Loading inspection area'} description={error ? 'This local zone could not be opened.' : 'Opening saved scouting evidence.'} /></PrithviPage>;
  const dates = items.map((item) => item.timestamp ?? item.observedAt).sort();
  const latest = dates[dates.length - 1];
  return <PrithviPage title="Inspection area" eyebrow="SCOUTING · EVIDENCE">
    <Panel style={styles.summary}><View style={styles.row}><Text style={styles.title}>Inspection suggested</Text><StatePill label={evidence?.status.replaceAll('_', ' ') ?? zone.status.replaceAll('_', ' ')} tone="amber" /></View><Text style={styles.copy}>{fieldName} · {zone.crop ?? items[0]?.crop ?? 'Crop unavailable'} · {zone.condition ?? items[0]?.condition ?? 'Condition unavailable'}</Text><Text style={styles.copy}>{zone.center.latitude.toFixed(6)}, {zone.center.longitude.toFixed(6)}</Text><Text style={styles.copy}>{items.length} observation{items.length === 1 ? '' : 's'} · Evidence: {evidence?.evidenceLevel.replaceAll('_', ' ') ?? 'single observation'}</Text><Text style={styles.copy}>First observed: {evidence ? new Date(evidence.firstObservedAt).toLocaleString() : items[0] ? new Date(items[0].timestamp ?? items[0].observedAt).toLocaleString() : 'Unavailable'}</Text><Text style={styles.copy}>Last observed: {latest ? new Date(latest).toLocaleString() : 'Unavailable'}</Text></Panel>
    <SectionTitle>Observations</SectionTitle>
    {items.map((item) => <Pressable key={item.id} onPress={() => router.push({ pathname: '/observations/[observationId]', params: { observationId: item.id } })}><Panel style={styles.observation}><View style={styles.row}><Text style={styles.title}>{item.title}</Text><StatePill label={item.verificationStatus.replaceAll('_', ' ')} tone={item.verificationStatus === 'verified' ? 'green' : 'amber'} /></View><Text style={styles.copy}>{item.crop ?? 'Crop unavailable'} · {item.condition ?? 'Condition unavailable'}</Text><Text style={styles.copy}>{item.confidence === undefined ? 'Confidence unavailable' : `${Math.round(item.confidence * 100)}% individual confidence`} · {new Date(item.timestamp ?? item.observedAt).toLocaleString()}</Text><Text style={styles.copy}>Image quality: {item.imageQuality ?? 'unavailable'}</Text></Panel></Pressable>)}
    <SectionTitle>Rescan state</SectionTitle>
    {tasks.length ? tasks.map((task) => <Panel key={task.id}><View style={styles.row}><Text style={styles.title}>{task.reason ?? 'Targeted rescan'}</Text><StatePill label={task.status.replaceAll('_', ' ')} tone="amber" /></View><Text style={styles.copy}>{task.lastRescanOutcome ? `Latest model comparison: ${task.lastRescanOutcome.replaceAll('_', ' ')}` : 'Requested locally; it has not completed yet.'}</Text>{task.completedAt ? <Text style={styles.copy}>Completed: {new Date(task.completedAt).toLocaleString()}</Text> : null}{task.status === 'rescan_requested' || task.status === 'targeted_rescan_requested' ? <PrimaryButton label="Capture targeted rescan" onPress={() => router.push({ pathname: '/crop-health-scan', params: { scoutingTaskId: task.id } })} /> : null}</Panel>) : <Text style={styles.copy}>No targeted rescan requested.</Text>}
    <SectionTitle>Farmer verification</SectionTitle>
    <Panel style={styles.actions}><Text style={styles.copy}>Your review is stored separately. It does not change the original model label or confidence.</Text><PrimaryButton label="Mark field check verified" onPress={() => { void verify('verified'); }} /><Pressable onPress={() => { void verify('requires_verification'); }} style={styles.secondary}><Text style={styles.secondaryText}>Needs more inspection</Text></Pressable><Pressable onPress={() => { void verify('dismissed'); }} style={styles.secondary}><Text style={styles.secondaryText}>Dismiss this suggestion</Text></Pressable></Panel>
    <Text style={styles.disclaimer}>Repeated AI observations are an inspection signal, not confirmation of disease.</Text>
  </PrithviPage>;
}

const styles = StyleSheet.create({ summary: { gap: 5, backgroundColor: colors.amberSoft, borderWidth: 0 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, title: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, flex: 1 }, copy: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19, marginTop: 4 }, observation: { marginBottom: spacing.xs, gap: 3, borderWidth: 0, backgroundColor: colors.surfaceSoft }, actions: { gap: spacing.sm, borderWidth: 0, backgroundColor: colors.surfaceSoft }, secondary: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.line }, secondaryText: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 14 }, disclaimer: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 } });
