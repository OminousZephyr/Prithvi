import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, LoadingState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, appProvider } from '@/data/container';
import type { Advisory, CropObservation, Farm, Field, SensorContextMeasurement } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function ObservationDetailsRoute() {
  const language = useLanguage();
  const { observationId } = useLocalSearchParams<{ observationId: string }>();
  const [observation, setObservation] = useState<CropObservation>();
  const [field, setField] = useState<Field>();
  const [farm, setFarm] = useState<Farm>();
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verificationError, setVerificationError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const record = await appProvider.getObservation(observationId);
      setObservation(record);
      const relatedField = record?.fieldId ? await appProvider.getField(record.fieldId) : undefined;
      setField(relatedField);
      setFarm(record?.farmId ? await appProvider.getFarm(record.farmId) : relatedField?.farmId ? await appProvider.getFarm(relatedField.farmId) : undefined);
      setAdvisories(record ? await advisoryRepository.listForObservation(record.id) : []);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [observationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const requestVerification = (state: CropObservation['verificationStatus']) => {
    const action = state === 'verified' ? 'Mark as verified' : state === 'dismissed' ? 'Dismiss observation' : 'Return to needs verification';
    const explanation = state === 'verified'
      ? 'This records your field check. It does not label a disease as confirmed.'
      : state === 'dismissed' ? 'This records that you reviewed and dismissed this observation.' : 'This observation will need another field check.';
    Alert.alert('Update field check', explanation, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, style: state === 'dismissed' ? 'destructive' : 'default', onPress: () => { setVerificationError(false); void appProvider.updateObservationVerification(observation!.id, state).then((updated) => { if (updated) setObservation(updated); }).catch(() => setVerificationError(true)); } },
    ]);
  };

  if (failed) return <PrithviPage title="Observation" eyebrow="FIELD EVIDENCE"><EmptyState title="Observation unavailable" description="This saved observation could not be opened from local storage." /></PrithviPage>;
  if (loading) return <PrithviPage title="Observation" eyebrow="FIELD EVIDENCE"><LoadingState label="Opening saved observation…" /></PrithviPage>;
  if (!observation) return <PrithviPage title="Observation" eyebrow="FIELD EVIDENCE"><EmptyState title="Observation not found" description="No saved observation matches this reference." label="NO LOCAL RECORD" /></PrithviPage>;

  const verifiedLabel = observation.verificationStatus === 'verified' ? 'Verified by farmer' : observation.verificationStatus === 'dismissed' ? 'Dismissed by farmer' : 'Needs verification';
  const timestamp = observation.timestamp ?? observation.observedAt;
  const location = observation.latitude !== undefined && observation.longitude !== undefined
    ? `${observation.latitude.toFixed(6)}, ${observation.longitude.toFixed(6)}`
    : observation.location ? `${observation.location.latitude.toFixed(6)}, ${observation.location.longitude.toFixed(6)}` : undefined;

  return <PrithviPage title="Observation" eyebrow="FIELD EVIDENCE" subtitle="Review what was seen, then record your field check.">
    <SectionTitle>Observation</SectionTitle>
    {observation.imageReference ? <Image accessibilityLabel="Crop observation image" source={{ uri: observation.imageReference }} resizeMode="contain" style={styles.image} /> : <EmptyState title="Image unavailable" description="The saved image reference is no longer available on this device." />}
    <Panel style={styles.panel}>
      <View style={styles.row}><Text style={styles.title}>{observation.title}</Text><StatePill label={verifiedLabel} tone={observation.verificationStatus === 'verified' ? 'green' : observation.verificationStatus === 'dismissed' ? 'neutral' : 'amber'} /></View>
      {observation.description ? <Text style={styles.body}>{observation.description}</Text> : null}
      <Detail label="Crop" value={observation.crop ?? 'Not recorded'} />
      <Detail label="Condition" value={observation.condition ?? 'Not recorded'} />
      <Detail label="AI confidence" value={observation.confidence === undefined ? 'Not available' : `${Math.round(observation.confidence * 100)}%`} />
      <Detail label="Image quality" value={observation.imageQuality === 'acceptable' ? 'Basic quality checks passed' : observation.imageQuality === 'low' ? 'Needs another image' : 'Not available'} />
      <Detail label="Source" value={observation.source === 'manual_photo' ? translate(language, 'photoManualSource') : observation.source === 'esp32_cam_rgb' ? 'ESP32-CAM RGB' : observation.source === 'local_image' ? 'Local image' : observation.source} />
    </Panel>

    <SectionTitle>Suggested next step</SectionTitle>
    {advisories.length ? advisories.map((advisory) => <Panel key={advisory.id} style={styles.panel}><Text style={styles.title}>{advisory.title}</Text><Detail label="What" value={advisory.message} /><Detail label="Why" value={advisory.reason} /><Detail label="Next" value={advisory.action} /><Detail label="Status" value={advisory.status.replaceAll('_', ' ')} /></Panel>) : <Text style={styles.body}>No advisory is linked to this observation.</Text>}

    <SectionTitle>Where</SectionTitle>
    <Panel style={styles.panel}>
      <Detail label="Farm" value={farm?.name ?? 'Not assigned'} />
      <Detail label="Field" value={field?.name ?? 'Not assigned'} />
      <Detail label="Coordinates" value={location ?? 'Not available'} />
      <Detail label="Growth stage" value={observation.growthStage ?? field?.crop?.growthStage ?? 'Not recorded'} />
    </Panel>

    <SectionTitle>When</SectionTitle>
    <Panel style={styles.panel}><Detail label="Last observed" value={new Date(timestamp).toLocaleString()} /></Panel>

    <SectionTitle>Environmental context</SectionTitle>
    <Panel style={styles.panel}>
      <Detail label="Temperature" value={formatMeasurement(observation.sensorContext?.temperature)} />
      <Detail label="Humidity" value={formatMeasurement(observation.sensorContext?.humidity)} />
      <Detail label="Soil raw ADC" value={formatMeasurement(observation.sensorContext?.soilRaw)} />
      <Detail label="Rain raw ADC" value={formatMeasurement(observation.sensorContext?.rainRaw)} />
      <Detail label="Drone position" value={observation.droneContext?.latitude !== undefined && observation.droneContext.longitude !== undefined ? `${observation.droneContext.latitude.toFixed(6)}, ${observation.droneContext.longitude.toFixed(6)}${observation.droneContext.freshness === 'stale' ? ' · outdated' : ''}` : 'Not available'} />
      <Detail label="Drone altitude" value={contextValue(observation.droneContext?.altitudeM, 'm', observation.droneContext?.freshness)} />
      <Detail label="Drone heading" value={contextValue(observation.headingDegrees ?? observation.droneContext?.headingDegrees, '°', observation.droneContext?.freshness)} />
      <Detail label="Drone speed" value={contextValue(observation.droneContext?.speedMps, 'm/s', observation.droneContext?.freshness)} />
      <Detail label="Drone battery" value={contextValue(observation.droneContext?.batteryPercent, '%', observation.droneContext?.freshness)} />
      <Detail label="GPS satellites" value={contextValue(observation.droneContext?.satellites, '', observation.droneContext?.freshness)} />
      {observation.droneContext ? <Detail label="Telemetry time" value={`${new Date(observation.droneContext.timestamp).toLocaleString()}${observation.droneContext.freshness === 'stale' ? ' · outdated' : ''}`} /> : null}
    </Panel>

    <SectionTitle>AI information</SectionTitle>
    <Panel style={styles.panel}>
      <Detail label="Model" value={observation.ai?.modelName ?? 'Not recorded'} />
      <Detail label="Version" value={observation.modelVersion ?? observation.ai?.modelVersion ?? 'Not recorded'} />
      <Detail label="Raw model label" value={observation.rawModelLabel ?? observation.rawLabel ?? 'Not recorded'} />
      <Detail label="Data quality" value={observation.dataQuality ?? 'Not recorded'} />
      <Detail label="Provenance" value={observation.provenance?.join(' · ') ?? 'Not recorded'} />
    </Panel>

    <SectionTitle>Field verification</SectionTitle>
    <Panel style={styles.panel}>
      <Text style={styles.body}>A farmer field check records your review. It does not turn an AI screening result into a confirmed disease.</Text>
      {observation.verificationNote ? <Detail label="Note" value={observation.verificationNote} /> : null}
      {observation.verificationChangedAt ? <Detail label="Updated by farmer" value={new Date(observation.verificationChangedAt).toLocaleString()} /> : null}
      <View style={styles.actions}>
        {observation.verificationStatus !== 'verified' ? <Pressable accessibilityRole="button" onPress={() => requestVerification('verified')} style={styles.action}><Text style={styles.actionText}>Mark verified</Text></Pressable> : null}
        {observation.verificationStatus !== 'dismissed' ? <Pressable accessibilityRole="button" onPress={() => requestVerification('dismissed')} style={[styles.action, styles.dismissAction]}><Text style={[styles.actionText, styles.dismissText]}>Dismiss</Text></Pressable> : null}
        {observation.verificationStatus !== 'requires_verification' ? <Pressable accessibilityRole="button" onPress={() => requestVerification('requires_verification')} style={styles.action}><Text style={styles.actionText}>Needs another check</Text></Pressable> : null}
      </View>
      {verificationError ? <Text style={styles.error}>Could not save this field-check update. Please try again.</Text> : null}
    </Panel>
    <Text style={styles.disclaimer}>AI screening is not a diagnosis. Inspect the area yourself before deciding what to do.</Text>
  </PrithviPage>;
}

function formatMeasurement(measurement?: SensorContextMeasurement) {
  return measurement ? `${measurement.value} ${measurement.unit}${measurement.freshness === 'stale' ? ' · outdated' : ''} · ${new Date(measurement.timestamp).toLocaleTimeString()}` : 'Not available';
}
function contextValue(value: number | undefined, unit: string, freshness?: 'current' | 'stale') {
  return value === undefined ? 'Not available' : `${value}${unit ? ` ${unit}` : ''}${freshness === 'stale' ? ' · outdated' : ''}`;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 1, maxHeight: 360, borderRadius: 20, backgroundColor: colors.surfaceSoft },
  panel: { gap: spacing.md, borderWidth: 0, backgroundColor: colors.surfaceSoft },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17, flex: 1 },
  body: { color: colors.ink, fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 21 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.sm },
  label: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13 },
  value: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 13, textAlign: 'right', flex: 1 },
  actions: { gap: spacing.xs, marginTop: spacing.sm },
  action: { minHeight: 44, borderRadius: 14, justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.green },
  dismissAction: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  actionText: { color: colors.white, fontFamily: fontFamilies.semibold, textAlign: 'center' },
  dismissText: { color: colors.green },
  error: { color: colors.red, fontFamily: fontFamilies.medium, fontSize: 13 },
  disclaimer: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
