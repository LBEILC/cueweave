import type {
  DisplayCue,
  SourceToken,
  TranscriptEntityCandidate,
  TranslationTerm,
} from '../domain/subtitle';
import type { ProviderFailure, ProviderTestResult } from './types';

export const TEST_PROVIDER_MESSAGE = 'cueweave:test-provider';
export const TRANSLATE_WINDOW_MESSAGE = 'cueweave:translate-window';
export const TRANSLATION_PROGRESS_MESSAGE = 'cueweave:translation-progress';
export const CANCEL_TRANSLATION_SESSION_MESSAGE = 'cueweave:cancel-translation-session';
export const GET_TRANSLATION_CACHE_STATS_MESSAGE = 'cueweave:get-translation-cache-stats';
export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'cueweave:clear-translation-cache';
export const GET_VIDEO_GLOSSARY_MESSAGE = 'cueweave:get-video-glossary';
export const UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE = 'cueweave:upsert-video-glossary-term';
export const DELETE_VIDEO_GLOSSARY_TERM_MESSAGE = 'cueweave:delete-video-glossary-term';

export type TranslationPriority = 'current' | 'prefetch';
export type TranslationProgressStage =
  'resolving-entities' | 'translating' | 'repairing-boundaries' | 'repairing-output';

export interface TranslationContext {
  videoId: string;
  languageCode: string;
  windowId: string;
  sessionId: string;
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  transcriptEvidence?: string[];
  entityCandidates?: TranscriptEntityCandidate[];
  correctionEnabled: boolean;
}

export interface CancelTranslationSessionMessage {
  type: typeof CANCEL_TRANSLATION_SESSION_MESSAGE;
  sessionId: string;
}

export interface TestProviderMessage {
  type: typeof TEST_PROVIDER_MESSAGE;
}

export interface TranslateWindowMessage {
  type: typeof TRANSLATE_WINDOW_MESSAGE;
  tokens: SourceToken[];
  context: TranslationContext;
  priority: TranslationPriority;
  previousCues?: Array<{ sourceText: string; translation: string }>;
}

export interface TranslationProgressMessage {
  type: typeof TRANSLATION_PROGRESS_MESSAGE;
  windowId: string;
  stage: TranslationProgressStage;
}

export type TranslateWindowResult =
  { ok: true; cues: DisplayCue[]; cacheHit: boolean } | { ok: false; error: ProviderFailure };

export type TestProviderResult = ProviderTestResult;

export function isCancelTranslationSessionMessage(
  value: unknown,
): value is CancelTranslationSessionMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === CANCEL_TRANSLATION_SESSION_MESSAGE &&
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= 128
  );
}

export interface GetTranslationCacheStatsMessage {
  type: typeof GET_TRANSLATION_CACHE_STATS_MESSAGE;
  videoId?: string;
}

export interface ClearTranslationCacheMessage {
  type: typeof CLEAR_TRANSLATION_CACHE_MESSAGE;
  videoId?: string;
}

export interface GetVideoGlossaryMessage {
  type: typeof GET_VIDEO_GLOSSARY_MESSAGE;
  videoId: string;
}

export interface UpsertVideoGlossaryTermMessage {
  type: typeof UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE;
  videoId: string;
  term: TranslationTerm;
}

export interface DeleteVideoGlossaryTermMessage {
  type: typeof DELETE_VIDEO_GLOSSARY_TERM_MESSAGE;
  videoId: string;
  source: string;
}

function validGlossaryVideoId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function validGlossaryText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 96;
}

export function isGetVideoGlossaryMessage(value: unknown): value is GetVideoGlossaryMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === GET_VIDEO_GLOSSARY_MESSAGE &&
    'videoId' in value &&
    validGlossaryVideoId(value.videoId)
  );
}

export function isUpsertVideoGlossaryTermMessage(
  value: unknown,
): value is UpsertVideoGlossaryTermMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE &&
    'videoId' in value &&
    validGlossaryVideoId(value.videoId) &&
    'term' in value &&
    typeof value.term === 'object' &&
    value.term !== null &&
    'source' in value.term &&
    validGlossaryText(value.term.source) &&
    'translation' in value.term &&
    validGlossaryText(value.term.translation)
  );
}

export function isDeleteVideoGlossaryTermMessage(
  value: unknown,
): value is DeleteVideoGlossaryTermMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === DELETE_VIDEO_GLOSSARY_TERM_MESSAGE &&
    'videoId' in value &&
    validGlossaryVideoId(value.videoId) &&
    'source' in value &&
    validGlossaryText(value.source)
  );
}

export function isGetTranslationCacheStatsMessage(
  value: unknown,
): value is GetTranslationCacheStatsMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === GET_TRANSLATION_CACHE_STATS_MESSAGE &&
    (!('videoId' in value) || value.videoId === undefined || typeof value.videoId === 'string')
  );
}

export function isClearTranslationCacheMessage(
  value: unknown,
): value is ClearTranslationCacheMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === CLEAR_TRANSLATION_CACHE_MESSAGE &&
    (!('videoId' in value) || value.videoId === undefined || typeof value.videoId === 'string')
  );
}

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
    typeof value.context.windowId === 'string' &&
    'sessionId' in value.context &&
    typeof value.context.sessionId === 'string' &&
    'correctionEnabled' in value.context &&
    typeof value.context.correctionEnabled === 'boolean' &&
    (!('videoTitle' in value.context) ||
      value.context.videoTitle === undefined ||
      typeof value.context.videoTitle === 'string') &&
    (!('channelName' in value.context) ||
      value.context.channelName === undefined ||
      typeof value.context.channelName === 'string') &&
    (!('videoDescription' in value.context) ||
      value.context.videoDescription === undefined ||
      typeof value.context.videoDescription === 'string') &&
    (!('transcriptEvidence' in value.context) ||
      value.context.transcriptEvidence === undefined ||
      (Array.isArray(value.context.transcriptEvidence) &&
        value.context.transcriptEvidence.every((term) => typeof term === 'string'))) &&
    (!('entityCandidates' in value.context) ||
      value.context.entityCandidates === undefined ||
      (Array.isArray(value.context.entityCandidates) &&
        value.context.entityCandidates.every(
          (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            'observed' in candidate &&
            typeof candidate.observed === 'string' &&
            'count' in candidate &&
            typeof candidate.count === 'number' &&
            Number.isInteger(candidate.count) &&
            'contexts' in candidate &&
            Array.isArray(candidate.contexts) &&
            candidate.contexts.every((context: unknown) => typeof context === 'string'),
        ))) &&
    (!('previousCues' in value) ||
      value.previousCues === undefined ||
      (Array.isArray(value.previousCues) &&
        value.previousCues.every(
          (cue) =>
            typeof cue === 'object' &&
            cue !== null &&
            'sourceText' in cue &&
            typeof cue.sourceText === 'string' &&
            'translation' in cue &&
            typeof cue.translation === 'string',
        )))
  );
}
