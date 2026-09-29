import { useEffect, useState } from 'react';
import { localStore } from '@/data/storage/local-store';
import type { Language } from '@/services/localization/contracts';

/** Reads a saved language preference when one exists; English remains the safe default. */
export function useLanguage(): Language {
  const [language, setLanguage] = useState<Language>('en');
  useEffect(() => {
    let active = true;
    void localStore.get<{ language?: string; value?: string }>('app-config', 'language').then((saved) => {
      const value = saved?.language ?? saved?.value;
      if (active && (value === 'en' || value === 'hi')) setLanguage(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return language;
}
