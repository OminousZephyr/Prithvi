import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { appProvider } from '@/data/container';
import type { Farm, Field } from '@/domain/models';
import { colors } from '@/theme/tokens';

export default function FarmDetailsRoute() {
  const router = useRouter();
  const { farmId } = useLocalSearchParams<{ farmId: string }>();
  const [farm, setFarm] = useState<Farm>();
  const [fields, setFields] = useState<Field[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void Promise.all([appProvider.getFarm(farmId), appProvider.listFields(farmId)])
      .then(([farmRecord, fieldRecords]) => { setFarm(farmRecord); setFields(fieldRecords); })
      .catch(() => setFailed(true));
  }, [farmId]);

  if (!farm) return <PrithviPage title="Farm details" eyebrow="Farm record">{failed ? <EmptyState title="Farm data unavailable" description="The local farm record could not be opened." label="STORAGE ISSUE" /> : <EmptyState title="Loading farm record" description="Opening this device's local record." label="LOCAL DATA" />}</PrithviPage>;
  return <PrithviPage title={farm.name} eyebrow="Farm overview" subtitle={[farm.location, farm.ownerName].filter(Boolean).join(' · ') || 'Location not recorded'}>
    <Panel><View style={styles.heading}><Text style={styles.label}>AREA</Text><StatePill label="FARMER ENTERED" tone="blue" /></View><Text style={styles.area}>{farm.area ? `${farm.area.value} ${farm.area.unit}${farm.area.value === 1 ? '' : 's'}` : 'Not recorded'}</Text><Text style={styles.detail}>{fields.length} field{fields.length === 1 ? '' : 's'} linked · Crop cycles are not recorded yet</Text></Panel>
    <View><SectionTitle>Fields</SectionTitle>{fields.length ? fields.map((field) => <Pressable key={field.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/fields/[fieldId]', params: { fieldId: field.id } })} style={styles.field}><Panel><Text style={styles.fieldName}>{field.name}</Text><Text style={styles.detail}>{field.crop?.name ?? 'Crop not recorded'} · Health {field.healthStatus.replace('_', ' ')}</Text></Panel></Pressable>) : <EmptyState title="No fields linked" description="Add a field from Farm." label="NO FIELD DATA" />}</View>
    <Panel><SectionTitle>Farm activity</SectionTitle><Text style={styles.detail}>Observations and farm alerts will appear when they are recorded. None have been created.</Text></Panel>
  </PrithviPage>;
}
const styles = StyleSheet.create({ heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, label: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, area: { color: colors.ink, fontSize: 25, fontWeight: '700', marginTop: 8 }, detail: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 }, field: { marginBottom: 9 }, fieldName: { color: colors.ink, fontSize: 15, fontWeight: '700' } });
