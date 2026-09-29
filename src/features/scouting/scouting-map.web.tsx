import { StyleSheet, Text, View } from 'react-native';
import type { ScoutingMapData } from './scouting-types';
import { colors } from '@/theme/tokens';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';

export function ScoutingMap({ data }: { data: ScoutingMapData; onObservationPress(id: string): void; onZonePress?(id: string): void; onDronePress?(): void; onBoundaryPointPress?(point: { latitude: number; longitude: number }): void }) {
  const language = useLanguage();
  const mappedCount = data.observations.length + data.track.length + (data.dronePosition ? 1 : 0);
  return <View style={styles.panel}><Text style={styles.title}>{translate(language, 'mapTilesUnavailable')}</Text><Text style={styles.body}>{translate(language, 'mapDataStillShown')}</Text><Text style={styles.body}>{data.draftPoints?.length ?? data.boundary?.length ?? 0} · {data.observations.length} · {data.zones?.length ?? 0} · {data.track.length} · {mappedCount ? 'real mapped data available' : 'no mapped points'}</Text>{data.drawingBoundary ? <Text style={styles.body}>{translate(language, 'drawBoundary')} · enter the actual coordinates below to add points.</Text> : null}</View>;
}
const styles = StyleSheet.create({ panel: { minHeight: 160, borderRadius: 18, backgroundColor: colors.surfaceSoft, padding: 18, justifyContent: 'center', gap: 8 }, title: { color: colors.ink, fontSize: 16, fontWeight: '600' }, body: { color: colors.muted, fontSize: 13, lineHeight: 19 } });
