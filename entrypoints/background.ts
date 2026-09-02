import {
  isCancelTranslationSessionMessage,
  isClearTranslationCacheMessage,
  isDeleteVideoGlossaryTermMessage,
  isGetTranslationCacheStatsMessage,
  isGetVideoGlossaryMessage,
  isTestProviderMessage,
  isTranslateWindowMessage,
  isUpsertVideoGlossaryTermMessage,
  TRANSLATION_PROGRESS_MESSAGE,
  type TranslateWindowMessage,
  type TranslateWindowResult,
  type TranslationProgressStage,
} from '../src/provider/messages';
import { readProviderSettings } from '../src/provider/settings';
import {
  resolveVideoEntityAliases,
  testProviderConnection,
  translateTokenWindow,
} from '../src/provider/chatCompletions';
import { ProviderError } from '../src/provider/types';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '../src/domain/subtitle/ai';
import {
  ENTITY_ALIAS_PROMPT_VERSION,
  type DisplayCue,
  type TranslationTerm,
} from '../src/domain/subtitle';
import { createTranslationCacheKey, TranslationCache } from '../src/cache/translationCache';
import { TranslationQueue } from '../src/provider/translationQueue';
import {
  clearVideoGlossary,
  deleteManualVideoGlossaryTerm,
  mergeVideoGlossary,
  readVideoGlossaryState,
  upsertManualVideoGlossaryTerm,
} from '../src/context/videoGlossary';
import {
  clearVideoEntityAliases,
  createEntityAliasFingerprint,
  readVideoEntityAliases,
  writeVideoEntityAliases,
} from '../src/context/videoEntityAliases';
import {
  GET_CONTENT_SETTINGS_MESSAGE,
  REFRESH_VIDEO_TRANSLATIONS_MESSAGE,
  SET_SUBTITLE_PREFERENCES_MESSAGE,
  UPDATE_SUBTITLE_PREFERENCES_MESSAGE,
} from '../src/platform/youtube/types';
import {
  readSubtitlePreferences,
  saveSubtitlePreferences,
  type SubtitlePreferences,
} from '../src/settings/subtitle';

const ENABLED_KEY = 'cueweave.enabled';
const translationCache = new TranslationCache();
const translationQueue = new TranslationQueue(2);
const translationSessionControllers = new Map<string, Set<AbortController>>();
const entityAliasResolutions = new Map<string, Promise<TranslationTerm[]>>();
let cacheGeneration = 0;

async function broadcastSubtitlePreferences(preferences: SubtitlePreferences): Promise<void> {
  const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            browser.tabs.sendMessage(tab.id, {
              type: SET_SUBTITLE_PREFERENCES_MESSAGE,
              preferences,
            }),
          ],
    ),
  );
}

async function broadcastVideoTranslationRefresh(videoId: string): Promise<void> {
  const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            browser.tabs.sendMessage(tab.id, {
              type: REFRESH_VIDEO_TRANSLATIONS_MESSAGE,
              videoId,
            }),
          ],
    ),
  );
}

async function refreshVideoAfterGlossaryChange(videoId: string): Promise<void> {
  cacheGeneration += 1;
  await translationCache.clearVideo(videoId).catch(() => undefined);
  await broadcastVideoTranslationRefresh(videoId);
}

function validTranslationTokens(tokens: unknown[]): boolean {
  return (
    tokens.length > 0 &&
    tokens.length <= 180 &&
    tokens.every(
      (token) =>
        typeof token === 'object' &&
        token !== null &&
        'id' in token &&
        typeof token.id === 'string' &&
        'cueId' in token &&
        typeof token.cueId === 'string' &&
        'text' in token &&
        typeof token.text === 'string' &&
        token.text.length <= 100 &&
        'startMs' in token &&
        typeof token.startMs === 'number' &&
        'endMs' in token &&
        typeof token.endMs === 'number',
    )
  );
}

function validTranslationContext(message: TranslateWindowMessage): boolean {
  return (
    message.context.videoId.length > 0 &&
    message.context.videoId.length <= 64 &&
    message.context.languageCode.length > 0 &&
    message.context.languageCode.length <= 32 &&
    message.context.windowId.length > 0 &&
    message.context.windowId.length <= 512 &&
    message.context.sessionId.length > 0 &&
    message.context.sessionId.length <= 128 &&
    (message.context.videoTitle?.length ?? 0) <= 200 &&
    (message.context.channelName?.length ?? 0) <= 120 &&
    (message.context.videoDescription?.length ?? 0) <= 1_200 &&
    (message.context.transcriptEvidence?.length ?? 0) <= 80 &&
    (message.context.transcriptEvidence ?? []).every((term) => term.length <= 96) &&
    (message.context.entityCandidates?.length ?? 0) <= 48 &&
    (message.context.entityCandidates ?? []).every(
      (candidate) =>
        candidate.observed.length > 0 &&
        candidate.observed.length <= 96 &&
        candidate.count > 0 &&
        candidate.count <= 100_000 &&
        candidate.contexts.length <= 3 &&
        candidate.contexts.every((context) => context.length > 0 && context.length <= 360),
    ) &&
    (message.previousCues?.length ?? 0) <= 6 &&
    (message.previousCues ?? []).every(
      (cue) => cue.sourceText.length <= 500 && cue.translation.length <= 500,
    )
  );
}

async function entityAliasesForMessage(
  message: TranslateWindowMessage,
  settings: Awaited<ReturnType<typeof readProviderSettings>>,
  manualTerminology: readonly TranslationTerm[],
  signal: AbortSignal,
  onResolveStart?: () => void,
): Promise<TranslationTerm[]> {
  const candidates = message.context.entityCandidates ?? [];
  if (candidates.length < 2 || message.context.correctionEnabled === false) return [];
  const fingerprint = await createEntityAliasFingerprint({
    version: ENTITY_ALIAS_PROMPT_VERSION,
    model: settings.model,
    protocol: settings.protocol,
    videoTitle: message.context.videoTitle ?? '',
    channelName: message.context.channelName ?? '',
    videoDescription: message.context.videoDescription ?? '',
    candidates,
    manualTerminology,
  });
  const resolutionKey = `${message.context.videoId}:${fingerprint}`;
  const cached = await readVideoEntityAliases(message.context.videoId, fingerprint).catch(
    () => undefined,
  );
  if (cached) return cached;
  const existing = entityAliasResolutions.get(resolutionKey);
  if (existing) {
    onResolveStart?.();
    return existing;
  }

  onResolveStart?.();
  const resolution = resolveVideoEntityAliases(
    settings,
    candidates,
    {
      ...(message.context.videoTitle ? { videoTitle: message.context.videoTitle } : {}),
      ...(message.context.channelName ? { channelName: message.context.channelName } : {}),
      ...(message.context.videoDescription
        ? { videoDescription: message.context.videoDescription }
        : {}),
      terminology: manualTerminology,
    },
    signal,
  )
    .then(async (aliases) => {
      await writeVideoEntityAliases(message.context.videoId, fingerprint, aliases).catch(
        () => undefined,
      );
      return aliases;
    })
    .finally(() => entityAliasResolutions.delete(resolutionKey));
  entityAliasResolutions.set(resolutionKey, resolution);
  return resolution;
}

async function rememberCueTerminology(videoId: string, cues: readonly DisplayCue[]): Promise<void> {
  const discoveredTerms = cues.flatMap((cue) => cue.terminology ?? []);
  if (discoveredTerms.length > 0) {
    await mergeVideoGlossary(videoId, discoveredTerms).catch(() => undefined);
  }
}

async function translateWindowMessage(
  message: TranslateWindowMessage,
  onProgress?: (stage: TranslationProgressStage) => void,
): Promise<TranslateWindowResult> {
  if (!validTranslationTokens(message.tokens) || !validTranslationContext(message)) {
    return {
      ok: false,
      error: {
        code: 'invalid-response',
        message: '字幕窗口格式无效。CueWeave 已保留原文字幕。',
      },
    };
  }

  const requestController = new AbortController();
  const sessionControllers = translationSessionControllers.get(message.context.sessionId);
  if (sessionControllers) sessionControllers.add(requestController);
  else translationSessionControllers.set(message.context.sessionId, new Set([requestController]));

  try {
    const settings = await readProviderSettings();
    const glossary = await readVideoGlossaryState(message.context.videoId).catch(() => ({
      terms: [],
      manualTerms: [],
    }));
    const entityAliases = await entityAliasesForMessage(
      message,
      settings,
      glossary.manualTerms,
      requestController.signal,
      () => onProgress?.('resolving-entities'),
    ).catch(() => []);
    const terminologyBySource = new Map(
      glossary.terms.map((term) => [term.source.toLocaleLowerCase(), term]),
    );
    for (const alias of entityAliases) {
      terminologyBySource.set(alias.source.toLocaleLowerCase(), alias);
    }
    for (const term of glossary.manualTerms) {
      terminologyBySource.set(term.source.toLocaleLowerCase(), term);
    }
    const terminology = [...terminologyBySource.values()];
    const cacheKey = await createTranslationCacheKey({
      ...message.context,
      baseUrl: settings.baseUrl,
      model: settings.model,
      protocol: settings.protocol,
      promptVersion: AI_PROMPT_VERSION,
      segmentationVersion: DISPLAY_SEGMENTATION_VERSION,
      tokens: message.tokens,
      ...(message.context.videoTitle ? { videoTitle: message.context.videoTitle } : {}),
      ...(message.context.channelName ? { channelName: message.context.channelName } : {}),
      ...(message.context.videoDescription
        ? { videoDescription: message.context.videoDescription }
        : {}),
      ...(message.context.transcriptEvidence
        ? { transcriptEvidence: message.context.transcriptEvidence }
        : {}),
      manualTerminology: glossary.manualTerms,
      entityAliases,
      correctionEnabled: message.context.correctionEnabled,
    });

    try {
      const cachedCues = await translationCache.get(cacheKey, message.context.videoId);
      if (cachedCues) {
        await rememberCueTerminology(message.context.videoId, cachedCues);
        return { ok: true, cues: cachedCues, cacheHit: true };
      }
    } catch {
      // IndexedDB failure must not block live translation.
    }

    const queueKey = `${cacheKey}:${message.context.sessionId}`;
    return await translationQueue.enqueue(queueKey, message.priority, async () => {
      if (requestController.signal.aborted) {
        throw new ProviderError('cancelled', '翻译请求已取消。');
      }
      try {
        const cachedCues = await translationCache.get(cacheKey, message.context.videoId);
        if (cachedCues) {
          await rememberCueTerminology(message.context.videoId, cachedCues);
          return { ok: true, cues: cachedCues, cacheHit: true } as const;
        }
      } catch {
        // A second cache read closes the race between identical queued requests.
      }

      const writeGeneration = cacheGeneration;
      const cues = await translateTokenWindow(
        settings,
        message.tokens,
        onProgress,
        requestController.signal,
        {
          ...(message.context.videoTitle ? { videoTitle: message.context.videoTitle } : {}),
          ...(message.context.channelName ? { channelName: message.context.channelName } : {}),
          ...(message.context.videoDescription
            ? { videoDescription: message.context.videoDescription }
            : {}),
          ...(message.context.transcriptEvidence
            ? { transcriptEvidence: message.context.transcriptEvidence }
            : {}),
          correctionEnabled: message.context.correctionEnabled,
          terminology,
          entityAliases,
          ...(message.previousCues ? { previousCues: message.previousCues } : {}),
        },
      );
      await rememberCueTerminology(message.context.videoId, cues);
      try {
        if (writeGeneration === cacheGeneration) {
          await translationCache.put(cacheKey, cues, message.context.videoId);
        }
      } catch {
        // Cache writes are best-effort; the verified translation is still usable.
      }
      return { ok: true, cues, cacheHit: false } as const;
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ProviderError
          ? { code: error.code, message: error.message }
          : {
              code: 'network',
              message: '字幕翻译请求失败。CueWeave 已保留原文字幕。',
            },
    };
  } finally {
    const controllers = translationSessionControllers.get(message.context.sessionId);
    controllers?.delete(requestController);
    if (controllers?.size === 0) {
      translationSessionControllers.delete(message.context.sessionId);
    }
  }
}

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  browser.runtime.onInstalled.addListener(async () => {
    const settings = await browser.storage.local.get([ENABLED_KEY]);
    if (settings[ENABLED_KEY] === undefined) {
      await browser.storage.local.set({ [ENABLED_KEY]: true });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === GET_CONTENT_SETTINGS_MESSAGE
    ) {
      return Promise.all([
        browser.storage.local.get([ENABLED_KEY]),
        readSubtitlePreferences(),
      ]).then(([stored, subtitlePreferences]) => ({
        enabled: stored[ENABLED_KEY] !== false,
        subtitlePreferences,
      }));
    }

    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === UPDATE_SUBTITLE_PREFERENCES_MESSAGE &&
      'preferences' in message
    ) {
      return saveSubtitlePreferences(message.preferences).then(async (preferences) => {
        await broadcastSubtitlePreferences(preferences);
        return { ok: true, preferences };
      });
    }

    if (isTestProviderMessage(message)) {
      return readProviderSettings()
        .then(testProviderConnection)
        .catch((error: unknown) => ({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : '模型连接测试失败。请检查 Provider 设置后重试。',
        }));
    }

    if (isCancelTranslationSessionMessage(message)) {
      const controllers = translationSessionControllers.get(message.sessionId);
      controllers?.forEach((controller) => controller.abort());
      translationSessionControllers.delete(message.sessionId);
      return Promise.resolve({ ok: true, cancelled: controllers?.size ?? 0 });
    }

    if (isGetTranslationCacheStatsMessage(message)) {
      return translationCache
        .getStats(message.videoId)
        .then((stats) => ({ ok: true, stats }))
        .catch(() => ({
          ok: false,
          message: '无法读取翻译缓存，请重新加载扩展后再试。',
        }));
    }

    if (isClearTranslationCacheMessage(message)) {
      cacheGeneration += 1;
      return Promise.all([
        message.videoId
          ? translationCache.clearVideo(message.videoId)
          : translationCache.clear().then(() => undefined),
        clearVideoGlossary(message.videoId),
        clearVideoEntityAliases(message.videoId),
      ])
        .then(async ([removedEntries]) => ({
          ok: true,
          removedEntries,
          stats: await translationCache.getStats(message.videoId),
        }))
        .catch(() => ({
          ok: false,
          message: '缓存未能清除，请重新加载扩展后再试。',
        }));
    }

    if (isGetVideoGlossaryMessage(message)) {
      return readVideoGlossaryState(message.videoId)
        .then((glossary) => ({ ok: true, glossary }))
        .catch(() => ({ ok: false, message: '无法读取当前视频术语。' }));
    }

    if (isUpsertVideoGlossaryTermMessage(message)) {
      return upsertManualVideoGlossaryTerm(message.videoId, message.term)
        .then(async () => {
          await refreshVideoAfterGlossaryChange(message.videoId);
          return { ok: true, glossary: await readVideoGlossaryState(message.videoId) };
        })
        .catch(() => ({ ok: false, message: '术语未能保存，请重新加载扩展后再试。' }));
    }

    if (isDeleteVideoGlossaryTermMessage(message)) {
      return deleteManualVideoGlossaryTerm(message.videoId, message.source)
        .then(async () => {
          await refreshVideoAfterGlossaryChange(message.videoId);
          return { ok: true, glossary: await readVideoGlossaryState(message.videoId) };
        })
        .catch(() => ({ ok: false, message: '术语未能删除，请重新加载扩展后再试。' }));
    }

    if (isTranslateWindowMessage(message)) {
      return translateWindowMessage(message, (stage) => {
        if (sender.tab?.id === undefined) return;
        void browser.tabs
          .sendMessage(sender.tab.id, {
            type: TRANSLATION_PROGRESS_MESSAGE,
            windowId: message.context.windowId,
            stage,
          })
          .catch(() => undefined);
      });
    }

    return undefined;
  });
});
