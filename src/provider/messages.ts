import type { DisplayCue, SourceToken } from '../domain/subtitle';
import type { ProviderFailure, ProviderTestResult } from './types';

export const TEST_PROVIDER_MESSAGE = 'cueweave:test-provider';
export const TRANSLATE_WINDOW_MESSAGE = 'cueweave:translate-window';
export const TRANSLATION_PROGRESS_MESSAGE = 'cueweave:translation-progress';

export type TranslationPriority = 'current' | 'prefetch';
export type TranslationProgressStage = 'translating' | 'repairing-boundaries' | 'repairing-output';

export interface TranslationContext {
  videoId: string;
  languageCode: string;
  windowId: string;
}

export interface TestProviderMessage {
  type: typeof TEST_PROVIDER_MESSAGE;
}

export interface TranslateWindowMessage {
  type: typeof TRANSLATE_WINDOW_MESSAGE;
  tokens: SourceToken[];
  context: TranslationContext;
  priority: TranslationPriority;
}

export interface TranslationProgressMessage {
  type: typeof TRANSLATION_PROGRESS_MESSAGE;
  windowId: string;
  stage: TranslationProgressStage;
}

export type TranslateWindowResult =
  { ok: true; cues: DisplayCue[]; cacheHit: boolean } | { ok: false; error: ProviderFailure };

export type TestProviderResult = ProviderTestResult;

export function isTestProviderMessage(value: unknown): value is TestProviderMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === TEST_PROVIDER_MESSAGE
  );
}

export function isTranslateWindowMessage(value: unknown): value is TranslateWindowMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === TRANSLATE_WINDOW_MESSAGE &&
    'tokens' in value &&
    Array.isArray(value.tokens) &&
    'priority' in value &&
    (value.priority === 'current' || value.priority === 'prefetch') &&
    'context' in value &&
    typeof value.context === 'object' &&
    value.context !== null &&
    'videoId' in value.context &&
    typeof value.context.videoId === 'string' &&
    'languageCode' in value.context &&
    typeof value.context.languageCode === 'string' &&
    'windowId' in value.context &&
    typeof value.context.windowId === 'string'
  );
}
