import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { appProvider, scoutingRepository } from '@/data/container';
import type { CropObservation, Field, ScoutingEvidence, ScoutingTask, ScoutingZone } from '@/domain/models';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function ScoutingRoute() {
  const router = useRouter();
  const [observations, setObservations] = useState<CropObservation[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [zones, setZones] = useState<ScoutingZone[]>([]);
  const [tasks, setTasks] = useState<ScoutingTask[]>([]);
  const [evidence, setEvidence] = useState<ScoutingEvidence[]>([]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void Promise.all([appProvider.listObservations(), appProvider.listFields(), scoutingRepository.listTasks(), scoutingRepository.listEvidence()])
      .then(([obs, fieldRows, taskRows, evidenceRows]) => Promise.all([obs, fieldRows, taskRows, evidenceRows, Promise.all(fieldRows.map((field) => scoutingRepository.listZones(field.id)))]))
      .then(([obs, fieldRows, taskRows, evidenceRows, zoneLists]) => { if (active) { setObservations(obs); setFields(fieldRows); setTasks(taskRows); setEvidence(evidenceRows); setZones(zoneLists.flat()); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, []));
  const fieldName = (id: string) => fields.find((field) => field.id === id)?.name ?? 'Field not assigned';
  const byId = new Map(observations.map((item) => [item.id, item]));
  const openZone = (id: string) => router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: id } } as unknown as Href);
  return <PrithviPage title="Scouting" eyebrow="MONITOR · FIELD CHECKS" subtitle="Review repeated observations and local inspection requests.">
    <SectionTitle>Current scouting status</SectionTitle>
    {zones.length || tasks.length ? <Panel style={styles.summary}><Text style={styles.heading}>{zones.length} inspection {zones.length === 1 ? 'area' : 'areas'}</Text><Text style={styles.detail}>{tasks.filter((item) => ['rescan_requested', 'rescan_in_progress', 'targeted_rescan_requested'].includes(item.status)).length} pending rescans · {evidence.filter((item) => !['verified', 'dismissed'].includes(item.status)).length} evidence records need review</Text></Panel> : <EmptyState title="No inspection suggested" description="Scouting appears after eligible, real field observations are recorded." label="NO SCOUTING DATA" />}
    <SectionTitle>Inspection areas</SectionTitle>
    {zones.length ? zones.map((zone) => {
      const linked = zone.observationIds.map((id) => byId.get(id)).filter((item): item is CropObservation => !!item);
      const itemEvidence = evidence.find((item) => item.zoneId === zone.id || item.observationIds.some((id) => zone.observationIds.includes(id)));
      const dates = linked.map((item) => item.timestamp ?? item.observedAt).sort();
      const lastSeen = dates[dates.length - 1];
      const zoneStatus = zone.status.replaceAll('_', ' ');
      return <Pressable key={zone.id} accessibilityRole="button" onPress={() => openZone(zone.id)}><Panel style={styles.zone}><View style={styles.row}><Text style={styles.heading}>{zone.status === 'verified' ? 'Field check recorded' : zone.status === 'dismissed' ? 'Suggestion dismissed' : 'Inspection suggested'}</Text><StatePill label={itemEvidence?.evidenceLevel?.replaceAll('_', ' ') ?? zoneStatus} tone={zone.status === 'verified' ? 'green' : zone.status === 'dismissed' ? 'neutral' : 'amber'} /></View><Text style={styles.detail}>{fieldName(zone.fieldId)} · {zone.crop ?? linked[0]?.crop ?? 'Crop unavailable'}</Text><Text style={styles.issue}>{linked.length} observations show a similar possible issue.</Text><Text style={styles.detail}>Last observed {lastSeen ? new Date(lastSeen).toLocaleString() : 'time unavailable'}</Text><Text style={styles.next}>Review evidence or inspect this area ›</Text></Panel></Pressable>;
    }) : null}
    <SectionTitle>Rescans</SectionTitle>
    {tasks.length ? tasks.map((task) => <Panel key={task.id}><View style={styles.row}><Text style={styles.heading}>{task.reason ?? 'Targeted inspection'}</Text><StatePill label={task.status.replaceAll('_', ' ')} tone={task.status === 'rescan_requested' || task.status === 'rescan_in_progress' ? 'amber' : 'neutral'} /></View><Text style={styles.detail}>{fieldName(task.fieldId)} · {task.sourceObservationIds?.length ?? task.observationIds.length} source observations</Text><Text style={styles.detail}>{task.lastRescanOutcome ? `Latest result: ${task.lastRescanOutcome.replaceAll('_', ' ')}` : 'Local request only · no aircraft command sent'}</Text>{task.zoneId ? <Pressable onPress={() => openZone(task.zoneId!)}><Text style={styles.next}>Open inspection area ›</Text></Pressable> : null}{task.status === 'rescan_requested' || task.status === 'targeted_rescan_requested' ? <Pressable onPress={() => router.push({ pathname: '/crop-health-scan', params: { scoutingTaskId: task.id } } as Href)}><Text style={styles.next}>Capture a rescan image ›</Text></Pressable> : null}</Panel>) : <Text style={styles.detail}>No targeted rescans requested.</Text>}
    <SectionTitle>Recent observations</SectionTitle>
    {observations.length ? observations.slice(0, 8).map((item) => <Pressable key={item.id} onPress={() => router.push({ pathname: '/observations/[observationId]', params: { observationId: item.id } })}><View style={styles.observation}><View style={styles.bullet} /><View style={styles.copy}><Text style={styles.heading}>{item.title}</Text><Text style={styles.detail}>{fieldName(item.fieldId ?? '')} · {[item.crop, item.condition].filter(Boolean).join(' · ') || 'Condition not recorded'}</Text><Text style={styles.detail}>{item.confidence === undefined ? 'Confidence unavailable' : `${Math.round(item.confidence * 100)}% individual AI confidence`} · {new Date(item.timestamp ?? item.observedAt).toLocaleString()}</Text></View><Text style={styles.arrow}>›</Text></View></Pressable>) : <EmptyState title="Nothing to review yet" description="Saved field observations will appear here." />}
  </PrithviPage>;
}

const styles = StyleSheet.create({ summary: { backgroundColor: colors.blueSoft, borderWidth: 0 }, zone: { gap: 5, backgroundColor: colors.amberSoft, borderWidth: 0, marginBottom: spacing.xs }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, heading: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, flex: 1 }, issue: { color: colors.ink, fontFamily: fontFamilies.body, fontSize: 14, marginTop: 4 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, marginTop: 4 }, next: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13, marginTop: 8 }, observation: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, bullet: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.sage }, copy: { flex: 1 }, arrow: { color: colors.muted, fontSize: 22 } });
