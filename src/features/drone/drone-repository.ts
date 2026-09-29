import type { DroneTelemetry, DroneTrackPoint, FlightSession } from '@/domain/models';
import { validGpsFix } from './drone-status.ts';

export interface DroneStore { list<T>(type: string): Promise<T[]>; get?<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
export class DroneRepository {
  private readonly store: DroneStore;
  constructor(store: DroneStore) { this.store = store; }
  listTelemetry() { return this.store.list<DroneTelemetry>('drone-telemetry'); }
  async getLatestTelemetry() { return (await this.listTelemetry()).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]; }
  async recordTelemetry(value: DroneTelemetry) {
    await this.store.save('drone-telemetry', value);
    const active = await this.getActiveSession();
    if (value.connectionState === 'connected' && value.armed === true && !active) {
      const session = await this.store.save('flight-session', { id: `flight:${value.droneId}:${value.receivedAt}`, droneId: value.droneId, sessionType: 'flight', startedAt: value.receivedAt, endedAt: null, status: 'active', telemetryCount: 1, observationCount: 0, syncState: 'local' } satisfies FlightSession);
      if (validGpsPoint(value)) await this.saveTrackPoint(session.id, value);
    }
    else if (active && value.connectionState === 'connected') {
      const session = active;
      if (session.sessionType === 'inspection') {
        await this.store.save('flight-session', { ...session, telemetryCount: session.telemetryCount + 1 });
        if (session.status === 'active' && validGpsPoint(value)) await this.saveTrackPoint(session.id, value);
      } else {
        if (value.armed === false) await this.store.save('flight-session', { ...session, endedAt: value.receivedAt, status: 'completed', telemetryCount: session.telemetryCount + 1 });
        else await this.store.save('flight-session', { ...session, telemetryCount: session.telemetryCount + 1 });
        if (session.status === 'active' && value.armed !== false && validGpsPoint(value)) await this.saveTrackPoint(session.id, value);
      }
    }
    return value;
  }
  async getActiveSession() { return (await this.store.list<FlightSession>('flight-session')).filter((s) => s.status === 'active').sort((a, b) => Number(b.sessionType === 'inspection') - Number(a.sessionType === 'inspection') || b.startedAt.localeCompare(a.startedAt))[0]; }
  async getActiveInspectionSession() { return (await this.store.list<FlightSession>('flight-session')).filter((s) => s.sessionType === 'inspection' && s.status === 'active').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]; }
  async listInspectionSessions(fieldId?: string) { return (await this.store.list<FlightSession>('flight-session')).filter((s) => s.sessionType === 'inspection' && (!fieldId || s.fieldId === fieldId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  async startInspection(fieldId: string, droneId: string, at = new Date().toISOString()) {
    if (!fieldId.trim() || !droneId.trim() || !Number.isFinite(Date.parse(at))) throw new Error('A real field, drone ID, and valid start time are required.');
    const active = await this.getActiveInspectionSession();
    if (active) return active;
    return this.store.save('flight-session', { id: `inspection:${droneId}:${Date.parse(at)}`, droneId, fieldId, sessionType: 'inspection', startedAt: at, endedAt: null, status: 'active', telemetryCount: 0, observationCount: 0, imageCount: 0, zoneCount: 0, syncState: 'local' } satisfies FlightSession);
  }
  async endInspection(sessionId: string, status: 'completed' | 'interrupted' = 'completed', at = new Date().toISOString()) {
    const current = (await this.listInspectionSessions()).find((session) => session.id === sessionId);
    if (!current || current.status !== 'active') return current;
    return this.store.save('flight-session', { ...current, endedAt: at, status, syncState: 'local' });
  }
  async recordImageCapture(sessionId: string) {
    const current = (await this.listInspectionSessions()).find((session) => session.id === sessionId);
    if (!current || current.status !== 'active') return current;
    return this.store.save('flight-session', { ...current, imageCount: (current.imageCount ?? 0) + 1, syncState: 'local' });
  }
  async updateInspectionZoneCount(sessionId: string, zoneCount: number) {
    const current = (await this.listInspectionSessions()).find((session) => session.id === sessionId);
    if (!current || current.status !== 'active' || !Number.isInteger(zoneCount) || zoneCount < 0) return current;
    return this.store.save('flight-session', { ...current, zoneCount, syncState: 'local' });
  }
  async listSessions(droneId?: string) { return (await this.store.list<FlightSession>('flight-session')).filter((s) => !droneId || s.droneId === droneId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  async getTrack(sessionId: string) { return (await this.store.list<DroneTrackPoint>('drone-track-point')).filter((point) => point.flightSessionId === sessionId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)); }
  async markDisconnected(at = new Date().toISOString()) { const active = await this.getActiveSession(); if (active && active.sessionType !== 'inspection') await this.store.save('flight-session', { ...active, endedAt: at, status: 'interrupted' }); }
  async associateObservation(sessionId: string, droneId: string) { const session = await this.store.get?.<FlightSession>('flight-session', sessionId) ?? (await this.listSessions(droneId)).find((s) => s.id === sessionId); if (!session || session.status !== 'active' || session.droneId !== droneId) return false; await this.store.save('flight-session', { ...session, observationCount: session.observationCount + 1 }); return true; }
  private async saveTrackPoint(sessionId: string, value: DroneTelemetry) { await this.store.save('drone-track-point', { id: `${sessionId}:${value.receivedAt}`, flightSessionId: sessionId, timestamp: value.receivedAt, latitude: value.latitude!, longitude: value.longitude!, altitudeM: value.altitudeM, headingDegrees: value.headingDegrees, syncState: 'local' } satisfies DroneTrackPoint); }
}
function validGpsPoint(value: DroneTelemetry) { return value.connectionState === 'connected' && validGpsFix(value.gpsFix) && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.latitude! >= -90 && value.latitude! <= 90 && value.longitude! >= -180 && value.longitude! <= 180; }
