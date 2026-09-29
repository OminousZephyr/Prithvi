import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamilies, radius, spacing, typeScale } from '@/theme/tokens';

export function PrithviPage({ title, eyebrow, subtitle, right, children, showBrand = true }: PropsWithChildren<{ title: string; eyebrow?: string; subtitle?: string; right?: ReactNode; showBrand?: boolean }>) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={styles.page} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top + spacing.sm, spacing.md) }]}>
    <View style={styles.header}>
      {showBrand ? <View style={styles.brandLine}><Image source={require('../../../assets/branding/prithvi-mark.png')} style={styles.brandMark} resizeMode="contain" accessible accessibilityRole="image" accessibilityLabel="PRITHVI Earth and crops mark" /><Text style={styles.brand}>PRITHVI</Text></View> : null}
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.titleRow}><Text style={styles.title}>{title}</Text>{right}</View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {children}
  </ScrollView>;
}

export function SectionTitle({ children, action, style }: PropsWithChildren<{ action?: ReactNode; style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.sectionTitleRow, style]}><Text style={styles.sectionTitle}>{children}</Text>{action}</View>;
}
export const SectionHeader = SectionTitle;

export function Panel({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { return <View style={[styles.panel, style]}>{children}</View>; }
export const Card = Panel;

export function StatePill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  const palette = tone === 'green' ? [colors.greenSoft, colors.green] : tone === 'amber' ? [colors.amberSoft, colors.amber] : tone === 'red' ? [colors.redSoft, colors.red] : tone === 'blue' ? [colors.blueSoft, colors.blue] : [colors.surfaceSoft, colors.muted];
  return <View style={[styles.pill, { backgroundColor: palette[0] }]}><Text style={[styles.pillText, { color: palette[1] }]}>{label}</Text></View>;
}

export function MetricCard({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  return <Panel style={styles.metricCard}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, tone === 'amber' && styles.metricAmber, tone === 'red' && styles.metricRed]}>{value}</Text>{detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}</Panel>;
}

export function EmptyState({ title, description, label = 'NOT RECORDED' }: { title: string; description: string; label?: string }) {
  return <Panel style={styles.emptyPanel}><View style={styles.emptyIcon}><Text style={styles.emptyIconText}>·</Text></View><StatePill label={label} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text></Panel>;
}
export function UnavailableState({ title, description }: { title: string; description: string }) { return <EmptyState title={title} description={description} label="DATA UNAVAILABLE" />; }
export function OfflineState({ title = 'Working offline', description = 'Saved farm information on this device remains available.' }: { title?: string; description?: string }) { return <EmptyState title={title} description={description} label="OFFLINE" />; }
export function LoadingState({ label = 'Loading information…' }: { label?: string }) { return <View accessibilityRole="progressbar" style={styles.stateRow}><ActivityIndicator color={colors.green} /><Text style={styles.stateText}>{label}</Text></View>; }
export function ErrorState({ title = 'Could not load this information', description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return <Panel style={styles.errorPanel}><StatePill label="PLEASE TRY AGAIN" tone="red" /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyDescription}>{description}</Text>{onRetry ? <PrimaryButton label="Try again" onPress={onRetry} /> : null}</Panel>;
}
export function ConfidenceIndicator({ level }: { level?: 'high' | 'medium' | 'low' }) {
  const value = level === 'high' ? 'High' : level === 'medium' ? 'Moderate' : level === 'low' ? 'Low' : 'Not available';
  return <View style={styles.indicator}><Text style={styles.indicatorLabel}>Confidence</Text><Text style={styles.indicatorValue}>{value}</Text></View>;
}
export function ProvenanceIndicator({ source, detail }: { source: 'farmer' | 'device' | 'model' | 'environment' | 'simulated'; detail?: string }) {
  const labels = { farmer: 'Entered by farmer', device: 'Device data', model: 'AI observation', environment: 'Environmental estimate', simulated: 'Simulated data' };
  return <View style={styles.provenance}><Text style={styles.provenanceLabel}>{labels[source]}</Text>{detail ? <Text style={styles.provenanceDetail}>{detail}</Text> : null}</View>;
}
export function TextField({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}</Text><TextInput {...props} accessibilityLabel={props.accessibilityLabel ?? label} placeholderTextColor={colors.quiet} returnKeyType={props.returnKeyType ?? 'next'} style={[styles.input, props.style]} /></View>;
}
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
  header: { gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs }, brandLine: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }, brandMark: { width: 40, height: 40 }, brand: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 14, letterSpacing: 1.7 },
  eyebrow: { color: colors.green, fontFamily: fontFamilies.semibold, fontSize: typeScale.caption, letterSpacing: 0.35 }, titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, title: { color: colors.ink, fontFamily: fontFamilies.display, fontSize: typeScale.title, lineHeight: 30, flexShrink: 1 }, subtitle: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }, sectionTitle: { fontFamily: fontFamilies.semibold, fontSize: typeScale.bodyLarge, color: colors.ink }, panel: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.feature, padding: spacing.lg },
  pill: { alignSelf: 'flex-start', minHeight: 28, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, justifyContent: 'center' }, pillText: { fontFamily: fontFamilies.semibold, fontSize: 11, letterSpacing: 0.1 },
  metricCard: { flexGrow: 1, flexBasis: 145, padding: spacing.md, gap: spacing.xs, borderWidth: 0, backgroundColor: colors.surfaceSoft }, metricLabel: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: typeScale.caption }, metricValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16, lineHeight: 21 }, metricAmber: { color: colors.amber }, metricRed: { color: colors.red }, metricDetail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 17 },
  emptyPanel: { alignItems: 'flex-start', gap: spacing.sm, borderWidth: 0, backgroundColor: colors.surfaceSoft }, emptyIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }, emptyIconText: { color: colors.green, fontSize: 24, lineHeight: 28 }, emptyTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17, marginTop: spacing.xs }, emptyDescription: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20 },
  stateRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, stateText: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 14 }, errorPanel: { gap: spacing.sm }, indicator: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, indicatorLabel: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12 }, indicatorValue: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 12 }, provenance: { gap: 3 }, provenanceLabel: { color: colors.blue, fontFamily: fontFamilies.semibold, fontSize: 12 }, provenanceDetail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, lineHeight: 17 },
  inputGroup: { marginTop: spacing.md, gap: spacing.xs }, inputLabel: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 }, input: { minHeight: 50, backgroundColor: colors.surfaceSoft, borderColor: colors.lineStrong, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.ink, fontFamily: fontFamilies.body, fontSize: 16 }, button: { marginTop: spacing.md, minHeight: 50, borderRadius: radius.control, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, buttonDisabled: { backgroundColor: colors.quiet }, buttonPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] }, buttonText: { color: colors.white, fontFamily: fontFamilies.semibold, fontSize: 15 },
});
