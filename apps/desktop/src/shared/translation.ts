import type { TargetLanguage } from '@cueweave/core/provider/cueTypes';
export {
  TARGET_LANGUAGES,
  validTranslationText,
  type TargetLanguage,
} from '@cueweave/core/provider/cueTypes';
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
