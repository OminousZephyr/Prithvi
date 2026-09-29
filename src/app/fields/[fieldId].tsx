import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill, TextField } from '@/components/ui/prithvi-page';
import { advisoryRepository, appProvider, droneTelemetryProvider, scoutingRepository, sensorService } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import type { Advisory, CropObservation, Field, GeoPoint, MapObservation, ScoutingTask, ScoutingZone, Sensor, SensorCalibration, SensorConnection, SensorNode, SensorReading } from '@/domain/models';
import { boundaryCenter, isValidGeoPoint, isValidFieldBoundary, normalizeFieldGeometry } from '@/features/scouting/field-geometry';
import { evaluateFieldGeofence } from '@/features/scouting/geofence';
import { summarizeFieldHealth } from '@/features/scouting/scouting-repository';
import { ScoutingMap } from '@/features/scouting/scouting-map';
import { colors, fontFamilies, spacing } from '@/theme/tokens';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { WeatherSummaryCard } from '@/features/weather/weather-summary-card';
import { buildSensorGrid, mergeSensorReadings } from '@/features/sensors/presentation/sensor-presentation';
import { buildSensorAlerts, interpretSensorValue } from '@/features/sensors/presentation/sensor-interpretation';

export default function FieldDetailsRoute() {
  const { fieldId } = useLocalSearchParams<{ fieldId: string }>();
  const router = useRouter();
  const language = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [field, setField] = useState<Field>();
  const [observations, setObservations] = useState<CropObservation[]>([]);
  const [mapData, setMapData] = useState<{ observations: MapObservation[]; zones: ScoutingZone[]; track: { latitude: number; longitude: number; timestamp: string }[]; dronePosition?: { latitude: number; longitude: number; heading?: number; altitudeM?: number; timestamp: string }; droneTelemetryState: 'connected' | 'no_gps_fix' | 'stale' | 'disconnected' | 'unavailable'; session?: { id: string; droneId: string; startedAt: string; endedAt: string | null; status: string; telemetryCount: number; observationCount: number; syncState: string } }>();
  const [zones, setZones] = useState<ScoutingZone[]>([]);
  const [tasks, setTasks] = useState<ScoutingTask[]>([]);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [fieldSensors, setFieldSensors] = useState<Sensor[]>([]);
  const [sensorReadings, setSensorReadings] = useState<SensorReading[]>([]);
  const [sensorCalibrations, setSensorCalibrations] = useState<Record<string, SensorCalibration | undefined>>({});
  const [sensorConnection, setSensorConnection] = useState<SensorConnection>(sensorService.getConnection());
  const [filterDate, setFilterDate] = useState<'all' | '7d' | '30d'>('all');
  const [filterCrop, setFilterCrop] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSource, setFilterSource] = useState('All');
  const [savedTask, setSavedTask] = useState(false);
  const [now, setNow] = useState(0);
  const [failed, setFailed] = useState(false);
  const [drawingBoundary, setDrawingBoundary] = useState(false);
  const [draftBoundary, setDraftBoundary] = useState<GeoPoint[]>([]);
  const [boundaryClosed, setBoundaryClosed] = useState(false);
  const [seedLatitude, setSeedLatitude] = useState('');
  const [seedLongitude, setSeedLongitude] = useState('');
  const [pointLatitude, setPointLatitude] = useState('');
  const [pointLongitude, setPointLongitude] = useState('');
  const [boundaryError, setBoundaryError] = useState('');
  const [boundarySaved, setBoundarySaved] = useState(false);
  const [positionsExpanded, setPositionsExpanded] = useState(false);
  const [placingSensorId, setPlacingSensorId] = useState<string>();
  const [mapLayers, setMapLayers] = useState({ sensors: true, observations: true, drone: true });
  useFocusEffect(useCallback(() => {
    let active = true;
    let sensorRefreshInFlight = false;
    let sensorRefreshQueued = false;
    let linkedSensorIds = new Set<string>();
    setNow(Date.now());
    const refreshSensorReadings = async () => {
      if (sensorRefreshInFlight) { sensorRefreshQueued = true; return; }
      sensorRefreshInFlight = true;
      try {
        do {
          sensorRefreshQueued = false;
          const latest = await sensorService.latestReadings();
          if (!active) return;
          const fieldReadings = latest.filter((reading) => linkedSensorIds.has(reading.sensorId));
          setSensorReadings((previous) => mergeSensorReadings(previous, fieldReadings));
          setNow(Date.now());
        } while (sensorRefreshQueued);
      } catch { /* Preserve the last real values and let their age state change naturally. */ }
      finally { sensorRefreshInFlight = false; }
    };
    const refresh = async () => {
      const [record, rows, map, fieldTasks, fieldAdvisories, nodes, sensors] = await Promise.all([appProvider.getField(fieldId), appProvider.listObservations(fieldId), scoutingRepository.getMapData(fieldId), scoutingRepository.listTasks(fieldId), advisoryRepository.refresh().then((entries) => entries.filter((item) => item.fieldId === fieldId)), appProvider.listNodes(), appProvider.listSensors()]);
      if (!active) return;
      setNow(Date.now());
      setField(record ? normalizeFieldGeometry(record) : undefined); setObservations(rows); setMapData(map); setZones(map.zones); setTasks(fieldTasks); setAdvisories(fieldAdvisories);
      const linkedNodes = (nodes as SensorNode[]).filter((node) => node.fieldId === fieldId || record?.sensorNodeIds.includes(node.id));
      const linkedSensors = (sensors as Sensor[]).filter((sensor) => linkedNodes.some((node) => node.id === sensor.nodeId));
      linkedSensorIds = new Set(linkedSensors.map((sensor) => sensor.id));
      setFieldSensors(linkedSensors);
      const readings = await sensorService.history(undefined, Math.max(200, linkedSensors.length * 8));
      if (!active) return;
      setSensorReadings((previous) => mergeSensorReadings(previous, readings.filter((reading) => linkedSensorIds.has(reading.sensorId))));
      setSensorCalibrations(Object.fromEntries(await Promise.all(linkedSensors.map(async (sensor) => [sensor.id, await sensorService.getCalibration(sensor.id)] as const))));
    };
    void refresh().catch(() => { if (active) setFailed(true); });
    const refreshDroneMap = async () => { try { const map = await scoutingRepository.getMapData(fieldId); if (active) { setMapData(map); setZones(map.zones); } } catch { /* Keep the last saved map and track visible. */ } };
    const unsubscribe = droneTelemetryProvider.subscribe(() => { void refreshDroneMap(); });
    const unsubscribeSensors = sensorService.subscribe(() => { setSensorConnection(sensorService.getConnection()); void refreshSensorReadings(); });
    void sensorService.start().then((state) => { if (active) setSensorConnection(state); });
    void droneTelemetryProvider.start();
    return () => { active = false; unsubscribe(); unsubscribeSensors(); droneTelemetryProvider.stop(); };
  }, [fieldId]));

  if (!field) return <PrithviPage title="Field details" eyebrow="Field record">{failed ? <EmptyState title="Field data unavailable" description="The local field record could not be opened." label="STORAGE ISSUE" /> : <EmptyState title="Loading field record" description="Opening this device's local record." label="LOCAL DATA" />}</PrithviPage>;
  const health = summarizeFieldHealth(observations, zones, tasks);
  const dateCutoff = filterDate === 'all' || !now ? 0 : now - (filterDate === '7d' ? 7 : 30) * 86_400_000;
  const history = observations.filter((item) => Date.parse(item.timestamp ?? item.observedAt) >= dateCutoff)
    .filter((item) => filterCrop === 'All' || item.crop === filterCrop)
    .filter((item) => filterStatus === 'All' || item.scanStatus === filterStatus || item.verificationStatus === filterStatus)
    .filter((item) => filterSource === 'All' || item.source === (filterSource === t('photoManualSource') ? 'manual_photo' : filterSource));
  const cropFilters = ['All', ...new Set(observations.flatMap((item) => item.crop ? [item.crop] : []))];
  const statusFilters = ['All', 'possible_issue', 'healthy_looking', 'uncertain', 'requires_verification', 'verified', 'dismissed'];
  const sourceFilters = ['All', ...new Set(observations.map((item) => item.source === 'manual_photo' ? t('photoManualSource') : item.source))];
  const requestRescan = async (zone: ScoutingZone) => { const task = await scoutingRepository.requestTargetedRescan(field.id, zone.id, zone.observationIds); setTasks(await scoutingRepository.listTasks(field.id)); setZones(await scoutingRepository.getZones(field.id)); setSavedTask(task.status === 'rescan_requested' || task.status === 'targeted_rescan_requested'); };
  const assignSensorPosition = async (sensorId: string, position: string) => {
    const sensor = fieldSensors.find((item) => item.id === sensorId); if (!sensor) return;
    const updated = { ...sensor, zonePosition: position };
    await localStore.save('sensor', updated);
    const history = await localStore.list<SensorReading>('sensor-reading');
    await Promise.all(history.filter((reading) => reading.sensorId === sensorId).map((reading) => localStore.save('sensor-reading', { ...reading, fieldId, zonePosition: position })));
    setFieldSensors((items) => items.map((item) => item.id === sensorId ? updated : item));
  };
  const saveSensorCoordinates = async (point: GeoPoint) => {
    const sensor = fieldSensors.find((item) => item.id === placingSensorId); if (!sensor) return;
    const updated = { ...sensor, coordinates: point };
    await localStore.save('sensor', updated); setFieldSensors((items) => items.map((item) => item.id === sensor.id ? updated : item)); setPlacingSensorId(undefined);
  };
  const addBoundaryPoint = (point: GeoPoint) => {
    if (!isValidGeoPoint(point)) { setBoundaryError(t('boundaryInvalidPoint')); return; }
    setDraftBoundary((current) => [...current, point]); setBoundaryClosed(false); setBoundaryError(''); setBoundarySaved(false);
  };
  const openBoundaryEditor = () => {
    setDraftBoundary(field.boundary ? [...field.boundary] : []); setBoundaryClosed(false); setBoundaryError(''); setBoundarySaved(false); setDrawingBoundary(true);
    const center = field.center ?? boundaryCenter(field.boundary ?? []);
    setSeedLatitude(center ? String(center.latitude) : ''); setSeedLongitude(center ? String(center.longitude) : '');
  };
  const addManualBoundaryPoint = () => {
    const latitude = Number(pointLatitude); const longitude = Number(pointLongitude);
    const point = { latitude, longitude };
    if (!pointLatitude.trim() || !pointLongitude.trim() || !isValidGeoPoint(point)) { setBoundaryError(t('boundaryInvalidPoint')); return; }
    addBoundaryPoint(point); setPointLatitude(''); setPointLongitude('');
  };
  const closeBoundary = () => {
    if (draftBoundary.length < 3) { setBoundaryError(t('boundaryNeedThreePoints')); return; }
    if (!isValidFieldBoundary(draftBoundary)) { setBoundaryError(t('boundaryInvalidPolygon')); return; }
    setBoundaryClosed(true); setBoundaryError('');
  };
  const saveBoundary = async () => {
    if (!boundaryClosed || !isValidFieldBoundary(draftBoundary)) { closeBoundary(); return; }
    const updated = normalizeFieldGeometry({ ...field, boundary: [...draftBoundary], center: undefined, area: undefined });
    try { await localStore.save('field', updated); setField(updated); setDrawingBoundary(false); setBoundarySaved(true); setBoundaryError(''); }
    catch { setBoundaryError(t('boundarySaveError')); }
  };
  const mappedSeed = mapData?.dronePosition ?? mapData?.observations[0] ?? mapData?.track[0];
  const seedCenter = draftBoundary.length ? boundaryCenter(draftBoundary) ?? draftBoundary[0] : field.center ?? mappedSeed ?? validSeed(seedLatitude, seedLongitude);
  const geofence = evaluateFieldGeofence(field.boundary, mapData?.dronePosition);
  const sensorCards = buildSensorGrid(sensorReadings, fieldSensors, sensorConnection);
  const sensorAlerts = buildSensorAlerts(sensorReadings, fieldSensors, sensorConnection.status, now, sensorCalibrations);
  const sensorGroups = sensorCards.reduce((groups, card, index) => { const zone = card.position ?? t('sensorPositionNotAdded'); const group = groups.get(zone) ?? []; group.push({ card, index }); groups.set(zone, group); return groups; }, new Map<string, { card: ReturnType<typeof buildSensorGrid>[number]; index: number }[]>());
  const sensorLocations = fieldSensors.flatMap((sensor) => sensor.coordinates ? [{ sensorId: sensor.id, ...sensor.coordinates, zonePosition: sensor.zonePosition }] : []);
  const hasMapData = isValidFieldBoundary(field.boundary) || Boolean(field.center || mapData?.observations.length || mapData?.zones.length || mapData?.track.length || mapData?.dronePosition) || sensorLocations.length > 0;
  return <PrithviPage title={field.name} eyebrow="FIELD OVERVIEW" subtitle={[field.crop?.name, field.area ? `${field.area.value} ${field.area.unit}` : undefined].filter(Boolean).join(' · ') || 'Add crop, map and devices whenever you are ready'}>
    <Panel><View style={styles.heading}><Text style={styles.crop}>{field.crop?.name ?? 'Crop not added yet'}</Text></View>{field.crop?.variety || field.crop?.growthStage ? <Text style={styles.detail}>{[field.crop.variety, field.crop.growthStage].filter(Boolean).join(' · ')}</Text> : null}</Panel>
    <View><SectionTitle>{t('fieldDevices')}</SectionTitle><Panel style={styles.devicePanel}><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/connect-field-hub', params: { fieldId: field.id } })} style={styles.deviceRow}><View style={styles.deviceCopy}><Text style={styles.crop}>{t('sensorFieldHub')}</Text><Text style={styles.detail}>{fieldSensors.length ? t('hubSensorsDetected').replace('{count}', String(fieldSensors.length)) : t('deviceNoSensors')}</Text></View><StatePill label={sensorConnection.status === 'connected' && fieldSensors.length ? t('deviceConnected') : t('deviceNotConnected')} tone={sensorConnection.status === 'connected' && fieldSensors.length ? 'green' : 'neutral'} /></Pressable><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/drone', params: { fieldId: field.id } })} style={styles.deviceRow}><View style={styles.deviceCopy}><Text style={styles.crop}>{t('droneInspectionSimple')}</Text><Text style={styles.detail}>{mapData?.droneTelemetryState === 'connected' ? t('droneGpsReady') : t('deviceNotConnected')}</Text></View><StatePill label={mapData?.droneTelemetryState === 'connected' ? t('deviceConnected') : t('deviceNotConnected')} tone={mapData?.droneTelemetryState === 'connected' ? 'green' : 'neutral'} /></Pressable><View style={styles.quickActions}><QuickAction label={t('fieldQuickScan')} onPress={() => router.push({ pathname: '/crop-health-scan', params: { fieldId: field.id } })} /><QuickAction label={t('fieldQuickMap')} onPress={() => router.push('/scouting')} /><QuickAction label={t('fieldQuickAlerts')} onPress={() => router.push('/alerts')} /></View></Panel></View>
    <View><SectionTitle>{t('fieldHealthSummary')}</SectionTitle><Panel style={styles.healthGrid}><HealthCount label={t('fieldHealthyLooking')} value={health.healthyLookingCount} /><HealthCount label={t('fieldPossibleIssues')} value={health.possibleIssueCount} /><HealthCount label={t('fieldInspectionZones')} value={health.inspectionAreaCount} /><HealthCount label={t('fieldPendingRescans')} value={health.pendingRescanCount} /></Panel></View>
    <WeatherSummaryCard field={field} />
    <View><SectionTitle>Latest field observation</SectionTitle>{observations.length ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/observations/[observationId]', params: { observationId: observations[0].id } })}><Panel><View style={styles.heading}><Text style={styles.crop}>{observations[0].title}</Text><StatePill label={verificationLabel(observations[0])} tone={observations[0].verificationStatus === 'verified' ? 'green' : 'amber'} /></View><Text style={styles.detail}>{observations[0].crop ?? 'Crop not recorded'}{observations[0].condition ? ` · ${observations[0].condition}` : ''} · {new Date(observations[0].timestamp ?? observations[0].observedAt).toLocaleString()}</Text></Panel></Pressable> : <EmptyState title="Not assessed" description="No crop-health observation has been recorded for this field." label="NO OBSERVATIONS" />}</View>
    <Pressable accessibilityRole="button" onPress={() => router.push('/advisory')}><Panel><View style={styles.heading}><Text style={styles.crop}>Advisory summary</Text><Text style={styles.arrow}>›</Text></View><Text style={styles.detail}>Needs attention: {advisories.filter((item) => ['active', 'acknowledged'].includes(item.status) && item.priority !== 'low').length} · Monitoring: {advisories.filter((item) => ['active', 'acknowledged'].includes(item.status) && item.priority === 'low').length}</Text></Panel></Pressable>
    <View><SectionTitle action={<Pressable accessibilityRole="button" onPress={drawingBoundary ? () => { setDrawingBoundary(false); setBoundaryError(''); } : openBoundaryEditor} style={styles.inlineAction}><Text style={styles.inlineActionText}>{t(drawingBoundary ? 'cancelBoundary' : 'drawBoundary')}</Text></Pressable>}>{t('fieldBoundary')}</SectionTitle>
      {drawingBoundary ? <Panel style={styles.boundaryPanel}>
        {!seedCenter ? <><Text style={styles.detail}>{t('boundaryNeedCenter')}</Text><TextField label={t('boundaryStartLatitude')} value={seedLatitude} onChangeText={setSeedLatitude} keyboardType="numbers-and-punctuation" /><TextField label={t('boundaryStartLongitude')} value={seedLongitude} onChangeText={setSeedLongitude} keyboardType="numbers-and-punctuation" /></> : null}
        <Text style={styles.detail}>{t('boundaryPointsCount')}: {draftBoundary.length}</Text>
        <ScoutingMap data={{ boundary: undefined, draftPoints: draftBoundary, drawingBoundary: !boundaryClosed, seedCenter, observations: [], zones: [], track: [] }} onObservationPress={(id) => router.push({ pathname: '/observations/[observationId]', params: { observationId: id } })} onZonePress={(id) => router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: id } })} onDronePress={() => router.push('/drone')} onBoundaryPointPress={addBoundaryPoint} />
        <View style={styles.coordinateRow}><View style={styles.coordinateInput}><TextField label={t('boundaryLatitude')} value={pointLatitude} onChangeText={setPointLatitude} keyboardType="numbers-and-punctuation" /></View><View style={styles.coordinateInput}><TextField label={t('boundaryLongitude')} value={pointLongitude} onChangeText={setPointLongitude} keyboardType="numbers-and-punctuation" /></View></View>
        <PrimaryButton label={t('addBoundaryPoint')} onPress={addManualBoundaryPoint} />
        <View style={styles.boundaryActions}><SmallAction title={t('undoBoundaryPoint')} disabled={!draftBoundary.length} onPress={() => { setDraftBoundary((points) => points.slice(0, -1)); setBoundaryClosed(false); }} /><SmallAction title={t('clearBoundaryPoints')} disabled={!draftBoundary.length} onPress={() => { setDraftBoundary([]); setBoundaryClosed(false); }} /></View>
        <SmallAction title={t(boundaryClosed ? 'polygonClosed' : 'closePolygon')} disabled={boundaryClosed} onPress={closeBoundary} />
        {boundaryError ? <Text accessibilityRole="alert" style={styles.boundaryError}>{boundaryError}</Text> : null}
        <PrimaryButton label={t('saveBoundary')} disabled={!boundaryClosed} onPress={() => { void saveBoundary(); }} />
      </Panel> : <>
        {hasMapData ? <><View style={mapStyles.mapLayers}><LayerToggle label={t('mapLayerSensors')} selected={mapLayers.sensors} onPress={() => setMapLayers((value) => ({ ...value, sensors: !value.sensors }))} /><LayerToggle label={t('mapLayerObservations')} selected={mapLayers.observations} onPress={() => setMapLayers((value) => ({ ...value, observations: !value.observations }))} /><LayerToggle label={t('mapLayerDrone')} selected={mapLayers.drone} onPress={() => setMapLayers((value) => ({ ...value, drone: !value.drone }))} /></View>{placingSensorId ? <Text style={styles.detail}>{t('placeSensorMapHelp')}</Text> : null}<ScoutingMap data={{ boundary: field.boundary, seedCenter: field.center, observations: mapLayers.observations ? mapData?.observations ?? [] : [], zones: mapLayers.observations ? mapData?.zones ?? [] : [], sensorLocations: mapLayers.sensors ? sensorLocations : [], placingSensorId, track: mapLayers.drone ? mapData?.track ?? [] : [], dronePosition: mapLayers.drone ? mapData?.dronePosition : undefined, droneTelemetryState: mapData?.droneTelemetryState }} onObservationPress={(id) => router.push({ pathname: '/observations/[observationId]', params: { observationId: id } })} onZonePress={(id) => router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: id } })} onSensorPress={(id) => router.push({ pathname: '/sensors', params: { sensorId: id } })} onSensorLocationPress={(point) => { void saveSensorCoordinates(point); }} onDronePress={() => router.push({ pathname: '/drone', params: { fieldId: field.id } })} />{sensorLocations.length ? <Text style={styles.detail}>{t('mapSensorMarkerHelp')}</Text> : null}</> : <EmptyState title={t('noMapData')} description={t('mapNeedBoundaryOrObservation')} label="MAP DATA UNAVAILABLE" />}
        {mapData?.droneTelemetryState ? <Panel style={styles.geofencePanel}><View style={styles.heading}><Text style={styles.crop}>{t('droneGeofence')}</Text><StatePill label={t(geofence === 'inside' ? 'droneInsideField' : geofence === 'outside' ? 'droneOutsideField' : 'fieldPositionUnavailable')} tone={geofence === 'inside' ? 'green' : geofence === 'outside' ? 'amber' : 'neutral'} /></View></Panel> : null}
      </>}
      {boundarySaved ? <Text style={styles.boundarySaved}>{t('boundarySaved')}</Text> : null}
    </View>
    {mapData?.dronePosition ? <Panel><Text style={styles.crop}>Drone position · live</Text><Text style={styles.detail}>{mapData.dronePosition.latitude.toFixed(6)}, {mapData.dronePosition.longitude.toFixed(6)} · {mapData.dronePosition.altitudeM === undefined ? 'Altitude unavailable' : `${mapData.dronePosition.altitudeM} m`} · {mapData.dronePosition.heading === undefined ? 'Heading unavailable' : `${mapData.dronePosition.heading}°`}</Text></Panel> : null}
    <View><SectionTitle>Scouting zones</SectionTitle>{zones.length ? zones.map((zone) => { const task = tasks.find((item) => item.zoneId === zone.id && ['rescan_requested', 'rescan_in_progress', 'targeted_rescan_requested'].includes(item.status)); return <Panel key={zone.id} style={styles.zonePanel}><Pressable onPress={() => router.push({ pathname: '/scouting-zones/[zoneId]', params: { zoneId: zone.id } } as unknown as Href)}><View style={styles.heading}><Text style={styles.crop}>Inspection suggested</Text><StatePill label={task?.status.replaceAll('_', ' ') ?? 'INSPECT'} tone="amber" /></View><Text style={styles.detail}>{zone.observationIds.length} nearby observations · {zone.center.latitude.toFixed(5)}, {zone.center.longitude.toFixed(5)}</Text></Pressable>{task ? <><Text style={styles.detail}>Local request only · no drone command was sent.</Text>{task.status === 'rescan_requested' ? <PrimaryButton label="Capture targeted rescan" onPress={() => router.push({ pathname: '/crop-health-scan', params: { scoutingTaskId: task.id } })} /> : null}</> : <PrimaryButton label="Request targeted rescan" onPress={() => { void requestRescan(zone); }} />}</Panel>; }) : <EmptyState title="No inspection zones" description="Zones appear only when multiple eligible, located observations of the same possible issue are nearby." label="NO ZONES" />}{savedTask ? <Text style={styles.taskSaved}>Targeted rescan request saved locally.</Text> : null}</View>
    {mapData?.session ? <Panel style={styles.sessionPanel}><Text style={styles.crop}>Scouting session · {mapData.session.status === 'active' ? 'Broad survey in progress' : mapData.session.status === 'completed' ? 'Broad survey complete' : 'Session interrupted'}</Text><Text style={styles.detail}>Drone {mapData.session.droneId} · started {new Date(mapData.session.startedAt).toLocaleString()}</Text><Text style={styles.detail}>{mapData.session.endedAt ? `Ended ${new Date(mapData.session.endedAt).toLocaleString()} · ` : ''}{mapData.session.observationCount} observations · {mapData.track.length ? `${mapData.track.length} track points` : 'no GPS track'} · ${zones.length} zones</Text></Panel> : null}
    <View><SectionTitle>{t('fieldSensorReadings')}</SectionTitle>{fieldSensors.length ? <>{[...sensorGroups].map(([zone, entries]) => <View key={zone}><SectionTitle style={styles.zoneHeading}>{zone}</SectionTitle><View style={styles.sensorGrid}>{entries.map(({ card, index }) => { const interpretation = card.value === undefined ? undefined : interpretSensorValue(card.kind, card.value, card.sensorId ? sensorCalibrations[card.sensorId] : undefined); return <Panel key={`${card.sensorId ?? card.kind}-${index}`} style={styles.sensorCard}><Text style={styles.sensorName}>{sensorName(card.kind, t)}</Text><Text style={styles.sensorValue}>{interpretation ? t(interpretation.key) : card.value === undefined ? '—' : `${card.value}${card.kind === 'temperature' ? ' °C' : card.kind === 'humidity' ? ' %' : ''}`}</Text>{card.raw ? <Text style={styles.detail}>{t('sensorRawValue')}: {card.value ?? '—'}</Text> : null}{interpretation?.intensity ? <Text style={styles.detail}>{t('rainIntensity')}: {t(interpretation.intensity === 'light' ? 'rainLight' : interpretation.intensity === 'moderate' ? 'rainModerate' : 'rainHeavy')}</Text> : null}<Text style={styles.detail}>{card.position ?? t('sensorPositionNotAdded')} · {t('sensorFieldHub')}</Text><Text style={[styles.sensorState, card.state === 'live' && styles.sensorLive]}>{card.state === 'live' ? `● ${t('sensorLive')}` : card.state === 'stale' ? t('sensorStaleState') : card.state === 'disconnected' ? t('sensorsOffline') : t('sensorUnavailable')}</Text>{card.receivedAt ? <Text style={styles.detail}>{t('hubLastUpdate') + ' · ' + new Date(card.receivedAt).toLocaleTimeString()}</Text> : null}</Panel>; })}</View></View>)}{fieldSensors.some((sensor) => sensor.kind === 'rain') ? <Text style={styles.detail}>{t('rainIntensityNote')}</Text> : null}{sensorAlerts.length ? <><SectionTitle>{t('alertsNeedsAttention')}</SectionTitle>{sensorAlerts.slice(0, 4).map((alert) => <Panel key={`${alert.key}-${alert.sensorId}`} style={styles.zonePanel}><Text style={styles.crop}>{t(alert.key === 'rainDetected' ? 'rainDetected' : alert.key === 'soilDry' ? 'soilDryAlert' : alert.key === 'sensorStale' ? 'sensorStaleAlert' : 'sensorDisconnectedAlert')}</Text><Text style={styles.detail}>{alert.position ? `${alert.position} · ` : ''}{t('sensorFieldHub')}</Text></Panel>)}</> : null}<Pressable accessibilityRole="button" onPress={() => setPositionsExpanded((value) => !value)} style={styles.positionsToggle}><Text style={styles.quickActionText}>{t(positionsExpanded ? 'sensorHideDetails' : 'sensorPositions')}</Text></Pressable>{positionsExpanded ? fieldSensors.map((sensor, index) => <View key={sensor.id} style={styles.positionRow}><Text style={styles.sensorName}>{sensor.label} · {index + 1}</Text><View style={styles.positionChoices}>{SENSOR_ZONES.map((zone) => <Pressable key={zone} accessibilityRole="button" accessibilityState={{ selected: sensor.zonePosition === zone }} onPress={() => { void assignSensorPosition(sensor.id, zone); }} style={[styles.zoneChoice, sensor.zonePosition === zone && styles.zoneChoiceSelected]}><Text style={[styles.zoneChoiceText, sensor.zonePosition === zone && styles.zoneChoiceTextSelected]}>{t(sensorZoneKey(zone))}</Text></Pressable>)}</View><Pressable accessibilityRole="button" onPress={() => setPlacingSensorId(sensor.id)} style={styles.positionsToggle}><Text style={styles.quickActionText}>{t(sensor.coordinates ? 'sensorChangeMapLocation' : 'sensorPlaceMap')}</Text></Pressable></View>) : null}</> : <EmptyState title={t('sensorNoFieldHub')} description={t('sensorNoFieldHubDetail')} />}</View>
    <View><SectionTitle>Observation history</SectionTitle>{observations.length ? <><FilterGroup label="Date" values={['all', '7d', '30d']} selected={filterDate} onSelect={(value) => setFilterDate(value as typeof filterDate)} /><FilterGroup label="Crop" values={cropFilters} selected={filterCrop} onSelect={setFilterCrop} /><FilterGroup label="Status" values={statusFilters} selected={filterStatus} onSelect={setFilterStatus} /><FilterGroup label="Source" values={sourceFilters} selected={filterSource} onSelect={setFilterSource} />{history.length ? history.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/observations/[observationId]', params: { observationId: item.id } })} style={styles.history}><View style={styles.timelineDot} /><View style={styles.historyCopy}><Text style={styles.historyDate}>{relativeDate(item.timestamp ?? item.observedAt)}</Text><Text style={styles.historyTitle}>{item.title}</Text><Text style={styles.detail}>{[item.crop, item.condition].filter(Boolean).join(' · ') || 'Condition not recorded'}</Text>{item.source === 'manual_photo' ? <Text style={styles.detail}>{t('photoManualSource')}</Text> : null}<Text style={styles.detail}>{item.confidence !== undefined ? `${Math.round(item.confidence * 100)}% AI confidence` : 'Confidence unavailable'} · {verificationLabel(item)}</Text></View><Text style={styles.arrow}>›</Text></Pressable>) : <EmptyState title="No matching observations" description="Change the filters to see more recorded history." />}</> : <EmptyState title="No field observations" description="Real observations will appear here after they are recorded." label="NO OBSERVATIONS" />}</View>
    {field.boundary ? <Text style={styles.note}>Area estimated from the saved boundary: {field.area ? `${field.area.value.toFixed(2)} ${field.area.unit}` : 'unavailable'}.</Text> : <Text style={styles.note}>No field boundary has been recorded.</Text>}
  </PrithviPage>;
}
function FilterGroup({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect(value: string): void }) { return <View style={styles.filterLine}><Text style={styles.filterLabel}>{label}</Text><View style={styles.filterOptions}>{values.map((value) => <Pressable key={value} onPress={() => onSelect(value)} style={[styles.filterChip, selected === value && styles.selectedChip]}><Text style={[styles.filterText, selected === value && styles.selectedFilterText]}>{value === 'All' || value === 'all' ? 'All' : value === '7d' ? '7 days' : value === '30d' ? '30 days' : value.replaceAll('_', ' ')}</Text></Pressable>)}</View></View>; }
function verificationLabel(item: CropObservation) { return item.verificationStatus === 'verified' ? 'Verified' : item.verificationStatus === 'dismissed' ? 'Dismissed' : 'Needs verification'; }
function relativeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString();
  return `${day} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
function validSeed(latitude: string, longitude: string): GeoPoint | undefined { if (!latitude.trim() || !longitude.trim()) return undefined; const point = { latitude: Number(latitude), longitude: Number(longitude) }; return isValidGeoPoint(point) ? point : undefined; }
function HealthCount({ label, value }: { label: string; value: number }) { return <View style={styles.healthCount}><Text style={styles.healthValue}>{value}</Text><Text style={styles.healthLabel}>{label}</Text></View>; }
function sensorName(kind: 'temperature' | 'humidity' | 'soil_moisture' | 'rain', t: (key: Parameters<typeof translate>[1]) => string) { return t(kind === 'temperature' ? 'sensorTemperature' : kind === 'humidity' ? 'sensorHumidity' : kind === 'soil_moisture' ? 'sensorSoilMoisture' : 'sensorRain'); }
const SENSOR_ZONES = ['North', 'South', 'East', 'West', 'Center', 'Zone A', 'Zone B', 'Zone C'] as const;
function sensorZoneKey(zone: typeof SENSOR_ZONES[number]): Parameters<typeof translate>[1] { return ({ North: 'zoneNorth', South: 'zoneSouth', East: 'zoneEast', West: 'zoneWest', Center: 'zoneCenter', 'Zone A': 'zoneA', 'Zone B': 'zoneB', 'Zone C': 'zoneC' } as const)[zone]; }
function SmallAction({ title, disabled, onPress }: { title: string; disabled?: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.smallAction, disabled && styles.smallActionDisabled, pressed && !disabled && { opacity: 0.8 }]}><Text style={styles.smallActionText}>{title}</Text></Pressable>; }
function QuickAction({ label, onPress }: { label: string; onPress(): void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={styles.quickAction}><Text style={styles.quickActionText}>{label}</Text></Pressable>; }
function LayerToggle({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.zoneChoice, selected && styles.zoneChoiceSelected]}><Text style={[styles.zoneChoiceText, selected && styles.zoneChoiceTextSelected]}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, crop: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16, flex: 1 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18, marginTop: 5 }, devicePanel: { gap: spacing.sm }, deviceRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, deviceCopy: { flex: 1 }, quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }, quickAction: { minHeight: 38, paddingHorizontal: spacing.sm, justifyContent: 'center', borderRadius: 13, backgroundColor: colors.greenSoft }, quickActionText: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 12 }, sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, sensorCard: { flexBasis: '47%', flexGrow: 1, padding: spacing.md, borderWidth: 0, backgroundColor: colors.surface }, sensorName: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 13 }, sensorValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 22, marginTop: spacing.xs }, sensorState: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 11, marginTop: spacing.sm }, sensorLive: { color: colors.green }, zoneHeading: { marginTop: spacing.sm }, positionsToggle: { minHeight: 42, justifyContent: 'center' }, positionRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, gap: spacing.xs }, positionChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, zoneChoice: { minHeight: 34, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surfaceSoft }, zoneChoiceSelected: { backgroundColor: colors.green }, zoneChoiceText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 11 }, zoneChoiceTextSelected: { color: colors.white }, mapStatus: { color: colors.amber, fontFamily: fontFamilies.medium, fontSize: 12, marginTop: 5 }, note: { color: colors.muted, fontSize: 11, textAlign: 'center' }, history: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: spacing.sm }, timelineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.sage }, historyCopy: { flex: 1 }, historyDate: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 11 }, historyTitle: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14, marginTop: 3 }, arrow: { color: colors.muted, fontSize: 22 }, filterLine: { gap: 5, marginVertical: 4 }, filterLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' }, filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 }, filterChip: { minHeight: 30, borderRadius: 12, paddingHorizontal: 9, justifyContent: 'center', backgroundColor: colors.surfaceSoft }, selectedChip: { backgroundColor: colors.green }, filterText: { color: colors.muted, fontSize: 11 }, selectedFilterText: { color: colors.white }, zonePanel: { gap: spacing.sm, backgroundColor: colors.amberSoft, borderWidth: 0 }, taskSaved: { color: colors.green, fontSize: 13, textAlign: 'center' }, sessionPanel: { gap: 2, backgroundColor: colors.blueSoft, borderWidth: 0 }, healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.md }, healthCount: { flexBasis: '45%', flexGrow: 1, gap: 2 }, healthValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 19 }, healthLabel: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12 }, inlineAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm }, inlineActionText: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: 13 }, boundaryPanel: { gap: spacing.sm }, boundaryActions: { flexDirection: 'row', gap: spacing.sm }, smallAction: { minHeight: 40, borderRadius: 12, backgroundColor: colors.surfaceSoft, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }, smallActionDisabled: { opacity: 0.45 }, smallActionText: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 12 }, boundaryError: { color: colors.red, fontFamily: fontFamilies.medium, fontSize: 13 }, boundarySaved: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13 }, coordinateRow: { flexDirection: 'row', gap: spacing.sm }, coordinateInput: { flex: 1, minWidth: 0 }, geofencePanel: { marginTop: spacing.sm, backgroundColor: colors.surfaceSoft, borderWidth: 0 } });
const mapStyles = StyleSheet.create({ mapLayers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm } });




