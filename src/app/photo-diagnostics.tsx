import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { EmptyState, Panel, PrithviPage, PrimaryButton, SectionTitle, StatePill } from '@/components/ui/prithvi-page';
import { advisoryRepository, aiRepository, alertService, appProvider, onDeviceAIProvider } from '@/data/container';
import type { CropObservation, Field } from '@/domain/models';
import type { AIAnalysisResult } from '@/features/ai/ai-types';
import { AIImageInputError, OnDeviceAIUnavailableError } from '@/features/ai/ai-types';
import { isSavableManualPhotoResult, isUnsupportedManualPhoto, ManualPhotoDiagnosticsService } from '@/features/ai/manual-photo-service';
import { useLanguage } from '@/localization/use-language';
import { translate, type TranslationKey } from '@/localization/resources';
import { colors, fontFamilies, spacing } from '@/theme/tokens';

type Progress = 'checking_image' | 'analyzing' | 'preparing_result';
type SelectedImage = { uri: string; mimeType?: string | null; fileName?: string | null; timestamp: string };

export default function PhotoDiagnosticsRoute() {
  const language = useLanguage();
  const t = (key: TranslationKey) => translate(language, key);
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState<string>();
  const [image, setImage] = useState<SelectedImage>();
  const [result, setResult] = useState<AIAnalysisResult>();
  const [saved, setSaved] = useState<CropObservation>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>('checking_image');
  const [error, setError] = useState<TranslationKey>();
  const photoService = useMemo(() => new ManualPhotoDiagnosticsService(onDeviceAIProvider, aiRepository), []);

  useEffect(() => { let active = true; void appProvider.listFields().then((items) => { if (active) setFields(items); }).catch(() => undefined); return () => { active = false; }; }, []);

  const progressLabel = progress === 'checking_image' ? t('photoChecking') : progress === 'analyzing' ? t('photoAnalyzing') : t('photoPreparing');

  async function selectImage(kind: 'camera' | 'library') {
    setError(undefined); setResult(undefined); setSaved(undefined);
    try {
      let picked: ImagePicker.ImagePickerResult;
      if (kind === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError('photoCameraPermission'); return; }
        picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      } else {
        picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      }
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) { setError('photoInvalid'); return; }
      setImage({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, timestamp: new Date().toISOString() });
    } catch { setError(kind === 'camera' ? 'photoCameraPermission' : 'photoInvalid'); }
  }

  async function analyze() {
    if (!image || busy) return;
    if (isUnsupportedManualPhoto(image)) { setError('photoUnsupported'); return; }
    setBusy(true); setError(undefined); setResult(undefined); setSaved(undefined); setProgress('checking_image');
    try {
      const analysis = await photoService.analyze(image.uri, { fieldId, capturedAt: image.timestamp, onProgress: setProgress });
      if (!isSavableManualPhotoResult(analysis)) { setError(analysis.imageQuality.status === 'low' ? 'photoQualityLow' : 'photoAnalysisError'); return; }
      setResult(analysis);
    } catch (reason) {
      if (reason instanceof AIImageInputError) setError(reason.message.toLocaleLowerCase().includes('quality too low') ? 'photoQualityLow' : reason.message.toLocaleLowerCase().includes('supported jpeg') ? 'photoUnsupported' : 'photoInvalid');
      else if (reason instanceof OnDeviceAIUnavailableError) setError('photoRuntimeUnavailable');
      else setError('photoAnalysisError');
    } finally { setBusy(false); }
  }

  async function saveObservation() {
    if (!image || !result || !isSavableManualPhotoResult(result) || saved || busy) return;
    setBusy(true); setError(undefined);
    try {
      const field = fieldId ? fields.find((item) => item.id === fieldId) : undefined;
      const observation = await photoService.save(result, image.uri, image.timestamp, field);
      if (!observation) { setError('photoSaveError'); return; }
      setSaved(observation);
      await advisoryRepository.refresh().catch(() => undefined);
      await alertService.refresh().catch(() => undefined);
    } catch { setError('photoSaveError'); }
    finally { setBusy(false); }
  }

  async function verify(state: CropObservation['verificationStatus'], note?: string) {
    if (!saved || busy) return;
    setBusy(true);
    try {
      const updated = await appProvider.updateObservationVerification(saved.id, state, note);
      if (updated) setSaved(updated);
      await alertService.refresh().catch(() => undefined);
    } catch { setError('photoSaveError'); }
    finally { setBusy(false); }
  }

  const resultTitle = result?.status === 'healthy_looking' ? t('photoAIHealthy') : result?.status === 'possible_issue' ? t('photoAIIssue') : t('photoAIUncertain');
  const verificationLabel = saved?.verificationStatus === 'verified' ? t('photoVerify') : saved?.verificationStatus === 'dismissed' ? t('photoDismiss') : t('photoNeedsVerification');

  return <PrithviPage title={t('photoDiagnostics')} eyebrow={t('photoOnDevice')} subtitle={t('photoDiagnosticsIntro')}>
    <View style={styles.actions}>
      <PrimaryButton label={t('photoTake')} onPress={() => { void selectImage('camera'); }} disabled={busy} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void selectImage('library'); }} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryText}>{t('photoChoose')}</Text></Pressable>
    </View>

    {fields.length ? <View><SectionTitle>{t('photoFieldOptional')}</SectionTitle><View style={styles.fieldOptions}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !fieldId }} onPress={() => setFieldId(undefined)} style={[styles.fieldChip, !fieldId && styles.fieldChipSelected]}><Text style={[styles.fieldChipText, !fieldId && styles.fieldChipTextSelected]}>{t('photoNoField')}</Text></Pressable>
      {fields.map((field) => <Pressable key={field.id} accessibilityRole="button" accessibilityState={{ selected: fieldId === field.id }} onPress={() => setFieldId(field.id)} style={[styles.fieldChip, fieldId === field.id && styles.fieldChipSelected]}><Text style={[styles.fieldChipText, fieldId === field.id && styles.fieldChipTextSelected]}>{field.name}</Text></Pressable>)}
    </View></View> : null}

    {image ? <View>
      <SectionTitle>{t('photoDiagnostics')}</SectionTitle>
      <Image accessibilityLabel={t('photoDiagnostics')} source={{ uri: image.uri }} resizeMode="contain" style={styles.preview} />
      <Text style={styles.caption}>{t('photoManualSource')}</Text>
      {!result && !busy ? <PrimaryButton label={t('photoAnalyze')} onPress={() => { void analyze(); }} /> : null}
    </View> : <EmptyState title={t('photoSelectPhoto')} description={t('photoPrivacy')} />}

    {busy ? <Panel style={styles.progress}><View style={styles.progressMark} /><Text style={styles.progressText}>{progressLabel}</Text></Panel> : null}
    {error ? <EmptyState title={t(error)} description={error === 'photoQualityLow' ? t('photoTryClearer') : error === 'photoRuntimeUnavailable' ? t('photoRuntimeHelp') : t('photoPrivacy')} label={t('photoAIStatus')} /> : null}

    {result ? <View>
      <SectionTitle>{t('photoPossibleResult')}</SectionTitle>
      <Panel style={styles.resultPanel}>
        <View style={styles.resultHeader}><Text style={styles.resultTitle}>{resultTitle}</Text><StatePill label={t('photoOnDevice')} tone={result.status === 'uncertain' ? 'amber' : 'green'} /></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoCrop')}</Text><Text style={styles.infoValue}>{result.crop}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoCondition')}</Text><Text style={styles.infoValue}>{result.condition}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoConfidence')}</Text><Text style={styles.infoValue}>{Math.round((result.confidence ?? 0) * 100)}%</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoAIStatus')}</Text><Text style={styles.infoValue}>{t('aiReady')}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoQuality')}</Text><Text style={styles.infoValue}>{result.imageQuality.status === 'acceptable' ? t('photoQualityAcceptable') : t('photoQualityLow')}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>{t('photoModelVersion')}</Text><Text style={styles.infoValue}>{result.modelVersion}</Text></View>
        {result.status === 'uncertain' ? <Text style={styles.helpText}>{t('photoLowConfidence')}</Text> : null}
        {result.topAlternatives && result.topAlternatives.length > 1 ? <View style={styles.alternatives}><Text style={styles.infoLabel}>{t('photoOtherPossibilities')}</Text>{result.topAlternatives.slice(1, 3).map((item) => <Text key={item.rawLabel} style={styles.alternative}>{item.crop} · {item.condition} · {Math.round(item.confidence * 100)}%</Text>)}</View> : null}
      </Panel>
      <Text style={styles.disclaimer}>{t('photoDisclaimer')}</Text>
      {saved ? <Panel style={styles.savedPanel}><StatePill label={verificationLabel} tone={saved.verificationStatus === 'verified' ? 'green' : 'amber'} /><Text style={styles.savedText}>{t('photoVerificationSaved')}</Text>
        {saved.verificationStatus !== 'verified' ? <PrimaryButton label={t('photoVerify')} onPress={() => { void verify('verified'); }} disabled={busy} /> : null}
        {saved.verificationStatus !== 'dismissed' ? <Pressable accessibilityRole="button" onPress={() => { void verify('dismissed'); }} disabled={busy} style={styles.textButton}><Text style={styles.textButtonLabel}>{t('photoDismiss')}</Text></Pressable> : null}
        {saved.verificationStatus === 'requires_verification' ? <Pressable accessibilityRole="button" onPress={() => { void verify('requires_verification', t('photoNeedsInspection')); }} disabled={busy} style={styles.textButton}><Text style={styles.textButtonLabel}>{t('photoNeedsInspection')}</Text></Pressable> : null}
      </Panel> : <PrimaryButton label={t('photoSaveObservation')} onPress={() => { void saveObservation(); }} disabled={busy} />}
    </View> : null}
    <Text style={styles.privacy}>{t('photoPrivacy')}</Text>
  </PrithviPage>;
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  fieldOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, fieldChip: { minHeight: 38, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: colors.surface }, fieldChipSelected: { borderColor: colors.green, backgroundColor: colors.greenSoft }, fieldChipText: { color: colors.muted, fontFamily: fontFamilies.medium, fontSize: 13 }, fieldChipTextSelected: { color: colors.green },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  secondaryText: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 15 }, pressed: { opacity: 0.75 },
  preview: { width: '100%', height: 300, borderRadius: 20, backgroundColor: colors.surfaceSoft },
  caption: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, marginTop: spacing.xs },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.greenSoft, borderWidth: 0 },
  progressMark: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.green }, progressText: { color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 },
  resultPanel: { gap: spacing.md, borderWidth: 0, backgroundColor: colors.surface }, resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, resultTitle: { flex: 1, color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 18 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md }, infoLabel: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13 }, infoValue: { maxWidth: '65%', textAlign: 'right', color: colors.ink, fontFamily: fontFamilies.medium, fontSize: 14 },
  alternatives: { gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.md }, alternative: { color: colors.ink, fontFamily: fontFamilies.body, fontSize: 13 }, helpText: { color: colors.amber, fontFamily: fontFamilies.medium, fontSize: 13, lineHeight: 19 },
  disclaimer: { color: colors.muted, fontFamily: fontFamilies.body, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  savedPanel: { gap: spacing.sm, backgroundColor: colors.greenSoft, borderWidth: 0 }, savedText: { color: colors.ink, fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20 }, textButton: { minHeight: 42, justifyContent: 'center', alignItems: 'center' }, textButtonLabel: { color: colors.green, fontFamily: fontFamilies.medium, fontSize: 14 }, privacy: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 12, textAlign: 'center' },
});
