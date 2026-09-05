import type { TranslationPriority, TranslationProgressStage } from '@cueweave/core/provider/types';
import type {
  DisplayCue,
  SourceToken,
  TranscriptEntityCandidate,
  TranslationTerm,
} from '@cueweave/core/subtitle';
import type { ProviderFailure, ProviderTestResult } from '@cueweave/core/provider/types';
import type { PlanSnapshot } from '@cueweave/core/provider/playbackPlan';

export const OPEN_PLAYBACK_PLAN_MESSAGE = 'cueweave:open-playback-plan';
export const PREPARE_PLAYBACK_WINDOW_MESSAGE = 'cueweave:prepare-playback-window';
export const PROMOTE_PLAYBACK_WINDOW_MESSAGE = 'cueweave:promote-playback-window';
export interface PromotePlaybackWindowMessage {
  type: typeof PROMOTE_PLAYBACK_WINDOW_MESSAGE;
  sessionId: string;
  windowId: string;
}
export function isPromotePlaybackWindowMessage(
  value: unknown,
): value is PromotePlaybackWindowMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as PromotePlaybackWindowMessage;
  return (
    message.type === PROMOTE_PLAYBACK_WINDOW_MESSAGE &&
    typeof message.sessionId === 'string' &&
    message.sessionId.length > 0 &&
    message.sessionId.length <= 128 &&
    typeof message.windowId === 'string' &&
    /^playback:\d{1,6}$/u.test(message.windowId)
  );
}
export interface OpenPlaybackPlanMessage {
  type: typeof OPEN_PLAYBACK_PLAN_MESSAGE;
  videoId: string;
  languageCode: string;
  tokens: SourceToken[];
}
export interface PreparePlaybackWindowMessage {
  type: typeof PREPARE_PLAYBACK_WINDOW_MESSAGE;
  key: string;
  index: number;
  sessionId: string;
  priority: TranslationPriority;
}
export type PlaybackPlanResult =
  | { ok: true; key: string; snapshot: PlanSnapshot }
  | { ok: false; error: ProviderFailure; expired?: boolean };

export function validSourceTokens(value: unknown, max = 100_000): value is SourceToken[] {
  if (!Array.isArray(value) || !value.length || value.length > max) return false;
  const ids = new Set<string>();
  return value.every((t) => {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof t.id !== 'string' ||
      !t.id ||
      t.id.length > 256 ||
      ids.has(t.id) ||
      typeof t.cueId !== 'string' ||
      t.cueId.length > 256 ||
      typeof t.text !== 'string' ||
      !t.text ||
      t.text.length > 100 ||
      !Number.isFinite(t.startMs) ||
      !Number.isFinite(t.endMs) ||
      t.startMs < 0 ||
      t.endMs <= t.startMs
    )
      return false;
    ids.add(t.id);
    return true;
  });
}
export function isOpenPlaybackPlanMessage(value: unknown): value is OpenPlaybackPlanMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as OpenPlaybackPlanMessage;
  return (
    v.type === OPEN_PLAYBACK_PLAN_MESSAGE &&
    typeof v.videoId === 'string' &&
    v.videoId.length > 0 &&
    v.videoId.length <= 64 &&
    typeof v.languageCode === 'string' &&
    v.languageCode.length > 0 &&
    v.languageCode.length <= 32 &&
    validSourceTokens(v.tokens)
  );
}
export function isPreparePlaybackWindowMessage(
  value: unknown,
): value is PreparePlaybackWindowMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as PreparePlaybackWindowMessage;
  return (
    v.type === PREPARE_PLAYBACK_WINDOW_MESSAGE &&
    typeof v.key === 'string' &&
    /^cueweave\.playback-plan\.[a-f0-9]{64}$/u.test(v.key) &&
    Number.isSafeInteger(v.index) &&
    v.index >= 0 &&
    v.index < 100_000 &&
    typeof v.sessionId === 'string' &&
    v.sessionId.length > 0 &&
    v.sessionId.length <= 128 &&
    (v.priority === 'current' || v.priority === 'prefetch')
  );
}

export const TEST_PROVIDER_MESSAGE = 'cueweave:test-provider';
export const TRANSLATE_WINDOW_MESSAGE = 'cueweave:translate-window';
export const TRANSLATION_PROGRESS_MESSAGE = 'cueweave:translation-progress';
export const CANCEL_TRANSLATION_SESSION_MESSAGE = 'cueweave:cancel-translation-session';
export const GET_TRANSLATION_CACHE_STATS_MESSAGE = 'cueweave:get-translation-cache-stats';
export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'cueweave:clear-translation-cache';
export const GET_VIDEO_GLOSSARY_MESSAGE = 'cueweave:get-video-glossary';
export const UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE = 'cueweave:upsert-video-glossary-term';
export const DELETE_VIDEO_GLOSSARY_TERM_MESSAGE = 'cueweave:delete-video-glossary-term';

export type { TranslationPriority, TranslationProgressStage } from '@cueweave/core/provider/types';

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
  neighbors?: { before: string; after: string };
}

export interface TranslationProgressMessage {
  type: typeof TRANSLATION_PROGRESS_MESSAGE;
  windowId: string;
  stage: TranslationProgressStage;
  sessionId?: string;
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
    (!('neighbors' in value) ||
      value.neighbors === undefined ||
      (typeof value.neighbors === 'object' &&
        value.neighbors !== null &&
        'before' in value.neighbors &&
        typeof value.neighbors.before === 'string' &&
        value.neighbors.before.length <= 10_000 &&
        'after' in value.neighbors &&
        typeof value.neighbors.after === 'string' &&
        value.neighbors.after.length <= 10_000)) &&
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
