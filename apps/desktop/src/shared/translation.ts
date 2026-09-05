export const TARGET_LANGUAGES = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
} as const;
export type TargetLanguage = keyof typeof TARGET_LANGUAGES;
export type TranslationState = 'running' | 'cancelled' | 'interrupted' | 'failed' | 'completed';
export interface TranslationSnapshot {
  id: string;
  targetLanguage: TargetLanguage;
  state: TranslationState;
  completed: number;
  total: number;
  error: string;
  cues: Record<string, string>;
  manualCueIds: string[];
  canUndo: boolean;
  canRedo: boolean;
}
export function validTranslationText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 20000 &&
    !value.includes('\u0000') &&
    !/\n\s*\n/.test(value)
  );
}
