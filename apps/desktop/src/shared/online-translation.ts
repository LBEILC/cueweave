import type { TranslationCue } from '@cueweave/core/provider/cueTranslation';
import { TARGET_LANGUAGES, type TargetLanguage } from './translation';

export interface OnlineSubtitleSource {
  name: string;
  content: string;
  sourceId: string;
  cues: TranslationCue[];
}
export interface OnlineTranslationSnapshot {
  sourceId: string;
  state: 'idle' | 'translating' | 'ready' | 'paused' | 'failed';
  targetLanguage: TargetLanguage;
  completed: number;
  total: number;
  translations: Record<string, string>;
  error: string;
}
export type OnlineTranslationCommand =
  | { action: 'start'; sourceId: string; positionMs: number; targetLanguage: TargetLanguage }
  | { action: 'tick'; sourceId: string; positionMs: number }
  | { action: 'stop'; sourceId: string };

export function validOnlineTranslationCommand(value: unknown): value is OnlineTranslationCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sourceId !== 'string' || !/^[a-f\d-]{36}$/i.test(v.sourceId)) return false;
  const keys = Object.keys(v).sort().join(',');
  if (v.action === 'stop') return keys === 'action,sourceId';
  if (
    typeof v.positionMs !== 'number' ||
    !Number.isSafeInteger(v.positionMs) ||
    v.positionMs < 0 ||
    v.positionMs > 604800000
  )
    return false;
  if (v.action === 'tick') return keys === 'action,positionMs,sourceId';
  return (
    v.action === 'start' &&
    keys === 'action,positionMs,sourceId,targetLanguage' &&
    typeof v.targetLanguage === 'string' &&
    Object.hasOwn(TARGET_LANGUAGES, v.targetLanguage)
  );
}
