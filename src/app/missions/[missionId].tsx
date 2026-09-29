import { useLocalSearchParams } from 'expo-router';
import { EmptyState, PrithviPage } from '@/components/ui/prithvi-page';

export default function MissionDetailsRoute() {
  const { missionId } = useLocalSearchParams<{ missionId: string }>();
  return <PrithviPage title="Mission details" eyebrow="Drone scouting" subtitle={`Mission reference: ${missionId}`}><EmptyState title="Mission not found" description="Mission records can describe survey and rescan plans. They do not control a physical aircraft." label="NO LOCAL RECORD" /></PrithviPage>;
}
