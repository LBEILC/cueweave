import {
  isCancelTranslationSessionMessage,
  isClearTranslationCacheMessage,
  isDeleteVideoGlossaryTermMessage,
  isGetTranslationCacheStatsMessage,
  isGetVideoGlossaryMessage,
  isTestProviderMessage,
  isTranslateWindowMessage,
  isUpsertVideoGlossaryTermMessage,
  isOpenPlaybackPlanMessage,
  isPreparePlaybackWindowMessage,
  isPromotePlaybackWindowMessage,
  validSourceTokens,
  TRANSLATION_PROGRESS_MESSAGE,
  type TranslateWindowMessage,
  type TranslateWindowResult,
  type TranslationProgressStage,
} from '../src/provider/messages';
import { readProviderSettings } from '../src/provider/settings';
import {
  resolveVideoEntityAliases,
  createSubtitleJsonRequest,
  testProviderConnection,
  translatePlaybackWindow,
  PartialTranslationError,
} from '../src/provider/chatCompletions';
import { FIRST_PASS_VERSION } from '@cueweave/core/provider/firstPass';
import { PLAYBACK_PLAN_VERSION } from '@cueweave/core/provider/playbackPlan';
import { PlaybackPlans } from '../src/cache/playbackPlans';
import { ProviderError } from '@cueweave/core/provider/types';
import type { ProviderRuntime } from '@cueweave/core/provider/runtime';
import { DebugRecorder, type DebugCapture } from '../src/debug/recorder';
import { exportDebugReport, exportFailure } from '../src/debug/background';
import { debugError } from '../src/debug/redact';
import { videoIdFromYouTubeUrl } from '../src/platform/youtube/navigation';
import {
  GET_DEBUG_STATE,
  SET_DEBUG_STATE,
  DEBUG_ENABLED_CHANGED,
  RECORD_DEBUG_EVENT,
  EXPORT_DEBUG_REPORT,
} from '../src/debug/types';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '@cueweave/core/subtitle/ai';
import {
  ENTITY_ALIAS_PROMPT_VERSION,
  type DisplayCue,
  type TranslationTerm,
} from '@cueweave/core/subtitle';
import { createTranslationCacheKey, TranslationCache } from '../src/cache/translationCache';
import { TranslationQueue } from '@cueweave/core/provider/translationQueue';
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
  UPDATE_SUBTITLE_DISPLAY_MODE_MESSAGE,
} from '../src/platform/youtube/types';
import {
  readSubtitlePreferences,
  saveSubtitlePreferences,
  saveSubtitleDisplayMode,
  type SubtitlePreferences,
} from '../src/settings/subtitle';

const ENABLED_KEY = 'cueweave.enabled';
const translationCache = new TranslationCache();
const translationQueue = new TranslationQueue(2);
const translationSessionControllers = new Map<string, Set<AbortController>>();
const entityAliasResolutions = new Map<string, Promise<TranslationTerm[]>>();
let cacheGeneration = 0;
let playbackPlans: PlaybackPlans;
let debugRecorder: DebugRecorder;

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
  runtime: ProviderRuntime = {},
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
    runtime,
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
  tabId?: number,
): Promise<TranslateWindowResult> {
  if (
    !validTranslationTokens(message.tokens) ||
    !validSourceTokens(message.tokens, 180) ||
    !validTranslationContext(message)
  ) {
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

  let debug: DebugCapture = { runtime: {}, record: async () => {} };
  try {
    const settings = await readProviderSettings();
    debug = await debugRecorder.capture(
      {
        videoId: message.context.videoId,
        sessionId: message.context.sessionId,
        windowId: message.context.windowId,
        startMs: message.tokens[0]!.startMs,
        endMs: message.tokens.at(-1)!.endMs,
        ...(tabId !== undefined ? { tabId } : {}),
        operation: 'translation',
      },
      settings,
    );
    const glossary = await readVideoGlossaryState(message.context.videoId).catch(() => ({
      terms: [],
      manualTerms: [],
    }));
    const entityAliases = await entityAliasesForMessage(
      message,
      settings,
      glossary.manualTerms,
      requestController.signal,
      () => {
        onProgress?.('resolving-entities');
        debug.runtime.onDiagnostic?.({ kind: 'stage', message: 'entities' });
      },
      debug.runtime,
    ).catch(async (error: unknown) => {
      await debug.record('entity-fallback', debugError(error));
      return [];
    });
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
    await debug.record('window-context', {
      tokens: message.tokens,
      context: message.context,
      neighbors: message.neighbors,
      previousCues: message.previousCues,
      terminology,
      manualTerms: glossary.manualTerms,
      entityAliases,
      provider: { model: settings.model, baseUrl: settings.baseUrl, protocol: settings.protocol },
    });
    const cacheKey = await createTranslationCacheKey({
      ...message.context,
      baseUrl: settings.baseUrl,
      model: settings.model,
      protocol: settings.protocol,
      promptVersion: `${AI_PROMPT_VERSION}:${FIRST_PASS_VERSION}`,
      segmentationVersion: `${DISPLAY_SEGMENTATION_VERSION}:${PLAYBACK_PLAN_VERSION}`,
      tokens: message.tokens,
      ...(message.neighbors ? { neighbors: message.neighbors } : {}),
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
        await debug.record('window-result', { cacheHit: true, cacheKey, cues: cachedCues });
        await rememberCueTerminology(message.context.videoId, cachedCues);
        return { ok: true, cues: cachedCues, cacheHit: true };
      }
    } catch (error) {
      await debug.record('cache-read-failure', debugError(error));
      // IndexedDB failure must not block live translation.
    }

    const queueKey = `${cacheKey}:${message.context.sessionId}`;
    const queuedAt = Date.now();
    await debug.record('queued', { priority: message.priority, cacheKey });
    return await translationQueue.enqueue(
      queueKey,
      message.priority,
      async () => {
        await debug.record('queue-start', { waitMs: Date.now() - queuedAt });
        if (requestController.signal.aborted) {
          throw new ProviderError('cancelled', '翻译请求已取消。');
        }
        try {
          const cachedCues = await translationCache.get(cacheKey, message.context.videoId);
          if (cachedCues) {
            await debug.record('window-result', { cacheHit: true, cacheKey, cues: cachedCues });
            await rememberCueTerminology(message.context.videoId, cachedCues);
            return { ok: true, cues: cachedCues, cacheHit: true } as const;
          }
        } catch {
          // A second cache read closes the race between identical queued requests.
        }

        const writeGeneration = cacheGeneration;
        const cues = await translatePlaybackWindow(
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
          message.neighbors,
          debug.runtime,
        );
        await debug.record('window-result', { cacheHit: false, cacheKey, cues });
        await rememberCueTerminology(message.context.videoId, cues);
        try {
          if (writeGeneration === cacheGeneration) {
            await translationCache.put(cacheKey, cues, message.context.videoId);
          }
        } catch (error) {
          await debug.record('cache-write-failure', debugError(error));
          // Cache writes are best-effort; the verified translation is still usable.
        }
        return { ok: true, cues, cacheHit: false } as const;
      },
      `${message.context.sessionId}:${message.context.windowId}`,
    );
  } catch (error) {
    await debug.record('window-failure', debugError(error));
    return {
      ok: false,
      ...(error instanceof PartialTranslationError
        ? { cues: error.cues, missingTokenIds: error.missingTokenIds }
        : {}),
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
  playbackPlans = new PlaybackPlans(browser.storage.local);
  debugRecorder = new DebugRecorder(browser.storage.local);
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  browser.runtime.onInstalled.addListener(async () => {
    const settings = await browser.storage.local.get([ENABLED_KEY]);
    if (settings[ENABLED_KEY] === undefined) {
      await browser.storage.local.set({ [ENABLED_KEY]: true });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (message && typeof message === 'object' && 'type' in message) {
      if ([GET_DEBUG_STATE, SET_DEBUG_STATE, EXPORT_DEBUG_REPORT].includes(String(message.type))) {
        if (!sender.url?.startsWith(browser.runtime.getURL('/')))
          return Promise.resolve({ ok: false, message: '请从扩展设置或弹窗操作调试日志。' });
        if (message.type === GET_DEBUG_STATE)
          return debugRecorder
            .read()
            .then((state) => ({ ok: true, enabled: state.enabled }))
            .catch(() => ({ ok: false, message: '无法读取调试设置，请重新打开设置页面。' }));
        if (
          message.type === SET_DEBUG_STATE &&
          'enabled' in message &&
          typeof message.enabled === 'boolean'
        )
          return debugRecorder
            .setEnabled(message.enabled)
            .then(async (state) => {
              const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
              await Promise.allSettled(
                tabs.flatMap((tab) =>
                  tab.id === undefined
                    ? []
                    : [
                        browser.tabs.sendMessage(tab.id, {
                          type: DEBUG_ENABLED_CHANGED,
                          enabled: state.enabled,
                        }),
                      ],
                ),
              );
              return { ok: true, enabled: state.enabled };
            })
            .catch(() => ({ ok: false, message: '调试设置未能保存，请重新打开设置页面后再试。' }));
        if (
          message.type === EXPORT_DEBUG_REPORT &&
          'tabId' in message &&
          typeof message.tabId === 'number' &&
          Number.isSafeInteger(message.tabId) &&
          message.tabId >= 0
        )
          return exportDebugReport(debugRecorder, message.tabId).catch(exportFailure);
        return Promise.resolve({ ok: false, message: '调试请求格式无效，请重新打开弹窗。' });
      }
      if (message.type === RECORD_DEBUG_EVENT) {
        const event = message as Record<string, unknown>;
        const videoId = videoIdFromYouTubeUrl(sender.tab?.url ?? '');
        if (
          sender.tab?.id === undefined ||
          (sender.frameId ?? 0) !== 0 ||
          !videoId ||
          event.videoId !== videoId ||
          typeof event.sessionId !== 'string' ||
          event.sessionId.length > 128 ||
          typeof event.event !== 'string' ||
          event.event.length > 64 ||
          !event.details ||
          typeof event.details !== 'object' ||
          JSON.stringify(event.details).length > 12_000
        )
          return Promise.resolve({ ok: false });
        const details = event.details as Record<string, unknown>;
        const scope = {
          videoId,
          tabId: sender.tab.id,
          sessionId: event.sessionId,
          ...(typeof details.startMs === 'number' ? { startMs: details.startMs } : {}),
          ...(typeof details.endMs === 'number' ? { endMs: details.endMs } : {}),
        };
        return readProviderSettings()
          .then((settings) => debugRecorder.capture(scope, settings))
          .then((capture) => capture.record('player-event', { event: event.event, ...details }))
          .catch(() => undefined)
          .then(() => ({ ok: true }));
      }
    }
    if (isPromotePlaybackWindowMessage(message)) {
      return Promise.resolve({
        ok: true,
        promoted: translationQueue.promoteGroup(`${message.sessionId}:${message.windowId}`),
      });
    }
    if (isOpenPlaybackPlanMessage(message)) {
      return readProviderSettings()
        .then((settings) =>
          playbackPlans.open(message.videoId, message.languageCode, message.tokens, settings),
        )
        .then((plan) => ({ ok: true, ...plan }))
        .catch(() => ({
          ok: false,
          error: { code: 'invalid-response', message: '无法准备字幕窗口，请重试此处。' },
        }));
    }
    if (isPreparePlaybackWindowMessage(message)) {
      const plan = playbackPlans.get(message.key);
      if (!plan)
        return Promise.resolve({
          ok: false,
          expired: true,
          error: { code: 'invalid-response', message: '字幕规划会话已过期，正在恢复。' },
        });
      const controller = new AbortController();
      const controllers =
        translationSessionControllers.get(message.sessionId) ?? new Set<AbortController>();
      controllers.add(controller);
      translationSessionControllers.set(message.sessionId, controllers);
      const progress = (stage: TranslationProgressStage) => {
        if (sender.tab?.id === undefined) return;
        void browser.tabs
          .sendMessage(sender.tab.id, {
            type: TRANSLATION_PROGRESS_MESSAGE,
            windowId: `playback:${message.index}`,
            sessionId: message.sessionId,
            stage,
          })
          .catch(() => undefined);
      };
      const savePlan = playbackPlans.saver(message.key);
      return translationQueue
        .enqueue(
          `plan:${message.key}:${message.index}:${message.sessionId}`,
          message.priority,
          async () => {
            const settings = await readProviderSettings();
            const target = plan.window(message.index);
            const debug = await debugRecorder.capture(
              {
                videoId: playbackPlans.videoId(message.key) ?? '',
                sessionId: message.sessionId,
                ...(sender.tab?.id !== undefined ? { tabId: sender.tab.id } : {}),
                windowId: target.id,
                startMs: target.startMs,
                endMs: target.endMs,
                operation: 'planning',
              },
              settings,
            );
            await debug.record('plan-before', plan.snapshot());
            progress('planning');
            await plan.prepare(
              message.index,
              createSubtitleJsonRequest(settings, controller.signal, progress, debug.runtime),
              controller.signal,
              async (snapshot) => {
                await savePlan(snapshot).catch(() => undefined);
              },
              (diagnostic) => {
                void debug.record('planning-fallback', { diagnostic });
                console.info('[CueWeave] planning-fallback', {
                  windowIndex: message.index,
                  diagnostic,
                });
              },
            );
            await debug.record('plan-after', plan.snapshot());
            return { ok: true, key: message.key, snapshot: plan.snapshot() };
          },
          `${message.sessionId}:playback:${message.index}`,
        )
        .catch((error: unknown) => ({
          ok: false,
          error:
            error instanceof ProviderError
              ? { code: error.code, message: error.message }
              : { code: 'invalid-response', message: '字幕窗口规划失败，请重试此处。' },
        }))
        .finally(() => {
          controllers.delete(controller);
          if (!controllers.size) translationSessionControllers.delete(message.sessionId);
        });
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === GET_CONTENT_SETTINGS_MESSAGE
    ) {
      return Promise.all([
        browser.storage.local.get([ENABLED_KEY]),
        readSubtitlePreferences(),
        debugRecorder.read().catch(() => null),
      ]).then(([stored, subtitlePreferences, debug]) => ({
        enabled: stored[ENABLED_KEY] !== false,
        subtitlePreferences,
        debugEnabled: debug?.enabled === true,
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

    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === UPDATE_SUBTITLE_DISPLAY_MODE_MESSAGE &&
      'displayMode' in message &&
      (message.displayMode === 'bilingual' ||
        message.displayMode === 'source' ||
        message.displayMode === 'translation')
    ) {
      return saveSubtitleDisplayMode(message.displayMode).then(async (preferences) => {
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
        playbackPlans.clear(message.videoId),
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
      return translateWindowMessage(
        message,
        (stage) => {
          if (sender.tab?.id === undefined) return;
          void browser.tabs
            .sendMessage(sender.tab.id, {
              type: TRANSLATION_PROGRESS_MESSAGE,
              windowId: message.context.windowId,
              sessionId: message.context.sessionId,
              stage,
            })
            .catch(() => undefined);
        },
        sender.tab?.id,
      );
    }

    return undefined;
  });
});
