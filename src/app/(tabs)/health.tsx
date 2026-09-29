import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { appProvider } from '@/data/container';
import type { CropObservation, SensorContextMeasurement } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function HealthRoute() {
  const router = useRouter();
  const [items, setItems] = useState<CropObservation[]>([]);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  useFocusEffect(useCallback(() => {
    let active = true;
    void appProvider.listObservations().then((rows) => { if (active) { setItems(rows); setError(false); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []));
  const open = (id: string) => router.push({ pathname: '/observations/[observationId]', params: { observationId: id } });

  return <PrithviPage title="Crop health" eyebrow="MONITOR" subtitle="Observations from images, ready for a field check.">
    <SectionTitle action={<Pressable accessibilityRole="button" onPress={() => router.push('/crop-health-scan' as Href)}><Text style={styles.action}>New scan</Text></Pressable>}>Latest observation</SectionTitle>
    {error ? <EmptyState title="Observations unavailable" description="Local crop observations could not be opened." /> : items.length === 0 ? <EmptyState title="Nothing to review yet" description="No crop-health scans have been saved on this device." /> : <ObservationCard item={items[0]} latest onOpen={() => open(items[0].id)} expanded={expanded === items[0].id} onToggle={() => setExpanded(expanded === items[0].id ? undefined : items[0].id)} />}

    {items.length > 1 ? <View><SectionTitle>Observation history</SectionTitle>{items.slice(1).map((item) => <ObservationCard key={item.id} item={item} onOpen={() => open(item.id)} expanded={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? undefined : item.id)} />)}</View> : null}
    <Text style={styles.disclaimer}>AI screening is not a diagnosis. Inspect the area yourself before deciding what to do.</Text>
  </PrithviPage>;
}

function ObservationCard({ item, latest, onOpen, expanded, onToggle }: { item: CropObservation; latest?: boolean; onOpen: () => void; expanded: boolean; onToggle: () => void }) {
  const language = useLanguage();
  const status = item.verificationStatus === 'verified' ? 'Verified by farmer' : item.verificationStatus === 'dismissed' ? 'Dismissed by farmer' : 'Needs verification';
  const timestamp = item.timestamp ?? item.observedAt;
  return <Panel style={[styles.panel, latest && styles.latestPanel]}>
    <Pressable accessibilityRole="button" onPress={onOpen}>
      {item.imageReference ? <Image accessibilityLabel="Saved crop observation image" source={{ uri: item.imageReference }} resizeMode="cover" style={styles.image} /> : null}
      <View style={styles.row}><Text style={styles.title}>{item.title}</Text><StatePill label={status} tone={item.verificationStatus === 'verified' ? 'green' : item.verificationStatus === 'dismissed' ? 'neutral' : 'amber'} /></View>
      <Text style={styles.body}>{[item.crop, item.condition].filter(Boolean).join(' · ') || 'Crop condition unavailable'}</Text>
      {item.source === 'manual_photo' ? <Text style={styles.body}>{translate(language, 'photoManualSource')}</Text> : null}
      <Text style={styles.body}>{item.fieldId ? `Field ${item.fieldId} · ` : 'Field not assigned · '}{new Date(timestamp).toLocaleString()}</Text>
      {item.confidence !== undefined ? <Text style={styles.body}>AI confidence {Math.round(item.confidence * 100)}%</Text> : null}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={styles.contextButton}><Text style={styles.contextToggle}>{expanded ? 'Hide environmental context' : 'Show environmental context'}</Text></Pressable>
    {expanded ? <View style={styles.context}>
      <Text style={styles.contextTitle}>Environmental context</Text>
      <ContextLine label="Location" value={item.latitude !== undefined && item.longitude !== undefined ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : 'Not available'} />
      <ContextLine label="Temperature" value={formatMeasurement(item.sensorContext?.temperature)} />
      <ContextLine label="Humidity" value={formatMeasurement(item.sensorContext?.humidity)} />
      <ContextLine label="Soil sensor (raw)" value={formatMeasurement(item.sensorContext?.soilRaw)} />
      <ContextLine label="Rain sensor (raw)" value={formatMeasurement(item.sensorContext?.rainRaw)} />
      <ContextLine label="Drone altitude" value={item.droneContext?.altitudeM === undefined ? 'Not available' : `${item.droneContext.altitudeM} m${item.droneContext.freshness === 'stale' ? ' · outdated' : ''}`} />
    </View> : null}
  </Panel>;
}

function ContextLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.contextLine}><Text style={styles.contextLabel}>{label}</Text><Text style={styles.contextValue}>{value}</Text></View>;
}

function formatMeasurement(measurement?: SensorContextMeasurement) {
  if (!measurement) return 'Not available';
  return `${measurement.value} ${measurement.unit}${measurement.freshness === 'stale' ? ' · outdated' : ''}`;
}

const styles = StyleSheet.create({
  action: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 14 },
  panel: { gap: spacing.sm, marginBottom: spacing.sm, borderWidth: 0, backgroundColor: colors.surfaceSoft },
  latestPanel: { backgroundColor: colors.greenSoft },
  image: { width: '100%', aspectRatio: 1, maxHeight: 300, borderRadius: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16, flex: 1 },
  body: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19, marginTop: 4 },
  contextButton: { minHeight: 40, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: spacing.xs },
  contextToggle: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13 },
  context: { gap: spacing.xs, paddingTop: spacing.xs },
  contextTitle: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14, marginBottom: 2 },
  contextLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  contextLabel: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12 },
  contextValue: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 12, textAlign: 'right', flex: 1 },
  disclaimer: { color: colors.muted, fontFamily: fontFamilies.body, textAlign: 'center', fontSize: 12, lineHeight: 18 },
});
