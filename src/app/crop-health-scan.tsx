import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, aiProvider, aiRepository, appProvider, cameraProvider, droneRepository, droneTelemetryProvider, observationLocationProvider, sensorService, scoutingRepository } from '@/data/container';
import type { CropObservation, Field } from '@/domain/models';
import type { AIAnalysisMetadata, AIAnalysisResult, LocalServiceState } from '@/features/ai/ai-types';
import type { ObservationEnrichment } from '@/features/ai/ai-repository';
import { buildDroneContext, buildSensorContext, resolveObservationField } from '@/features/observations/observation-context';
import { validGpsFix } from '@/features/drone/drone-status';
import type { ObservationCaptureContext } from '@/features/drone/observation-capture-context';
import { AIImageInputError, OnDeviceAIUnavailableError } from '@/features/ai/ai-types';
import { colors, fontFamilies, spacing } from '@/theme/tokens';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';

type ModelState = 'loading' | 'ready' | 'unavailable' | 'error';
const bundledTestImageUri: string | undefined = undefined;

export default function CropHealthScanRoute() {
  const { scoutingTaskId } = useLocalSearchParams<{ scoutingTaskId?: string }>();
  const language = useLanguage();
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState<string>();
  const [cameraState, setCameraState] = useState<LocalServiceState>(cameraProvider.getState());
  const [cameraDetail, setCameraDetail] = useState('Checking ESP32-CAM…');
  const [modelState, setModelState] = useState<ModelState>('loading');
  const [capturedUri, setCapturedUri] = useState<string>();
  const [capturedAt, setCapturedAt] = useState<string>();
  const [result, setResult] = useState<AIAnalysisResult>();
  const [savedObservation, setSavedObservation] = useState<CropObservation>();
  const [error, setError] = useState<{ title: string; detail: string }>();
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    void appProvider.listFields().then((entries) => { if (active) { setFields(entries); if (entries.length === 1) setFieldId(entries[0].id); } });
    void cameraProvider.checkStatus().then((status) => { if (active) { setCameraState(cameraProvider.getState()); setCameraDetail(status.detail); } });
    // checkHealth is backed by the bundled on-device model; it never contacts the optional server.
    void aiProvider.checkHealth().then((health) => {
      if (active) {
        setModelState(health.available ? 'ready' : 'unavailable');
      }
    }).catch((reason) => {
      if (active) setModelState('error');
    });
    return () => { active = false; };
  }, []));

  const cameraLabel = cameraState === 'connected' ? 'Camera connected' : cameraState === 'connecting' ? 'Connecting' : cameraState === 'unreachable' ? 'Camera unreachable' : 'Not configured';

  const analyzeImage = async (imageUri: string, metadata: AIAnalysisMetadata) => {
    setBusy(true); setError(undefined); setResult(undefined); setSavedObservation(undefined);
    try {
      const analysis = await aiProvider.analyzeImage(imageUri, metadata);
      setResult(analysis);
      if (analysis.imageQuality.status === 'low') await advisoryRepository.recordLowImageQuality({ fieldId: metadata.fieldId, capturedAt: metadata.capturedAt ?? analysis.timestamp, source: metadata.source ?? 'local_image', imageReference: imageUri });
      const enrichment = await collectObservationEnrichment(metadata, analysis.timestamp);
      const captureContext: ObservationCaptureContext = {
        captureSource: metadata.source ?? 'local_image',
        capturedAt: metadata.capturedAt ?? analysis.timestamp,
        imageReference: imageUri,
        droneTelemetry: enrichment.droneTelemetry,
        sensorContext: enrichment.sensorContext,
        location: Number.isFinite(enrichment.latitude) && Number.isFinite(enrichment.longitude) ? { latitude: enrichment.latitude!, longitude: enrichment.longitude! } : undefined,
        locationSource: enrichment.locationSource,
        fieldId: enrichment.fieldId,
        farmId: enrichment.farmId,
      };
      const saved = await aiRepository.saveScan(analysis, metadata, captureContext.imageReference, { ...enrichment, ...captureContext });
      if (saved) {
        setSavedObservation(saved);
        if (saved.flightSessionId && saved.droneId) await droneRepository.associateObservation(saved.flightSessionId, saved.droneId);
        if (scoutingTaskId) await scoutingRepository.completeRescan(scoutingTaskId, saved);
      } else if (scoutingTaskId) await scoutingRepository.markRescanUnusable(scoutingTaskId);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Could not run the on-device crop screening.';
      if (reason instanceof OnDeviceAIUnavailableError) {
        setModelState('unavailable');
        setError({ title: 'On-device AI is unavailable', detail });
      } else if (reason instanceof AIImageInputError) {
        setError({ title: detail.toLowerCase().includes('quality too low') ? 'Image quality too low' : 'Could not read this image', detail });
      } else {
        setModelState('error');
        setError({ title: 'Could not analyze this image', detail });
      }
    } finally { setBusy(false); }
  };

  const captureAndAnalyze = async () => {
    setBusy(true); setError(undefined); setResult(undefined); setSavedObservation(undefined); setCapturedUri(undefined); setCapturedAt(undefined);
    try {
      if (scoutingTaskId) await scoutingRepository.startRescan(scoutingTaskId);
      const capture = await cameraProvider.capture();
      setCapturedUri(capture.imageUri); setCapturedAt(capture.capturedAt); setCameraState('connected'); setCameraDetail('ESP32-CAM is reachable.');
      const metadata: AIAnalysisMetadata = { fieldId, capturedAt: capture.capturedAt, imageBlob: capture.imageBlob, source: 'esp32_cam_rgb' };
      setBusy(false);
      await analyzeImage(capture.imageUri, metadata);
    } catch (reason) {
      if (scoutingTaskId) await scoutingRepository.markRescanUnusable(scoutingTaskId).catch(() => undefined);
      setError({ title: 'Could not capture an image', detail: reason instanceof Error ? reason.message : 'Check the ESP32-CAM connection.' });
      setCameraState(cameraProvider.getState()); setBusy(false);
    }
  };

  const analyzeSample = () => {
    if (!bundledTestImageUri) {
      setError({ title: 'No test image installed', detail: 'Add a real, correctly licensed leaf photo at assets/test/plant-test.jpg to enable this developer action.' });
      return;
    }
    const now = new Date().toISOString();
    setCapturedUri(bundledTestImageUri); setCapturedAt(now);
    void analyzeImage(bundledTestImageUri, { fieldId, capturedAt: now, source: 'local_image' });
  };

  const resultTitle = result?.status === 'possible_issue' ? 'Possible crop-health issue' : result?.status === 'healthy_looking' ? 'Healthy-looking crop' : result?.status === 'uncertain' ? 'AI result is uncertain' : result?.status === 'unavailable' ? result.imageQuality.status === 'low' ? 'Image quality too low' : 'On-device AI is unavailable' : undefined;
  const modelLabel = modelState === 'ready' ? translate(language, 'aiReady') : modelState === 'error' ? translate(language, 'aiError') : translate(language, 'aiUnavailable');

  return <PrithviPage title="Crop health scan" eyebrow="MONITOR · AI SCREENING" subtitle="Review a screening observation. Check the affected area yourself.">
    <Panel style={styles.statusPanel}>
      <View style={styles.stateRow}><Text style={styles.stateLabel}>ESP32-CAM</Text><StatePill label={cameraLabel} tone={cameraState === 'connected' ? 'green' : cameraState === 'unreachable' || cameraState === 'error' ? 'red' : 'amber'} /></View>
      <Text style={styles.detail}>{cameraDetail}</Text>
      <View style={styles.separator} />
      <View style={styles.stateRow}><Text style={styles.stateLabel}>{translate(language, 'aiOnDevice')}</Text>{modelState !== 'loading' ? <StatePill label={modelLabel} tone={modelState === 'ready' ? 'green' : modelState === 'unavailable' ? 'neutral' : 'red'} /> : null}</View>
    </Panel>

    <View>
      <SectionTitle>Field (optional)</SectionTitle>
      {fields.length ? <View style={styles.fieldOptions}><Pressable onPress={() => setFieldId(undefined)} style={[styles.fieldChip, !fieldId && styles.fieldChipSelected]}><Text style={[styles.fieldChipText, !fieldId && styles.fieldChipTextSelected]}>No field</Text></Pressable>{fields.map((field) => <Pressable key={field.id} onPress={() => setFieldId(field.id)} style={[styles.fieldChip, fieldId === field.id && styles.fieldChipSelected]}><Text style={[styles.fieldChipText, fieldId === field.id && styles.fieldChipTextSelected]}>{field.name}</Text></Pressable>)}</View> : <Text style={styles.detail}>Add a field later to link this scan to a place.</Text>}
    </View>

    <PrimaryButton label={busy ? 'Capturing and screening…' : 'Capture & analyze'} onPress={() => { void captureAndAnalyze(); }} disabled={busy} />
    {busy ? <View style={styles.progress}><ActivityIndicator color={colors.green} /><Text style={styles.detail}>Running the crop screening on this device…</Text></View> : null}
    {__DEV__ ? <Pressable accessibilityRole="button" onPress={analyzeSample} style={styles.sampleButton}><Text style={styles.sampleText}>Analyze sample image</Text><Text style={styles.detail}>Development only · same on-device model</Text></Pressable> : null}
    {error ? <EmptyState title={error.title} description={error.detail} label="SCREENING STATUS" /> : null}

    {capturedUri ? <View>
      <SectionTitle>Image</SectionTitle>
      <Image accessibilityLabel="Crop image for AI screening" source={{ uri: capturedUri }} resizeMode="contain" style={styles.preview} />
      <Text style={styles.detail}>{result?.source === 'local_image' || (!capturedAt && bundledTestImageUri) ? 'Local image' : 'ESP32-CAM RGB'}{capturedAt ? ` · ${new Date(capturedAt).toLocaleString()}` : ''}</Text>
    </View> : null}

    {result ? <View>
      <SectionTitle>AI screening</SectionTitle>
      <Panel style={styles.resultPanel}>
        <View style={styles.stateRow}><Text style={styles.resultTitle}>{resultTitle}</Text><StatePill label="AI screening" tone="green" /></View>
        {result.reason ? <Text style={styles.detail}>{result.reason}</Text> : null}
        {typeof result.confidence === 'number' ? <View style={styles.confidence}><Text style={styles.confidenceLabel}>Confidence</Text><Text style={styles.confidenceValue}>{Math.round(result.confidence * 100)}%</Text></View> : null}
        {result.observation ? <Text style={styles.observation}>{result.observation}</Text> : null}
        <Text style={styles.detail}>Crop: {result.crop} · Class: {result.condition}</Text>
        {result.modelVersion ? <Text style={styles.detail}>Model: {result.modelVersion}</Text> : null}
        {result.topAlternatives && result.topAlternatives.length > 1 ? <View style={styles.alternatives}><Text style={styles.confidenceLabel}>Other possible classes</Text>{result.topAlternatives.slice(1).map((item) => <Text key={item.rawLabel} style={styles.detail}>{item.crop} — {item.condition} · {Math.round(item.confidence * 100)}%</Text>)}</View> : null}
        {savedObservation ? <Text style={styles.saved}>Saved in Field Health · field verification recommended</Text> : null}
      </Panel>
      <Text style={styles.disclaimer}>AI screening result — field verification recommended. This PlantVillage model covers 38 trained classes and may be unreliable for unfamiliar crops or field conditions. Inspect the area manually.</Text>
    </View> : null}
  </PrithviPage>;
}

async function collectObservationEnrichment(metadata: AIAnalysisMetadata, observedAt: string): Promise<ObservationEnrichment> {
  await sensorService.start().catch(() => undefined);
  await droneTelemetryProvider.start().catch(() => undefined);
  const captureTime = metadata.capturedAt ?? observedAt;
  const [sensorsResult, readingsResult, telemetryResult, fieldsResult, locationResult] = await Promise.allSettled([
    sensorService.listSensors(), sensorService.latestReadings(), droneRepository.listTelemetry(), appProvider.listFields(), observationLocationProvider.getCurrentFix(),
  ]);
  const sensorContext = sensorsResult.status === 'fulfilled' && readingsResult.status === 'fulfilled'
    ? buildSensorContext(sensorsResult.value, readingsResult.value, captureTime) : undefined;
  const droneContext = telemetryResult.status === 'fulfilled' ? buildDroneContext(telemetryResult.value, captureTime) : undefined;
  const captureTelemetry = telemetryResult.status === 'fulfilled' ? telemetryResult.value
    .filter((item) => item.connectionState === 'connected' && item.source !== 'simulated' && Date.parse(item.receivedAt) <= Date.parse(captureTime) && Date.parse(captureTime) - Date.parse(item.receivedAt) <= 30_000)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] : undefined;
  const droneFix = droneContext?.freshness === 'current' && validGpsFix(droneContext.gpsFix ?? 'unknown') && Number.isFinite(droneContext.latitude) && Number.isFinite(droneContext.longitude)
    ? { latitude: droneContext.latitude!, longitude: droneContext.longitude! } : undefined;
  const locationFix = locationResult.status === 'fulfilled' && locationResult.value && Date.parse(locationResult.value.observedAt) <= Date.parse(captureTime) && Date.parse(captureTime) - Date.parse(locationResult.value.observedAt) <= 30_000 ? locationResult.value : undefined;
  const metadataPoint = Number.isFinite(metadata.latitude) && Number.isFinite(metadata.longitude)
    ? { latitude: metadata.latitude!, longitude: metadata.longitude! } : undefined;
  const location = droneFix ?? locationFix?.point ?? metadataPoint;
  const field = fieldsResult.status === 'fulfilled' ? resolveObservationField(location, fieldsResult.value, metadata.fieldId) : undefined;
  const farmId = field?.farmId ? await appProvider.getFarm(field.farmId).then((farm) => farm?.id).catch(() => undefined) : undefined;
  const activeSession = droneContext ? await droneRepository.getActiveSession() : undefined;
  return {
    droneTelemetry: captureTelemetry,
    fieldId: field?.id ?? metadata.fieldId,
    farmId,
    growthStage: field?.crop?.growthStage,
    latitude: location?.latitude,
    longitude: location?.longitude,
    altitudeM: metadata.altitudeM ?? locationFix?.altitudeM ?? droneContext?.altitudeM,
    headingDegrees: metadata.headingDegrees ?? locationFix?.headingDegrees ?? droneContext?.headingDegrees,
    sensorContext,
    droneContext,
    gpsFix: locationFix?.gpsFix ?? droneContext?.gpsFix,
    locationSource: droneFix ? 'drone' : locationFix?.source ?? (metadataPoint ? 'unknown' : undefined),
    droneTelemetryAt: droneContext?.timestamp,
    droneId: droneContext?.droneId,
    flightSessionId: activeSession && droneContext && activeSession.droneId === droneContext.droneId ? activeSession.id : undefined,
  };
}

const styles = StyleSheet.create({
  statusPanel: { gap: spacing.xs, backgroundColor: colors.surfaceSoft, borderWidth: 0 },
  stateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stateLabel: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 },
  detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19, marginTop: 4 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: spacing.sm },
  fieldOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  fieldChip: { minHeight: 38, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: colors.surface },
  fieldChipSelected: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  fieldChipText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 13 },
  fieldChipTextSelected: { color: colors.green },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sampleButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: spacing.sm },
  sampleText: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 14 },
  preview: { width: '100%', aspectRatio: 1, maxHeight: 330, backgroundColor: colors.surfaceSoft, borderRadius: 20 },
  resultPanel: { gap: spacing.sm, borderWidth: 0, backgroundColor: colors.greenSoft },
  resultTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17, flex: 1 },
  confidence: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  confidenceLabel: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13 },
  confidenceValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16 },
  observation: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, lineHeight: 22 },
  alternatives: { gap: 2, marginTop: spacing.xs },
  saved: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 },
  disclaimer: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
