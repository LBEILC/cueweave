export const CUE_TRANSLATION_VERSION = 'preserve-cue-v1';
export interface TranslationCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
export const TARGET_LANGUAGES = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
} as const;
export type TargetLanguage = keyof typeof TARGET_LANGUAGES;
export function validTranslationText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 20000 &&
    !value.includes('\u0000') &&
    !/\n\s*\n/.test(value)
  );
}
