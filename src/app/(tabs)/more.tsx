import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrithviPage, SectionTitle } from '@/components/ui/prithvi-page';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

export default function MoreRoute() {
  const router = useRouter();
  const language = useLanguage();
  const groups = [
    { title: translate(language, 'moreFarmTools'), rows: [{ href: '/advisory', title: 'Advisory', detail: 'Guidance with evidence', icon: '↗', tone: 'green' as const }, { href: '/analytics', title: 'History & trends', detail: 'Past records over time', icon: '⌁', tone: 'blue' as const }, { href: '/kisanmitra', title: translate(language, 'kisanmitra'), detail: translate(language, 'moreKisanMitraDetail'), icon: '✦', tone: 'sand' as const }] },
    { title: translate(language, 'moreMonitoring'), rows: [{ href: '/weather', title: translate(language, 'weatherTitle'), detail: translate(language, 'moreWeather'), icon: '☼', tone: 'blue' as const }] },
    { title: translate(language, 'moreApp'), rows: [{ href: '/account', title: translate(language, 'accountManage'), detail: translate(language, 'accountMoreDetail'), icon: '◉', tone: 'green' as const }, { href: '/settings', title: 'Settings & language', detail: 'App preferences', icon: '⚙', tone: 'sand' as const }, { href: '/diagnostics', title: 'Developer diagnostics', detail: 'Technical device and runtime information', icon: '⌘', tone: 'blue' as const }] },
  ];
  return <PrithviPage title="More" eyebrow={translate(language, 'moreTools')} subtitle={translate(language, 'moreSubtitle')}>
    {groups.map((group) => <View key={group.title}><SectionTitle>{group.title}</SectionTitle>{group.rows.map((row) => <Pressable key={row.href} accessibilityRole="button" onPress={() => router.push(row.href as Href)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.icon, styles[row.tone]]}><Text style={[styles.iconText, styles[`${row.tone}Text`]]}>{row.icon}</Text></View><View style={styles.copy}><Text style={styles.title}>{row.title}</Text><Text style={styles.detail}>{row.detail}</Text></View><Text style={styles.arrow}>›</Text></Pressable>)}</View>)}
  </PrithviPage>;
}

const styles = StyleSheet.create({ row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingVertical: spacing.sm }, icon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, green: { backgroundColor: colors.greenSoft }, blue: { backgroundColor: colors.blueSoft }, sand: { backgroundColor: colors.sand }, iconText: { fontSize: 18 }, greenText: { color: colors.green }, blueText: { color: colors.blue }, sandText: { color: colors.amber }, copy: { flex: 1 }, title: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 15 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, marginTop: 3 }, arrow: { color: colors.muted, fontSize: 23 }, pressed: { opacity: 0.75 } });
