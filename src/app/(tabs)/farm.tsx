import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle } from '@/components/ui/prithvi-page';
import { appProvider } from '@/data/container';
import type { Field } from '@/domain/models';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function FieldRoute() {
  const router = useRouter(); const [fields, setFields] = useState<Field[]>([]); const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => appProvider.listFields().then((rows) => { setFields(rows); setFailed(false); }).catch(() => setFailed(true)), []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <PrithviPage title="Field" eyebrow="YOUR FIELD" subtitle="Everything happening in one place.">
    <View><SectionTitle>Your fields</SectionTitle>{failed ? <EmptyState title="Field details unavailable" description="Try again when this device’s saved records are available." /> : fields.length ? fields.map((field) => <Pressable key={field.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/fields/[fieldId]', params: { fieldId: field.id } })} style={styles.row}><Panel style={styles.panel}><View style={styles.line}><View style={styles.copy}><Text style={styles.name}>{field.name}</Text><Text style={styles.detail}>{field.crop?.name ?? 'Crop not added yet'}{field.area ? ` · ${field.area.value} ${field.area.unit}` : ''}</Text></View><Text style={styles.arrow}>›</Text></View></Panel></Pressable>) : <EmptyState title="Add your first field" description="A field name is all you need to begin. Devices and maps are optional." />}</View>
    <PrimaryButton label="+  Add field" onPress={() => router.push('/(tabs)/fields')} />
  </PrithviPage>;
}
const styles = StyleSheet.create({ row: { marginBottom: spacing.sm }, panel: { borderWidth: 0 }, line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, copy: { flex: 1 }, name: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, marginTop: 4 }, arrow: { color: colors.green, fontSize: 24 } });
