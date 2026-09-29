import type { Alert } from '../../domain/models/index.ts';
import type { TranslationKey } from '../../localization/resources';

export function alertPriorityKey(priority: Alert['priority']): TranslationKey { return priority === 'high' ? 'alertHigh' : priority === 'medium' ? 'alertMedium' : 'alertLow'; }
export function alertStatusKey(status: Alert['status']): TranslationKey { return status === 'active' ? 'alertActive' : status === 'acknowledged' ? 'alertAcknowledged' : status === 'resolved' ? 'alertResolvedStatus' : status === 'dismissed' ? 'alertDismissed' : 'alertExpired'; }
export function alertTypeKey(type: Alert['type']): TranslationKey { return type === 'crop_inspection' ? 'alertCropInspection' : type === 'sensor' ? 'alertSensor' : type === 'drone' ? 'alertDrone' : type === 'geofence' ? 'alertGeofence' : 'alertSystem'; }
export function alertTypeIcon(type: Alert['type']) { return type === 'crop_inspection' ? '✳' : type === 'sensor' ? '◌' : type === 'drone' ? '⌖' : type === 'geofence' ? '⌂' : '·'; }
export function displayAlertTitle(alert: Alert, t: (key: TranslationKey) => string) {
  if (alert.type === 'crop_inspection') return t('alertInspectionTitle');
  if (alert.type === 'sensor') return t(alert.dedupeKey.endsWith(':connection') ? 'alertSensorDisconnected' : 'alertConnection');
  if (alert.type === 'drone') return t(alert.dedupeKey.endsWith(':gps') ? 'alertDroneGps' : 'alertDroneDisconnected');
  if (alert.type === 'geofence') return t('alertGeofenceOutside');
  return t('alertSystem');
}
export function displayAlertMessage(alert: Alert, t: (key: TranslationKey) => string) {
  if (alert.type === 'crop_inspection') return t(alert.zoneId ? 'alertInspectionRepeated' : 'alertInspectionMessage');
  if (alert.type === 'sensor') return t(alert.dedupeKey.endsWith(':connection') ? 'alertSensorDisconnectedMessage' : 'alertSensorStaleMessage');
  if (alert.type === 'drone') return t(alert.dedupeKey.endsWith(':gps') ? 'alertDroneGpsMessage' : 'alertDroneDisconnectedMessage');
  if (alert.type === 'geofence') return t('alertGeofenceMessage');
  return t('alertNoDetails');
}
