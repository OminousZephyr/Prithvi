export type Language = 'en' | 'hi';
export interface Translator { language: Language; setLanguage(language: Language): void; t(key: string): string }
