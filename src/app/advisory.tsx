import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrithviPage, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, appProvider } from '@/data/container';
import type { Advisory, AdvisoryStatus, Field, Farm } from '@/domain/models';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

type Choice = 'all' | string;
export default function AdvisoryRoute() {
  const [items, setItems] = useState<Advisory[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmFilter, setFarmFilter] = useState<Choice>('all');
  const [fieldFilter, setFieldFilter] = useState<Choice>('all');
  const [categoryFilter, setCategoryFilter] = useState<Choice>('all');
  const [statusFilter, setStatusFilter] = useState<Choice>('all');
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d'>('all');
  const [clock, setClock] = useState(0);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try { const [advisories, fieldRows, farmRows] = await Promise.all([advisoryRepository.refresh(), appProvider.listFields(), appProvider.listFarms()]); setItems(advisories); setFields(fieldRows); setFarms(farmRows); setClock(Date.now()); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const cutoff = dateFilter === 'all' ? 0 : clock - (dateFilter === '7d' ? 7 : 30) * 86_400_000;
  const filtered = items.filter((item) => (!farmFilter || farmFilter === 'all' || item.farmId === farmFilter)
    && (!fieldFilter || fieldFilter === 'all' || item.fieldId === fieldFilter)
    && (!categoryFilter || categoryFilter === 'all' || item.category === categoryFilter)
    && (!statusFilter || statusFilter === 'all' || item.status === statusFilter)
    && Date.parse(item.createdAt) >= cutoff);
  const active = filtered.filter((item) => item.status === 'active' || item.status === 'acknowledged');
  const needsAttention = active.filter((item) => item.priority !== 'low');
  const monitoring = active.filter((item) => item.priority === 'low');
  const resolved = filtered.filter((item) => ['resolved', 'dismissed', 'expired'].includes(item.status));
  const fieldLabel = (id?: string) => fields.find((field) => field.id === id)?.name ?? 'Field not assigned';
  const change = async (item: Advisory, status: AdvisoryStatus) => { await advisoryRepository.setStatus(item.id, status); await refresh(); };
  return <PrithviPage title="Advisory" eyebrow="FARM GUIDANCE" subtitle="Evidence and suggestions for you to consider. You make the final decision.">
    <SectionTitle>Filter records</SectionTitle>
    <Filter label="Farm" values={['all', ...farms.map((farm) => farm.id)]} selected={farmFilter} onSelect={setFarmFilter} labels={Object.fromEntries(farms.map((farm) => [farm.id, farm.name]))} />
    <Filter label="Field" values={['all', ...fields.filter((field) => farmFilter === 'all' || field.farmId === farmFilter).map((field) => field.id)]} selected={fieldFilter} onSelect={setFieldFilter} labels={Object.fromEntries(fields.map((field) => [field.id, field.name]))} />
    <Filter label="Category" values={['all', 'inspection', 'monitoring', 'irrigation_check', 'environment', 'image_quality', 'scouting', 'system']} selected={categoryFilter} onSelect={setCategoryFilter} />
    <Filter label="Status" values={['all', 'active', 'acknowledged', 'resolved', 'dismissed', 'expired']} selected={statusFilter} onSelect={setStatusFilter} />
    <Filter label="Date" values={['all', '7d', '30d']} selected={dateFilter} onSelect={(value) => setDateFilter(value as typeof dateFilter)} />
    {failed ? <EmptyState title="Advisory data unavailable" description="Local advisory records could not be opened." label="LOCAL STORAGE" /> : null}
    <SectionTitle>Needs attention</SectionTitle>
    {needsAttention.length ? needsAttention.map((item) => <AdvisoryCard key={item.id} item={item} fieldLabel={fieldLabel(item.fieldId)} onAcknowledge={() => { void change(item, 'acknowledged'); }} onDismiss={() => { void change(item, 'dismissed'); }} />) : <Text style={styles.emptyLine}>No active inspection or scouting suggestions.</Text>}
    <SectionTitle>Monitoring</SectionTitle>
    {monitoring.length ? monitoring.map((item) => <AdvisoryCard key={item.id} item={item} fieldLabel={fieldLabel(item.fieldId)} onAcknowledge={() => { void change(item, 'acknowledged'); }} onDismiss={() => { void change(item, 'dismissed'); }} />) : <Text style={styles.emptyLine}>No monitoring guidance.</Text>}
    <SectionTitle>Resolved</SectionTitle>
    {resolved.length ? resolved.map((item) => <AdvisoryCard key={item.id} item={item} fieldLabel={fieldLabel(item.fieldId)} />) : <Text style={styles.emptyLine}>No resolved advisory history.</Text>}
    {!items.length && !failed ? <EmptyState title="No recommendations yet" description="Guidance appears only when local observations or configured sensor rules support it." label="NO ADVISORIES" /> : null}
  </PrithviPage>;
}

function Filter({ label, values, selected, onSelect, labels = {} }: { label: string; values: string[]; selected: string; onSelect(value: string): void; labels?: Record<string, string> }) {
  return <View style={styles.filter}><Text style={styles.filterLabel}>{label}</Text><View style={styles.chips}>{values.map((value) => <Pressable key={value} accessibilityRole="button" onPress={() => onSelect(value)} style={[styles.chip, selected === value && styles.chipSelected]}><Text style={[styles.chipText, selected === value && styles.chipTextSelected]}>{labels[value] ?? (value === 'all' ? 'All' : value === '7d' ? '7 days' : value === '30d' ? '30 days' : value.replaceAll('_', ' '))}</Text></Pressable>)}</View></View>;
}
function AdvisoryCard({ item, fieldLabel, onAcknowledge, onDismiss }: { item: Advisory; fieldLabel: string; onAcknowledge?: () => void; onDismiss?: () => void }) {
  return <Panel style={styles.card}><View style={styles.cardTop}><Text style={styles.title}>{item.title}</Text><StatePill label={`${item.priority} · ${item.status}`} tone={item.status === 'active' && item.priority !== 'low' ? 'amber' : item.status === 'dismissed' ? 'neutral' : 'green'} /></View><Text style={styles.where}>{fieldLabel}{item.zoneId ? ` · ${item.zoneId}` : ''}</Text><Text style={styles.message}>{item.message}</Text><Text style={styles.reason}>Why: {item.reason}</Text><Text style={styles.action}>Next: {item.action}</Text><Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleString()}</Text>{item.status === 'active' ? <View style={styles.actions}><Pressable accessibilityRole="button" onPress={onAcknowledge} style={styles.actionButton}><Text style={styles.buttonText}>Seen</Text></Pressable><Pressable accessibilityRole="button" onPress={onDismiss} style={[styles.actionButton, styles.dismissButton]}><Text style={styles.dismissText}>Dismiss suggestion</Text></Pressable></View> : null}</Panel>;
}

const styles = StyleSheet.create({ filter: { marginBottom: spacing.xs, gap: 5 }, filterLabel: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { minHeight: 32, borderRadius: 13, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: colors.surfaceSoft }, chipSelected: { backgroundColor: colors.green }, chipText: { color: colors.muted, fontSize: 12 }, chipTextSelected: { color: colors.white }, card: { gap: spacing.xs, marginBottom: spacing.sm, borderWidth: 0, backgroundColor: colors.surfaceSoft }, cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, title: { flex: 1, color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16 }, where: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, message: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14, lineHeight: 20, marginTop: 3 }, reason: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 18 }, action: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 }, timestamp: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 11 }, actions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }, actionButton: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: colors.white, fontFamily: fontFamilies.medium, fontSize: 12 }, dismissButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, dismissText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 12 }, emptyLine: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, paddingVertical: spacing.xs } });
