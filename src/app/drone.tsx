import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, aiRepository, alertService, appProvider, cameraProvider, droneRepository, droneTelemetryProvider, onDeviceAIProvider, scoutingRepository } from '@/data/container';
import type { AIAnalysisResult } from '@/features/ai/ai-types';
import { AIImageInputError, OnDeviceAIUnavailableError } from '@/features/ai/ai-types';
import { DroneInspectionCaptureService, InspectionCameraUnavailableError, InspectionResultInvalidError } from '@/features/drone/inspection-capture-service';
import { evaluateFieldGeofence } from '@/features/scouting/geofence';
import { isTelemetryFresh, telemetryScreenState, validGpsFix } from '@/features/drone/drone-status';
import { isValidGeoPoint } from '@/features/scouting/field-geometry';
import { ScoutingMap } from '@/features/scouting/scouting-map';
import type { CropObservation, Field, FlightSession, MapObservation, ScoutingZone } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

type CaptureError = 'droneCameraUnavailable' | 'droneCameraCaptureFailed' | 'droneImageQualityLow' | 'droneAIUnavailable' | 'droneAnalysisFailed' | 'droneEndError';
type MapState = { observations: MapObservation[]; zones: ScoutingZone[]; track: { latitude: number; longitude: number; timestamp: string }[]; dronePosition?: { latitude: number; longitude: number; heading?: number; altitudeM?: number; timestamp: string }; droneTelemetryState: 'connected' | 'no_gps_fix' | 'stale' | 'disconnected' | 'unavailable' };

export default function DroneRoute() {
  const router = useRouter();
  const { fieldId: requestedFieldId } = useLocalSearchParams<{ fieldId?: string }>();
  const language = useLanguage();
  const t = (key: TranslationKey) => translate(language, key);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState(droneTelemetryProvider.getStatus());
  const [latest, setLatest] = useState<Awaited<ReturnType<typeof droneRepository.getLatestTelemetry>>>();
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState<string | undefined>(requestedFieldId);
  const [session, setSession] = useState<FlightSession>();
  const [lastInspection, setLastInspection] = useState<FlightSession>();
  const [mapData, setMapData] = useState<MapState>();
  const [inspectionObservations, setInspectionObservations] = useState<CropObservation[]>([]);
  const [capture, setCapture] = useState<{ uri: string; result?: AIAnalysisResult }>();
  const [error, setError] = useState<CaptureError>();
  const [notice, setNotice] = useState<TranslationKey>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inspectionCaptureService = useMemo(() => new DroneInspectionCaptureService(
    cameraProvider,
    onDeviceAIProvider,
    droneRepository,
    aiRepository,
    { refreshAdvisories: () => advisoryRepository.refresh(), refreshAlerts: () => alertService.refresh() },
  ), []);

  useFocusEffect(useCallback(() => {
    let active = true;
    let updating = false;
    const refresh = async () => {
      if (updating) return;
      updating = true;
      try {
        const [availableFields, telemetry, activeSession, histories] = await Promise.all([
          appProvider.listFields(), droneRepository.getLatestTelemetry(), droneRepository.getActiveInspectionSession(), droneRepository.listInspectionSessions(),
        ]);
        if (!active) return;
        setFields(availableFields); setLatest(telemetry); setSession(activeSession);
        const completed = histories.find((item) => item.status === 'completed' || item.status === 'interrupted');
        setLastInspection(completed);
        setTelemetrySnapshot(droneTelemetryProvider.getStatus());
        const selectedId = activeSession?.fieldId ?? fieldId;
        if (activeSession?.fieldId) setFieldId(activeSession.fieldId);
        if (selectedId) {
          const [map, points, rows] = await Promise.all([
            scoutingRepository.getMapData(selectedId), activeSession ? droneRepository.getTrack(activeSession.id) : Promise.resolve([]),
            appProvider.listObservations(selectedId),
          ]);
          if (active) {
            const sessionRows = activeSession ? rows.filter((item) => item.flightSessionId === activeSession.id) : [];
            setInspectionObservations(sessionRows);
            const realCurrent = telemetry && telemetry.source !== 'simulated' && telemetry.connectionState === 'connected' && isTelemetryFresh(telemetry) ? telemetry : undefined;
            const position = realCurrent && validGpsFix(realCurrent.gpsFix) && isValidGeoPoint({ latitude: realCurrent.latitude ?? NaN, longitude: realCurrent.longitude ?? NaN })
              ? { latitude: realCurrent.latitude!, longitude: realCurrent.longitude!, heading: realCurrent.headingDegrees ?? undefined, altitudeM: realCurrent.altitudeM ?? undefined, timestamp: realCurrent.receivedAt } : undefined;
            const validTrack = activeSession ? points.filter((item) => isValidGeoPoint(item)).map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp })) : [];
            const nextMap: MapState = { observations: map.observations, zones: map.zones, track: validTrack, dronePosition: position, droneTelemetryState: map.droneTelemetryState };
            setMapData(nextMap);
            const sessionZoneCount = map.zones.filter((zone) => zone.observationIds.some((id) => sessionRows.some((observation) => observation.id === id))).length;
            if (activeSession?.status === 'active') await droneRepository.updateInspectionZoneCount(activeSession.id, sessionZoneCount);
          }
        } else { setMapData(undefined); setInspectionObservations([]); }
        if (active) setLoading(false);
      } catch { if (active) setLoading(false); }
      finally { updating = false; }
    };
    const unsubscribe = droneTelemetryProvider.subscribe((value) => { if (active) { setTelemetrySnapshot(value); void refresh(); } });
    void refresh(); void droneTelemetryProvider.start();
    return () => { active = false; unsubscribe(); droneTelemetryProvider.stop(); };
  }, [fieldId]));

  const telemetry = telemetrySnapshot.telemetry ?? latest;
  const telemetryState = telemetryScreenState(telemetrySnapshot.status, telemetry);
  const connected = telemetryState === 'connected' && telemetry && telemetry.source !== 'simulated' && isTelemetryFresh(telemetry);
  const currentTelemetry = connected ? telemetry : undefined;
  const field = fields.find((item) => item.id === (session?.fieldId ?? fieldId));
  const geofence = session && field && currentTelemetry && validGpsFix(currentTelemetry.gpsFix) && currentTelemetry.latitude !== null && currentTelemetry.longitude !== null
    ? evaluateFieldGeofence(field.boundary, { latitude: currentTelemetry.latitude, longitude: currentTelemetry.longitude }) : 'unknown';
  const droneId = telemetry && telemetry.source !== 'simulated' ? telemetry.droneId : undefined;
  const canStart = !!field && !!droneId && !session;
  const sessionZones = useMemo(() => (mapData?.zones ?? []).filter((zone) => zone.observationIds.some((id) => inspectionObservations.some((item) => item.id === id))), [mapData?.zones, inspectionObservations]);
  const timeline = useMemo(() => [
    ...inspectionObservations.map((item) => ({ id: item.id, at: item.timestamp ?? item.observedAt, title: item.title, detail: [item.crop, item.condition, item.confidence === undefined ? undefined : `${Math.round(item.confidence * 100)}%`].filter(Boolean).join(' · ') })),
    ...sessionZones.map((zone) => ({ id: zone.id, at: zone.updatedAt, title: translate(language, 'alertInspectionTitle'), detail: `${zone.crop ?? ''}${zone.condition ? ` · ${zone.condition}` : ''}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8), [inspectionObservations, sessionZones, language]);

  async function startInspection() {
    if (!field || !droneId || session) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const created = await droneRepository.startInspection(field.id, droneId);
      setSession(created);
      const [map, points] = await Promise.all([scoutingRepository.getMapData(field.id), droneRepository.getTrack(created.id)]);
      setMapData({ observations: map.observations, zones: map.zones, track: points.map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp })), dronePosition: map.dronePosition, droneTelemetryState: map.droneTelemetryState });
    } catch { setError('droneEndError'); }
    finally { setBusy(false); }
  }

  async function endInspection(status: 'completed' | 'interrupted' = 'completed') {
    if (!session || busy) return;
    setBusy(true);
    try {
      await droneRepository.endInspection(session.id, status);
      const histories = await droneRepository.listInspectionSessions();
      setSession(undefined); setLastInspection(histories.find((item) => item.id === session.id));
      setNotice('droneInspectionComplete');
    } catch { setError('droneEndError'); }
    finally { setBusy(false); }
  }

  async function captureImage() {
    if (!session || !field || busy) return;
    setBusy(true); setError(undefined); setNotice(undefined); setCapture(undefined);
    try {
      const outcome = await inspectionCaptureService.capture(field, session, {
        onProgress: () => setNotice('droneCaptureProgress'),
        onCaptured: (image) => setCapture({ uri: image.imageUri }),
      });
      const analysis = outcome.analysis;
      setCapture({ uri: outcome.capture.imageUri, result: analysis });
      setNotice('droneObservationSaved');
      const [updatedSession, map] = await Promise.all([droneRepository.getActiveInspectionSession(), scoutingRepository.getMapData(field.id)]);
      const points = await droneRepository.getTrack(session.id);
      setSession(updatedSession);
      setMapData({ observations: map.observations, zones: map.zones, track: points.map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp })), dronePosition: map.dronePosition, droneTelemetryState: map.droneTelemetryState });
      const rows = await appProvider.listObservations(field.id);
      setInspectionObservations(rows.filter((item) => item.flightSessionId === session.id));
      await droneRepository.updateInspectionZoneCount(session.id, map.zones.filter((zone) => zone.observationIds.some((id) => rows.some((item) => item.id === id && item.flightSessionId === session.id))).length);
    } catch (reason) {
      if (reason instanceof InspectionCameraUnavailableError) setError('droneCameraUnavailable');
      else if (reason instanceof InspectionResultInvalidError) setError('droneAnalysisFailed');
      else if (reason instanceof AIImageInputError) setError(reason.message.toLowerCase().includes('quality too low') ? 'droneImageQualityLow' : 'droneAnalysisFailed');
      else if (reason instanceof OnDeviceAIUnavailableError) setError('droneAIUnavailable');
      else setError('droneCameraCaptureFailed');
    } finally { setBusy(false); }
  }

  async function requestCloserInspection(zone: ScoutingZone) {
    if (!field) return;
    try { await scoutingRepository.requestTargetedRescan(field.id, zone.id, zone.observationIds); setNotice('droneRequestSaved'); const map = await scoutingRepository.getMapData(field.id); setMapData((old) => old ? { ...old, zones: map.zones } : old); }
    catch { setError('droneEndError'); }
  }

  const connectionLabel = telemetryState === 'connected' ? t('droneConnectionConnected') : telemetryState === 'connecting' ? t('droneConnectionConnecting') : telemetryState === 'stale' ? t('droneConnectionStale') : t('droneConnectionDisconnected');
  const gpsLabel = currentTelemetry ? t(gpsTranslationKey(currentTelemetry.gpsFix)) : t('droneGpsUnavailable');
  const boundaryMessage = !field ? undefined : !field.boundary?.length ? t('droneBoundaryMissing') : t('droneBoundaryReady');
  const geoLabel = geofence === 'inside' ? t('droneInsideField') : geofence === 'outside' ? t('droneOutsideField') : t('droneFieldPositionUnavailable');
  const completed = !session ? lastInspection : undefined;

  return <PrithviPage title={t('droneInspection')} eyebrow={t('droneTelemetryStatus')} subtitle={t('droneInspectionIntro')}>
    <Panel style={styles.statusPanel}>
      <View style={styles.row}><Text style={styles.panelTitle}>{t('droneConnection')}</Text><StatePill label={connectionLabel} tone={currentTelemetry ? 'green' : 'amber'} /></View>
      <Text style={styles.detail}>{currentTelemetry ? telemetrySnapshot.detail ?? t('droneConnectionConnected') : t('droneTelemetryUnavailable')}</Text>
      {session ? <StatePill label={t('droneInspectionActive')} tone="green" /> : null}
    </Panel>

    {!session && fields.length ? <View><SectionTitle>{t('droneSelectField')}</SectionTitle><View style={styles.fieldOptions}>{fields.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: fieldId === item.id }} onPress={() => setFieldId(item.id)} style={[styles.fieldChip, fieldId === item.id && styles.fieldChipSelected]}><Text style={[styles.fieldText, fieldId === item.id && styles.fieldTextSelected]}>{item.name}</Text></Pressable>)}</View></View> : null}
    {!fields.length && !session ? <EmptyState title={t('droneNoFields')} description={t('droneFieldRequired')} /> : null}
    {field ? <Panel style={styles.fieldPanel}><Text style={styles.panelTitle}>{field.name}</Text><Text style={styles.detail}>{boundaryMessage}</Text></Panel> : null}

    {currentTelemetry ? <>
      <Panel style={styles.gpsPanel}>
        <View style={styles.row}><View><Text style={styles.caption}>{t('droneGps')}</Text><Text style={styles.bigValue}>{gpsLabel}</Text></View><Text style={styles.satellites}>{currentTelemetry.satellites === null ? t('droneUnavailable') : `${currentTelemetry.satellites} ${t('droneSatellites')}`}</Text></View>
        {session ? <Text style={styles.detail}>{geoLabel}</Text> : null}
      </Panel>
      <SectionTitle>{t('droneFlightMode')}</SectionTitle>
      <View style={styles.metrics}>
        <Metric label={t('droneAltitude')} value={measurement(currentTelemetry.altitudeM, 'm', t('droneUnavailable'))} />
        <Metric label={t('droneSpeed')} value={measurement(currentTelemetry.speedMps, 'm/s', t('droneUnavailable'))} />
        <Metric label={t('droneHeading')} value={measurement(currentTelemetry.headingDegrees, '°', t('droneUnavailable'))} />
        <Metric label={t('droneBattery')} value={measurement(currentTelemetry.batteryPercent, '%', t('droneUnavailable'))} />
        <Metric label={t('droneFlightMode')} value={currentTelemetry.flightMode ?? t('droneUnavailable')} />
      </View>
    </> : <Panel style={styles.unavailablePanel}><Text style={styles.panelTitle}>{t('droneTelemetryUnavailable')}</Text><Text style={styles.detail}>{t('droneGpsUnavailable')}</Text></Panel>}

    {session ? <>
      <View style={styles.counts}><Metric label={t('droneObservationsFound')} value={String(session.observationCount)} /><Metric label={t('droneInspectionZones')} value={String(sessionZones.length)} /></View>
      <PrimaryButton label={busy ? t('droneCaptureProgress') : t('droneCaptureImage')} onPress={() => { void captureImage(); }} disabled={busy} />
      {capture?.uri ? <Image accessibilityLabel={t('droneCaptureImage')} source={{ uri: capture.uri }} resizeMode="contain" style={styles.preview} /> : null}
      {capture?.result ? <Panel style={styles.resultPanel}><Text style={styles.panelTitle}>{resultTitle(capture.result.status, t)}</Text><Text style={styles.detail}>{capture.result.crop} · {capture.result.condition}</Text><Text style={styles.detail}>{t('photoConfidence')}: {Math.round((capture.result.confidence ?? 0) * 100)}%</Text><Text style={styles.detail}>{t('photoModelVersion')}: {capture.result.modelVersion}</Text><Text style={styles.detail}>{t('droneNeedsVerification')}</Text></Panel> : null}
      {error ? <EmptyState title={t(error)} description={error === 'droneImageQualityLow' ? t('droneCaptureAnother') : t('droneCameraCaptureFailed')} /> : null}
      {notice ? <Text style={styles.notice}>{t(notice)}</Text> : null}
      {field && mapData ? <View><SectionTitle>{t('droneCurrentPosition')}</SectionTitle><ScoutingMap data={{ boundary: field.boundary, observations: mapData.observations, zones: mapData.zones, track: mapData.track, dronePosition: mapData.dronePosition, droneTelemetryState: mapData.droneTelemetryState }} onObservationPress={(id) => router.push({ pathname: '/observations/[observationId]', params: { observationId: id } })} onZonePress={(id) => router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: id } })} onDronePress={() => undefined} /></View> : null}
      {sessionZones.filter((zone) => ['inspection_suggested', 'needs_verification'].includes(zone.status)).map((zone) => <Panel key={zone.id} style={styles.zonePanel}><View style={styles.row}><Text style={styles.panelTitle}>{t('alertInspectionTitle')}</Text><StatePill label={t('droneNeedsVerification')} tone="amber" /></View><Text style={styles.detail}>{zone.crop ?? ''}{zone.condition ? ` · ${zone.condition}` : ''}</Text><Pressable accessibilityRole="button" onPress={() => { void requestCloserInspection(zone); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t('droneRequestCloserInspection')}</Text></Pressable></Panel>)}
      <PrimaryButton label={t('droneEnd')} onPress={() => { void endInspection('completed'); }} disabled={busy} />
    </> : <PrimaryButton label={t('droneStart')} onPress={() => { void startInspection(); }} disabled={!canStart || busy} />}

    {completed ? <View><SectionTitle>{t('droneInspectionSummary')}</SectionTitle><Panel style={styles.summaryPanel}><StatePill label={t(completed.status === 'interrupted' ? 'droneTelemetryUnavailable' : 'droneInspectionComplete')} tone={completed.status === 'interrupted' ? 'amber' : 'green'} /><SummaryLine label={t('droneField')} value={fields.find((item) => item.id === completed.fieldId)?.name ?? t('droneUnavailable')} /><SummaryLine label={t('droneDuration')} value={formatDuration(completed.startedAt, completed.endedAt ?? completed.startedAt, language === 'hi')} /><SummaryLine label={t('droneImagesCaptured')} value={String(completed.imageCount ?? 0)} /><SummaryLine label={t('droneObservationsFound')} value={String(completed.observationCount)} /><SummaryLine label={t('droneInspectionZones')} value={String(completed.zoneCount ?? 0)} /></Panel></View> : null}

    {session ? <View><SectionTitle>{t('droneRecentActivity')}</SectionTitle>{timeline.length ? timeline.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => item.id.startsWith('zone-') ? router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: item.id } }) : router.push({ pathname: '/observations/[observationId]', params: { observationId: item.id } })} style={styles.timelineRow}><View style={styles.timelineDot} /><View style={styles.timelineCopy}><Text style={styles.time}>{formatTime(item.at, language === 'hi')}</Text><Text style={styles.panelTitle}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View><Text style={styles.chevron}>›</Text></Pressable>) : <EmptyState title={t('droneNoTimeline')} description={t('droneCaptureImage')} />}</View> : null}

    {!currentTelemetry && telemetryState === 'stale' ? <Text style={styles.staleNote}>{t('droneTelemetryUnavailable')}</Text> : null}
    {loading ? <View style={styles.loading}><ActivityIndicator color={colors.green} /></View> : null}
    <Text style={styles.footer}>{t('droneReadOnlyNote')}</Text>
  </PrithviPage>;
}

function resultTitle(status: AIAnalysisResult['status'], t: (key: TranslationKey) => string) { return status === 'healthy_looking' ? t('droneHealthy') : status === 'possible_issue' ? t('dronePossibleIssue') : t('droneUncertain'); }
function gpsTranslationKey(value: string): TranslationKey { return value === 'no_fix' ? 'droneGpsNoFix' : value === '2d' ? 'droneGps2d' : value === '3d' ? 'droneGps3d' : value === 'dgps' ? 'droneGpsDgps' : value === 'rtk_float' ? 'droneGpsRtkFloat' : value === 'rtk_fixed' ? 'droneGpsRtkFixed' : 'droneGpsUnavailable'; }
function measurement(value: number | null, unit: string, unavailable: string) { return Number.isFinite(value) ? `${Number(value).toFixed(unit === 'm/s' ? 1 : 0)} ${unit}` : unavailable; }
function formatTime(value: string, hindi: boolean) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(hindi ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function formatDuration(start: string, end: string, hindi: boolean) { const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000)); return hindi ? `${minutes} मिनट` : `${minutes} min`; }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.caption}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
function SummaryLine({ label, value }: { label: string; value: string }) { return <View style={styles.summaryLine}><Text style={styles.detail}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  statusPanel: { gap: spacing.sm, backgroundColor: colors.surfaceSoft, borderWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, panelTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 15 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 19 },
  fieldOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, fieldChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, fieldChipSelected: { backgroundColor: colors.greenSoft, borderColor: colors.green }, fieldText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 14 }, fieldTextSelected: { color: colors.green }, fieldPanel: { gap: spacing.xs, backgroundColor: colors.surfaceSoft, borderWidth: 0 },
  gpsPanel: { backgroundColor: colors.greenSoft, borderWidth: 0 }, caption: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12 }, bigValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 19, marginTop: 3 }, satellites: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, flexBasis: '46%', minHeight: 68, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 16 }, value: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15, marginTop: 4 }, unavailablePanel: { gap: spacing.xs, backgroundColor: colors.surfaceSoft, borderWidth: 0 },
  counts: { flexDirection: 'row', gap: spacing.sm }, resultPanel: { gap: spacing.xs, borderWidth: 0, backgroundColor: colors.greenSoft }, preview: { width: '100%', height: 250, borderRadius: 18, backgroundColor: colors.surfaceSoft }, notice: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13 }, zonePanel: { gap: spacing.xs, backgroundColor: colors.amberSoft, borderWidth: 0 }, secondaryButton: { minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, marginTop: spacing.xs }, secondaryText: { color: colors.amber, fontFamily: fontFamilies.medium, fontSize: 13 },
  summaryPanel: { gap: spacing.sm, backgroundColor: colors.greenSoft, borderWidth: 0 }, summaryLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, summaryValue: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, timelineRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingVertical: spacing.sm }, timelineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.green }, timelineCopy: { flex: 1, gap: 2 }, time: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, chevron: { color: colors.muted, fontSize: 20 }, staleNote: { color: colors.amber, fontFamily: fontFamilies.body, fontSize: 12 }, loading: { padding: spacing.md, alignItems: 'center' }, footer: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
