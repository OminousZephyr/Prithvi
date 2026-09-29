import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Panel, PrimaryButton, PrithviPage, SectionTitle, TextField } from '@/components/ui/prithvi-page';
import { appProvider } from '@/data/container';
import { localStore } from '@/data/storage/local-store';
import type { Farm, Field } from '@/domain/models';
import { colors, fontFamilies, spacing } from '@/theme/tokens';
import { useLanguage } from '@/localization/use-language';
import { translate } from '@/localization/resources';

/** Farmer flow is field-first; an internal Farm row is retained for old storage relationships. */
export default function FieldsRoute() {
  const router = useRouter();
  const { selectField } = useLocalSearchParams<{ selectField?: string }>();
  const language = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [name, setName] = useState('');
  const [crop, setCrop] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const [farmRows, fieldRows] = await Promise.all([appProvider.listFarms(), appProvider.listFields()]); setFarms(farmRows); setFields(fieldRows); }
    catch { setError('Field records could not be loaded from this device.'); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function openField(field: Field) {
    if (selectField === '1') {
      await localStore.save('weather-preference', { id: 'current', fieldId: field.id, syncState: 'local' });
      router.back();
      return;
    }
    router.push({ pathname: '/fields/[fieldId]', params: { fieldId: field.id } });
  }

  async function addField() {
    const fieldName = name.trim();
    if (!fieldName) { setError(t('fieldNameRequired')); return; }
    const now = new Date().toISOString();
    try {
      // Reuse the existing internal farm association so old SQLite records and repositories remain readable.
      let internalFarm = farms[0];
      if (!internalFarm) {
        internalFarm = { id: `farm-${Date.now()}`, name: fieldName, fieldIds: [], isActive: true, createdAt: now, syncState: 'pending' };
        await localStore.save('farm', internalFarm);
      }
      const field: Field = { id: `field-${Date.now()}`, farmId: internalFarm.id, name: fieldName, crop: crop.trim() ? { id: `crop-${Date.now()}`, name: crop.trim() } : undefined, sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: now, syncState: 'pending' };
      await localStore.save('field', field);
      await localStore.save('farm', { ...internalFarm, fieldIds: [...new Set([...internalFarm.fieldIds, field.id])] });
      setName(''); setCrop(''); setError(''); await refresh();
      router.push({ pathname: '/fields/[fieldId]', params: { fieldId: field.id } });
    } catch { setError(t('fieldSaveError')); }
  }

  return <PrithviPage title={t('fieldSetupTitle')} eyebrow="FIELD SETUP" subtitle={t('fieldSetupSubtitle')}>
    <View><SectionTitle>{t(selectField === '1' ? 'fieldChooseCurrent' : 'fieldListHeading')}</SectionTitle>{fields.length ? fields.map((field) => <Pressable key={field.id} accessibilityRole="button" accessibilityLabel={field.name} onPress={() => { void openField(field); }} style={styles.fieldPanel}><Panel><View style={styles.heading}><Text style={styles.fieldName}>{field.name}</Text><Text style={styles.arrow}>›</Text></View><Text style={styles.detail}>{field.crop?.name ?? t('fieldReadyLater')}</Text></Panel></Pressable>) : <EmptyState title={t('fieldEmptyTitle')} description={t('fieldEmptyDescription')} label="READY WHEN YOU ARE" />}</View>
    <Panel><Text style={styles.formTitle}>{t('fieldAddTitle')}</Text><TextField label={t('fieldNameLabel')} value={name} onChangeText={setName} placeholder={t('fieldNamePlaceholder')} /><TextField label={t('fieldCropLabel')} value={crop} onChangeText={setCrop} placeholder={t('fieldCropPlaceholder')} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton label={t('fieldAddContinue')} onPress={addField} /></Panel>
  </PrithviPage>;
}
const styles = StyleSheet.create({ fieldPanel: { marginBottom: spacing.sm }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, fieldName: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 16 }, arrow: { color: colors.green, fontSize: 22 }, detail: { color: colors.muted, fontFamily: fontFamilies.body, fontSize: 13, marginTop: spacing.xs }, formTitle: { color: colors.ink, fontFamily: fontFamilies.semibold, fontSize: 17, marginBottom: spacing.sm }, error: { color: colors.red, fontFamily: fontFamilies.medium, fontSize: 14, marginTop: spacing.sm } });
