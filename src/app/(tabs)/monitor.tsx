import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Panel, PrithviPage, SectionTitle } from '@/components/ui/prithvi-page';
import { alertService } from '@/data/container';
import type { Alert } from '@/domain/models';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

const groups = [
  { title: 'FIELD HEALTH', rows: [{ href: '/crop-health-scan', title: 'Crop health scan', detail: 'Capture an image for local analysis', icon: '◎', tone: 'green' as const }, { href: '/photo-diagnostics', title: 'Photo diagnostics', detail: 'Check a crop photo on this device', icon: '◉', tone: 'green' as const }, { href: '/(tabs)/health', title: 'Crop health', detail: 'Observations and field checks', icon: '✳', tone: 'green' as const }, { href: '/field-health', title: 'Field observations', detail: 'Recorded concerns and evidence', icon: '⌕', tone: 'coral' as const }, { href: '/scouting', title: 'Scouting', detail: 'Inspection areas and rescan requests', icon: '⌖', tone: 'sand' as const }] },
  { title: 'DEVICES', rows: [{ href: '/sensors', title: 'Sensors', detail: 'Readings and connection status', icon: '◌', tone: 'blue' as const }, { href: '/drone', title: 'Drone', detail: 'Missions and captured imagery', icon: '⌖', tone: 'sand' as const }] },
  { title: 'ATTENTION', rows: [{ href: '/alerts', title: 'Alerts', detail: 'Items that may need a closer look', icon: '!', tone: 'coral' as const }] },
] as const;

export default function MonitorRoute() {
  const router = useRouter(); const language = useLanguage(); const [alerts, setAlerts] = useState<Alert[]>([]);
  useFocusEffect(useCallback(() => { let active = true; void alertService.refresh().then((items) => { if (active) setAlerts(items.filter((item) => ['active', 'acknowledged'].includes(item.status))); }).catch(() => undefined); return () => { active = false; }; }, []));
  const attention = alerts.filter((item) => item.priority !== 'low').length; const monitoring = alerts.length - attention;
  return <PrithviPage title="Monitor" eyebrow="LOOK CLOSER" subtitle="Field observations and connected devices.">
    <View style={styles.intro}><View style={styles.introMark}><Text style={styles.introGlyph}>◉</Text></View><View style={styles.introText}><Text style={styles.introTitle}>Evidence, at a glance</Text><Text style={styles.introCopy}>Open a section to see what has actually been recorded.</Text></View></View>
    <Pressable accessibilityRole="button" onPress={() => router.push('/alerts')}><Panel style={styles.alertSummary}><View style={styles.alertSummaryCopy}><Text style={styles.alertSummaryTitle}>{translate(language, 'alertsTitle')}</Text><Text style={styles.alertSummaryText}>{translate(language, 'alertCounts').replace('{attention}', String(attention)).replace('{monitoring}', String(monitoring))}</Text></View><Text style={styles.arrow}>›</Text></Panel></Pressable>
    {groups.map((group) => <View key={group.title}><SectionTitle>{group.title}</SectionTitle>{group.rows.map((row) => <Pressable key={row.href} accessibilityRole="button" onPress={() => router.push(row.href as Href)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.icon, styles[row.tone]]}><Text style={[styles.iconText, styles[`${row.tone}Text`]]}>{row.icon}</Text></View><View style={styles.copy}><Text style={styles.title}>{row.href === '/photo-diagnostics' ? translate(language, 'photoDiagnostics') : row.title}</Text><Text style={styles.detail}>{row.href === '/photo-diagnostics' ? translate(language, 'photoDiagnosticsIntro') : row.detail}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}</View>)}
  </PrithviPage>;
}

const styles = StyleSheet.create({ intro: { minHeight: 94, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 22, backgroundColor: colors.blueSoft, padding: spacing.md }, introMark: { width: 46, height: 46, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, introGlyph: { color: colors.blue, fontSize: 21 }, introText: { flex: 1, gap: 3 }, introTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 15 }, introCopy: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 17 }, alertSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, backgroundColor: colors.amberSoft, borderWidth: 0 }, alertSummaryCopy: { flex: 1 }, alertSummaryTitle: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, alertSummaryText: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, marginTop: 3 }, row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingVertical: spacing.sm }, icon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, green: { backgroundColor: colors.greenSoft }, coral: { backgroundColor: colors.redSoft }, blue: { backgroundColor: colors.blueSoft }, sand: { backgroundColor: colors.sand }, iconText: { fontSize: 18 }, greenText: { color: colors.green }, coralText: { color: colors.red }, blueText: { color: colors.blue }, sandText: { color: colors.amber }, copy: { flex: 1 }, title: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, marginTop: 3 }, arrow: { color: colors.muted, fontSize: 23 }, pressed: { opacity: 0.75 } });
