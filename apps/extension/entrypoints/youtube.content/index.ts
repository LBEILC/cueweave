import {
  createSubtitleOverlay,
  applyOverlayPreferences,
  type SubtitleOverlay,
} from '../../src/ui/player-overlay';
import {
  buildSourceTokens,
  createLocalDisplayCues,
  createTokenWindows,
  extractTranscriptEntityCandidates,
  extractTranscriptEvidenceTerms,
  type DisplayCue,
  type RawCue,
  type SourceToken,
  type TokenWindow,
} from '@cueweave/core/subtitle';
import {
  CANCEL_TRANSLATION_SESSION_MESSAGE,
  TRANSLATE_WINDOW_MESSAGE,
  TRANSLATION_PROGRESS_MESSAGE,
  PROMOTE_PLAYBACK_WINDOW_MESSAGE,
  type TranslationPriority,
  type TranslateWindowResult,
} from '../../src/provider/messages';
import {
  CAPTION_TRACK_REQUEST_EVENT,
  CAPTION_TRACK_RESPONSE_EVENT,
  CAPTION_TRACKS_EVENT,
  CAPTION_TRACKS_REQUEST_EVENT,
  GET_CONTENT_SETTINGS_MESSAGE,
  GET_CONTENT_STATE_MESSAGE,
  GET_TRANSCRIPT_REPORT_MESSAGE,
  REFRESH_VIDEO_TRANSLATIONS_MESSAGE,
  SET_CONTENT_ENABLED_MESSAGE,
  SET_SUBTITLE_PREFERENCES_MESSAGE,
  START_FULL_TRANSLATION_MESSAGE,
  type CaptionTrack,
  type CaptionTrackRequestDetail,
  type CaptionTrackResponseDetail,
  type CaptionTracksEventDetail,
  type ContentState,
  type ContentSettings,
  type TranscriptReport,
} from '../../src/platform/youtube/types';
import {
  isCaptionEventForCurrentVideo,
  videoIdFromYouTubeUrl,
} from '../../src/platform/youtube/navigation';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  parseSubtitlePreferences,
  type SubtitlePreferences,
} from '../../src/settings/subtitle';
import { PlaybackPlanClient } from '../../src/provider/playbackPlanClient';
import { sourceNeighbors } from '@cueweave/core/provider/playbackPlan';
import { ProviderError } from '@cueweave/core/provider/types';
import { DEBUG_BUILD_ID } from '../../src/debug/build';
import { debugContextRange } from '../../src/debug/report';
import {
  CAPTURE_DEBUG_SNAPSHOT,
  DEBUG_ENABLED_CHANGED,
  RECORD_DEBUG_EVENT,
  type DebugSnapshot,
} from '../../src/debug/types';
import {
  PLAYBACK_BUFFER_POLICY,
  selectBufferWork,
  bufferPresentation,
  failedBufferWindow,
  configurationFailure,
  type BufferWindowState,
} from '../../src/provider/playbackBuffer';

const OVERLAY_ID = 'cueweave-subtitle-overlay';
const CONTENT_BUILD_MARKER = 'continuous-buffer-v1';

let state: ContentState = {
  status: 'idle',
  enabled: true,
  cueCount: 0,
  displayCueCount: 0,
  displayMode: DEFAULT_SUBTITLE_PREFERENCES.displayMode,
  aiStatus: 'idle',
};
let displayCues: DisplayCue[] = [];
let rawCues: RawCue[] = [];
let debugEnabled = false;
let currentTrack: DebugSnapshot['track'] = null;
let translatedCues: DisplayCue[] = [];
let sourceTokens: SourceToken[] = [];
let tokenWindows: TokenWindow[] = [];
let playbackPlan: PlaybackPlanClient | undefined;
let subtitlePreferences: SubtitlePreferences = { ...DEFAULT_SUBTITLE_PREFERENCES };
const windowStates = new Map<string, BufferWindowState>();
const windowJobs = new Map<string, Promise<void>>();
let bufferTimer: ReturnType<typeof setTimeout> | undefined;
let contentActive = true;
let overlayView: SubtitleOverlay | undefined;
let overlayRoot: HTMLDivElement | undefined;
let overlayTranslation: HTMLDivElement | undefined;
let overlaySource: HTMLDivElement | undefined;
let overlayTranslateButton: HTMLButtonElement | undefined;
let activeRequest: AbortController | undefined;
let loadedTrackKey = '';
let subtitleSession = 0;
let observedVideo: HTMLVideoElement | undefined;
let observedLocationVideoId: string | undefined;
let translationSessionId = crypto.randomUUID();
let fullTranslationStatus: TranscriptReport['fullTranslationStatus'] = 'idle';
let fullTranslationMessage = '';
let fullTranslationJob: Promise<void> | undefined;

function rotateTranslationSession(): void {
  const previousSessionId = translationSessionId;
  translationSessionId = crypto.randomUUID();
  playbackPlan = undefined;
  windowJobs.clear();
  fullTranslationJob = undefined;
  fullTranslationStatus = 'idle';
  fullTranslationMessage = '';
  updateState({
    fullTranslationStatus: 'idle',
    bufferedSeconds: undefined,
    bufferedUntilMs: undefined,
    bufferTargetSeconds: undefined,
  });
  scheduleBufferPump();
  void browser.runtime
    .sendMessage({
      type: CANCEL_TRANSLATION_SESSION_MESSAGE,
      sessionId: previousSessionId,
    })
    .catch(() => undefined);
}

function resetTranslatedResults(message?: string): void {
  rotateTranslationSession();
  playbackPlan = undefined;
  translatedCues = [];
  windowStates.clear();
  fullTranslationStatus = 'idle';
  fullTranslationMessage = '';
  fullTranslationJob = undefined;
  updateTranslationMetrics();
  updateState({
    aiStatus: 'idle',
    aiMessage: message,
    correctionCount: 0,
    fullTranslationStatus: 'idle',
  });
}

function updateState(patch: Partial<ContentState>): void {
  if (
    (patch.status !== undefined && patch.status !== state.status) ||
    (patch.aiStatus !== undefined && patch.aiStatus !== state.aiStatus)
  ) {
    recordDebugEvent('state-change', patch);
  }
  state = { ...state, ...patch };
  const host = document.getElementById(OVERLAY_ID);
  if (host) reflectState(host);
}

function resetSubtitleSession(videoId?: string, message?: string): void {
  rotateTranslationSession();
  fullTranslationStatus = 'idle';
  fullTranslationMessage = '';
  fullTranslationJob = undefined;
  subtitleSession += 1;
  loadedTrackKey = '';
  activeRequest?.abort();
  activeRequest = undefined;
  displayCues = [];
  rawCues = [];
  currentTrack = null;
  translatedCues = [];
  sourceTokens = [];
  tokenWindows = [];
  playbackPlan = undefined;
  windowStates.clear();
  updateState({
    status: videoId ? 'loading' : 'idle',
    videoId,
    languageCode: undefined,
    cueCount: 0,
    displayCueCount: 0,
    aiStatus: 'idle',
    aiMessage: undefined,
    bufferedSeconds: undefined,
    bufferTargetSeconds: undefined,
    bufferedUntilMs: undefined,
    correctionCount: 0,
    translatedWindowCount: 0,
    totalWindowCount: 0,
    fullTranslationStatus: 'idle',
    message: videoId ? (message ?? '正在读取新视频的字幕轨。') : undefined,
  });
}

function synchronizeVideoSession(): void {
  const currentVideoId = videoIdFromYouTubeUrl(window.location.href);
  if (currentVideoId === observedLocationVideoId) return;
  observedLocationVideoId = currentVideoId;
  resetSubtitleSession(currentVideoId);
}

function reflectState(host: HTMLElement): void {
  host.dataset.cueweaveStatus = state.status;
  host.dataset.cueweaveBuild = CONTENT_BUILD_MARKER;
  host.dataset.cueweaveCueCount = String(state.cueCount);
  host.dataset.cueweaveDisplayCueCount = String(state.displayCueCount);
  host.dataset.cueweaveAiStatus = state.aiStatus;
  host.dataset.cueweaveAiMessage = state.aiMessage ?? '';
  host.dataset.cueweaveBufferedSeconds = String(state.bufferedSeconds ?? 0);
  host.dataset.cueweaveBufferTargetSeconds = String(state.bufferTargetSeconds ?? 0);
  host.dataset.cueweaveBufferedUntilMs = String(state.bufferedUntilMs ?? 0);
  host.dataset.cueweaveMessage = state.message ?? '';
  host.dataset.cueweaveDisplayMode = subtitlePreferences.displayMode;
  host.dataset.cueweaveBilingualOrder = subtitlePreferences.bilingualOrder;
  host.dataset.cueweavePosition = String(subtitlePreferences.positionPercent);
  host.dataset.cueweaveSize = String(subtitlePreferences.sizePercent);
  host.dataset.cueweaveSourceSize = String(subtitlePreferences.sourceSizePercent);
  host.dataset.cueweaveBackground = String(subtitlePreferences.backgroundEnabled);
  host.dataset.cueweaveBackgroundOpacity = String(subtitlePreferences.backgroundOpacityPercent);
  host.dataset.cueweaveShadow = String(subtitlePreferences.shadowEnabled);
  host.dataset.cueweaveShadowStrength = String(subtitlePreferences.shadowStrengthPercent);
}

function applySubtitlePreferences(host: HTMLElement): void {
  if (overlayView) applyOverlayPreferences(overlayView, subtitlePreferences);
  state = { ...state, displayMode: subtitlePreferences.displayMode };
  reflectState(host);
}

function ensureOverlay(): HTMLDivElement | undefined {
  if (overlayRoot?.isConnected) return overlayRoot;
  const player = document.querySelector<HTMLElement>('.html5-video-player');
  if (!player) return undefined;

  overlayView?.dispose();
  document.getElementById(OVERLAY_ID)?.remove();
  overlayView = createSubtitleOverlay({
    regular: browser.runtime.getURL('/fonts/MiSans-Regular.woff2'),
    semibold: browser.runtime.getURL('/fonts/MiSans-Semibold.woff2'),
  });
  const host = overlayView.host;
  host.id = OVERLAY_ID;
  overlayRoot = overlayView.caption;
  overlayTranslation = overlayView.translation;
  overlaySource = overlayView.source;
  overlayTranslateButton = overlayView.action;
  overlayTranslateButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (overlayTranslateButton?.dataset.intent === 'configure') {
      void browser.runtime.openOptionsPage();
      return;
    }
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    if (video) void ensureTranslatedWindow(video.currentTime * 1_000, true);
  });
  player.append(host);
  applySubtitlePreferences(host);
  return overlayRoot;
}

function currentDisplayCueAt(cues: readonly DisplayCue[], timeMs: number): DisplayCue | undefined {
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle];
    if (!cue) break;
    if (timeMs < cue.startMs) high = middle - 1;
    else if (timeMs > cue.endMs) low = middle + 1;
    else return cue;
  }

  return undefined;
}

function windowAt(timeMs: number): TokenWindow | undefined {
  return tokenWindows.find((window) => timeMs >= window.startMs && timeMs <= window.endMs);
}

function currentVideoContext(): {
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  transcriptEvidence?: string[];
  entityCandidates?: ReturnType<typeof extractTranscriptEntityCandidates>;
} {
  const rawTitle =
    document.querySelector<HTMLElement>('ytd-watch-metadata h1')?.innerText.trim() ||
    document.title.replace(/\s+-\s+YouTube$/u, '').trim();
  const channelName = document
    .querySelector<HTMLElement>('ytd-watch-metadata ytd-channel-name a')
    ?.innerText.trim();
  const videoDescription =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content.trim() ||
    document
      .querySelector<HTMLElement>('ytd-watch-metadata #description-inline-expander')
      ?.innerText.trim();
  const transcriptEvidence = extractTranscriptEvidenceTerms(sourceTokens);
  const entityCandidates = extractTranscriptEntityCandidates(sourceTokens);
  return {
    ...(rawTitle ? { videoTitle: rawTitle.slice(0, 200) } : {}),
    ...(channelName ? { channelName: channelName.slice(0, 120) } : {}),
    ...(videoDescription ? { videoDescription: videoDescription.slice(0, 1_200) } : {}),
    ...(transcriptEvidence.length > 0 ? { transcriptEvidence } : {}),
    ...(entityCandidates.length > 1 ? { entityCandidates } : {}),
  };
}

function logTranslationEvent(
  event: 'start' | 'promote' | 'progress' | 'success' | 'failure',
  details: Record<string, boolean | number | string | undefined>,
): void {
  const payload = JSON.stringify({ event, sessionId: translationSessionId, ...details });
  if (event === 'failure') console.warn('[CueWeave] 字幕翻译', payload);
  else console.info('[CueWeave] 字幕翻译', payload);
  recordDebugEvent(`translation-${event}`, details);
}

function recordDebugEvent(event: string, details: object = {}): void {
  if (!debugEnabled || !contentActive) return;
  const videoId = videoIdFromYouTubeUrl(window.location.href);
  if (!videoId) return;
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  void browser.runtime
    .sendMessage({
      type: RECORD_DEBUG_EVENT,
      event,
      videoId,
      sessionId: translationSessionId,
      details: { timeMs: video ? video.currentTime * 1_000 : null, ...details },
    })
    .catch(() => {});
}

function captureDebugSnapshot(): DebugSnapshot {
  const videoId = videoIdFromYouTubeUrl(window.location.href) ?? '';
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  const timeMs = video && Number.isFinite(video.currentTime) ? video.currentTime * 1_000 : null;
  const currentSession = videoId === state.videoId;
  const { windows, range } = debugContextRange(timeMs, currentSession ? tokenWindows : []);
  const nearby = (cue: { startMs: number; endMs: number }) =>
    !!range && cue.startMs <= range.endMs && cue.endMs >= range.startMs;
  const player = document.querySelector<HTMLElement>('.html5-video-player');
  return structuredClone({
    capturedAt: Date.now(),
    videoId,
    sessionId: translationSessionId,
    contentBuild: DEBUG_BUILD_ID,
    timeMs,
    videoTitle: document.title.replace(/\s+-\s+YouTube$/u, ''),
    playback: video
      ? {
          paused: video.paused,
          seeking: video.seeking,
          playbackRate: video.playbackRate,
          durationMs: Number.isFinite(video.duration) ? video.duration * 1_000 : null,
          readyState: video.readyState,
        }
      : null,
    state,
    preferences: subtitlePreferences,
    track: currentSession ? currentTrack : null,
    range,
    windows: windows.map((window) => ({
      ...window,
      ...(windowStates.has(window.id) ? { state: windowStates.get(window.id)! } : {}),
    })),
    rawCues: currentSession ? rawCues.filter(nearby) : [],
    sourceTokens: currentSession ? sourceTokens.filter(nearby) : [],
    originalCues: currentSession ? displayCues.filter(nearby) : [],
    translatedCues: currentSession ? translatedCues.filter(nearby) : [],
    display: {
      originalText: overlaySource?.textContent ?? '',
      translationText: overlayTranslation?.textContent ?? '',
      hidden: !overlayRoot || overlayRoot.dataset.visible !== 'true',
      playerWidth: player?.clientWidth ?? null,
      playerHeight: player?.clientHeight ?? null,
      fullscreen: !!document.fullscreenElement,
    },
  });
}

function mergeTranslatedCues(cues: readonly DisplayCue[]): void {
  const cuesById = new Map(translatedCues.map((cue) => [cue.id, cue]));
  for (const cue of cues) cuesById.set(cue.id, cue);
  translatedCues = [...cuesById.values()].sort((left, right) => left.startMs - right.startMs);
  updateTranslationMetrics();
}

function translatedWindowCount(): number {
  return tokenWindows.filter((window) => windowStates.get(window.id)?.status === 'ready').length;
}

function uniqueCorrections(): TranscriptReport['corrections'] {
  return [
    ...new Map(
      translatedCues
        .flatMap((cue) => cue.corrections ?? [])
        .map((correction) => [correction.id, correction]),
    ).values(),
  ].sort((left, right) => left.startMs - right.startMs);
}

function uniqueTerminology(): TranscriptReport['terminology'] {
  return [
    ...new Map(
      translatedCues
        .flatMap((cue) => cue.terminology ?? [])
        .map((term) => [term.source.toLocaleLowerCase(), term]),
    ).values(),
  ];
}

function updateTranslationMetrics(): void {
  updateState({
    correctionCount: uniqueCorrections().filter((correction) => correction.applied).length,
    translatedWindowCount: translatedWindowCount(),
    totalWindowCount: tokenWindows.length,
    fullTranslationStatus,
  });
}

function transcriptReport(): TranscriptReport {
  const completedWindows = translatedWindowCount();
  return {
    videoId: state.videoId ?? '',
    videoTitle: currentVideoContext().videoTitle ?? 'YouTube 视频',
    ...(state.languageCode ? { languageCode: state.languageCode } : {}),
    originalCues: structuredClone(displayCues),
    translatedCues: structuredClone(translatedCues),
    corrections: structuredClone(uniqueCorrections()),
    terminology: structuredClone(uniqueTerminology()),
    translatedWindowCount: completedWindows,
    totalWindowCount: tokenWindows.length,
    translationComplete: tokenWindows.length > 0 && completedWindows === tokenWindows.length,
    fullTranslationStatus,
    ...(fullTranslationMessage ? { message: fullTranslationMessage } : {}),
  };
}

async function waitForWindowTranslation(windowId: string): Promise<void> {
  await windowJobs.get(windowId);
}

function startFullTranslation(): Promise<void> {
  if (fullTranslationJob) return fullTranslationJob;
  const jobSessionId = translationSessionId;
  fullTranslationStatus = 'working';
  fullTranslationMessage = '正在准备完整字幕。';
  updateTranslationMetrics();

  fullTranslationJob = (async () => {
    for (const window of tokenWindows) {
      if (jobSessionId !== translationSessionId) {
        return;
      }
      while (
        jobSessionId === translationSessionId &&
        [...windowStates.values()].filter((s) => s.status === 'working').length >=
          PLAYBACK_BUFFER_POLICY.maxWorking &&
        !windowJobs.has(window.id)
      )
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      if (jobSessionId !== translationSessionId) return;
      await translateWindow(window, 'prefetch', true);
      await waitForWindowTranslation(window.id);
      if (jobSessionId !== translationSessionId) return;
      const completed = translatedWindowCount();
      fullTranslationMessage = `已完成 ${completed} / ${tokenWindows.length} 个字幕窗口。`;
      updateTranslationMetrics();
    }
    if (jobSessionId !== translationSessionId) return;
    const complete = translatedWindowCount() === tokenWindows.length && tokenWindows.length > 0;
    fullTranslationStatus = complete ? 'ready' : 'error';
    fullTranslationMessage = complete
      ? '完整字幕已准备好，可以导出。'
      : '部分字幕窗口未能完成，请检查模型状态后重试。';
    updateTranslationMetrics();
  })().finally(() => {
    if (jobSessionId === translationSessionId) fullTranslationJob = undefined;
  });
  return fullTranslationJob;
}

function promoteWindow(window: TokenWindow): void {
  const current = windowStates.get(window.id);
  if (current?.status !== 'working' || current.priority === 'current') return;
  windowStates.set(window.id, { ...current, priority: 'current' });
  void browser.runtime
    .sendMessage({
      type: PROMOTE_PLAYBACK_WINDOW_MESSAGE,
      sessionId: translationSessionId,
      windowId: window.id,
    })
    .catch(() => undefined);
  logTranslationEvent('promote', { startMs: window.startMs, endMs: window.endMs });
}

function translateWindow(
  window: TokenWindow,
  priority: TranslationPriority,
  force = false,
): Promise<void> {
  const existing = windowStates.get(window.id);
  if (existing?.status === 'ready') return Promise.resolve();
  const pending = windowJobs.get(window.id);
  if (pending) {
    if (priority === 'current') promoteWindow(window);
    return pending;
  }
  if (
    !force &&
    existing?.status === 'failed' &&
    (existing.retryAt === undefined || existing.retryAt > Date.now())
  )
    return Promise.resolve();
  const failures = force ? 0 : (existing?.failures ?? 0);
  windowStates.set(window.id, { status: 'working', priority, failures, stage: 'planning' });
  const job = runWindowTranslation(window, priority, failures).finally(() => {
    if (windowJobs.get(window.id) === job) windowJobs.delete(window.id);
  });
  windowJobs.set(window.id, job);
  return job;
}

async function runWindowTranslation(
  window: TokenWindow,
  priority: TranslationPriority,
  failures: number,
): Promise<void> {
  const requestSession = subtitleSession;
  const requestTranslationSessionId = translationSessionId;
  const active = () =>
    contentActive &&
    requestSession === subtitleSession &&
    requestTranslationSessionId === translationSessionId;
  const requestStartedAt = performance.now();
  logTranslationEvent('start', {
    priority,
    startMs: window.startMs,
    endMs: window.endMs,
    tokenCount: window.tokens.length,
    failures,
  });
  try {
    playbackPlan ??= new PlaybackPlanClient(
      sourceTokens,
      state.videoId ?? '',
      state.languageCode ?? '',
      (message) => browser.runtime.sendMessage(message),
    );
    const plan = playbackPlan;
    const windowIndex = tokenWindows.findIndex((candidate) => candidate.id === window.id);
    window = await plan.prepare(windowIndex, requestTranslationSessionId, priority, active);
    if (!active()) return;
    tokenWindows = plan.windows();
    scheduleBufferPump();
    // Keep disjoint gaps separate: removing accepted tokens must not invent a continuous range.
    const accepted = new Set(translatedCues.flatMap((cue) => cue.sourceTokenIds));
    const ranges: SourceToken[][] = [];
    let gap: SourceToken[] = [];
    for (const token of window.tokens) {
      if (accepted.has(token.id)) {
        if (gap.length) ranges.push(gap);
        gap = [];
      } else gap.push(token);
    }
    if (gap.length) ranges.push(gap);
    let receivedCues = 0;
    let cacheHit = true;
    for (const range of ranges) {
      const previousCues = translatedCues
        .filter((cue) => cue.endMs < range[0]!.startMs)
        .slice(-6)
        .map((cue) => ({ sourceText: cue.sourceText, translation: cue.translation }));
      // A planning job can be promoted before its translation request has been enqueued.
      priority = windowStates.get(window.id)?.priority ?? priority;
      const result = (await browser.runtime.sendMessage({
        type: TRANSLATE_WINDOW_MESSAGE,
        tokens: range,
        context: {
          videoId: state.videoId ?? '',
          languageCode: state.languageCode ?? '',
          windowId: window.id,
          sessionId: requestTranslationSessionId,
          ...currentVideoContext(),
          correctionEnabled: subtitlePreferences.transcriptCorrectionEnabled,
        },
        priority,
        previousCues,
        neighbors: sourceNeighbors(sourceTokens, range),
      })) as TranslateWindowResult;
      if (!active()) return;
      if (!result.ok) {
        if (result.cues?.length) mergeTranslatedCues(result.cues);
        throw new ProviderError(result.error.code, result.error.message);
      }
      mergeTranslatedCues(result.cues);
      receivedCues += result.cues.length;
      cacheHit &&= result.cacheHit;
    }
    windowStates.set(window.id, { status: 'ready', priority });
    logTranslationEvent('success', {
      priority,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: Math.round(performance.now() - requestStartedAt),
      cacheHit,
      cueCount: receivedCues,
    });
  } catch (error) {
    if (!active()) return;
    const code = error instanceof ProviderError ? error.code : 'network';
    const message =
      error instanceof ProviderError
        ? error.message
        : '无法连接扩展后台。CueWeave 已保留原文字幕。';
    windowStates.set(
      window.id,
      failedBufferWindow(
        { status: 'working', priority, failures },
        code,
        message,
        priority,
        Date.now(),
      ),
    );
    logTranslationEvent('failure', {
      priority,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: Math.round(performance.now() - requestStartedAt),
      code,
      failures: failures + 1,
      retryAt: windowStates.get(window.id)?.retryAt,
    });
  } finally {
    if (active()) scheduleBufferPump();
  }
}

function scheduleBufferPump(delayMs = 0): void {
  if (!contentActive) return;
  if (bufferTimer !== undefined) clearTimeout(bufferTimer);
  bufferTimer = setTimeout(pumpBuffer, delayMs);
}

function pumpBuffer(): void {
  bufferTimer = undefined;
  if (!contentActive) return;
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (
    video &&
    state.status === 'ready' &&
    state.enabled &&
    subtitlePreferences.displayMode !== 'source'
  ) {
    const decision = selectBufferWork(
      tokenWindows,
      windowStates,
      {
        timeMs: video.currentTime * 1000,
        playbackRate: video.playbackRate,
        paused: video.paused,
        enabled: true,
        seeking: video.seeking,
      },
      Date.now(),
    );
    for (const window of decision.promotions) promoteWindow(window);
    for (const work of decision.work) void translateWindow(work.window, work.priority);
    const firstMissing =
      decision.buffer.firstMissingIndex === undefined
        ? undefined
        : tokenWindows[decision.buffer.firstMissingIndex];
    const configError = [...windowStates.values()].find(
      (s) => s.status === 'failed' && configurationFailure(s.failureCode),
    );
    const presentation = bufferPresentation(
      decision.buffer,
      configError ?? (firstMissing ? windowStates.get(firstMissing.id) : undefined),
    );
    updateState({
      aiStatus: presentation.status,
      aiMessage: presentation.message,
      bufferedSeconds: Math.floor(decision.buffer.availableSeconds),
      bufferTargetSeconds: Math.floor(decision.buffer.targetSeconds),
      bufferedUntilMs: decision.buffer.contiguousUntilMs,
    });
  } else if (!state.enabled || subtitlePreferences.displayMode === 'source') {
    updateState({
      aiStatus: 'idle',
      aiMessage: undefined,
      bufferedSeconds: undefined,
      bufferTargetSeconds: undefined,
      bufferedUntilMs: undefined,
    });
  }
  scheduleBufferPump(PLAYBACK_BUFFER_POLICY.tickMs);
}

async function ensureTranslatedWindow(timeMs: number, force = false): Promise<void> {
  if (!state.enabled || subtitlePreferences.displayMode === 'source') return;
  const window = tokenWindows.find((candidate) => candidate.endMs > timeMs);
  if (!window) return;
  if (force) {
    for (const [id, status] of windowStates) {
      if (status.status === 'failed' && configurationFailure(status.failureCode))
        windowStates.delete(id);
    }
  }
  await translateWindow(window, 'current', force);
  scheduleBufferPump();
}
function handleVideoSeeked(event: Event): void {
  recordDebugEvent('seeked');
  const video = event.currentTarget as HTMLVideoElement;
  if (state.enabled && subtitlePreferences.displayMode !== 'source') {
    rotateTranslationSession();
    windowStates.forEach((windowState, windowId) => {
      if (windowState.status === 'working') windowStates.delete(windowId);
    });
    void ensureTranslatedWindow(video.currentTime * 1_000, true);
  }
}

function observeVideo(video: HTMLVideoElement | null | undefined): void {
  const nextVideo = video ?? undefined;
  if (nextVideo === observedVideo) return;
  observedVideo?.removeEventListener('seeked', handleVideoSeeked);
  for (const event of ['play', 'pause', 'ratechange', 'seeking'])
    observedVideo?.removeEventListener(event, handlePlaybackChange);
  observedVideo = nextVideo;
  observedVideo?.addEventListener('seeked', handleVideoSeeked);
  for (const event of ['play', 'pause', 'ratechange', 'seeking'])
    observedVideo?.addEventListener(event, handlePlaybackChange);
  scheduleBufferPump();
}

function handlePlaybackChange(event: Event): void {
  recordDebugEvent(event.type, {
    playbackRate: observedVideo?.playbackRate,
    paused: observedVideo?.paused,
  });
  scheduleBufferPump();
}

function renderLoop(): void {
  synchronizeVideoSession();
  const target = ensureOverlay();
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  observeVideo(video);
  const timeMs = video ? video.currentTime * 1_000 : 0;
  const activeWindow = state.enabled && video ? windowAt(timeMs) : undefined;
  const activeWindowState = activeWindow ? windowStates.get(activeWindow.id) : undefined;
  const translatedCue =
    state.enabled && video ? currentDisplayCueAt(translatedCues, timeMs) : undefined;
  const fallbackCue =
    activeWindow && activeWindowState?.status !== 'ready'
      ? currentDisplayCueAt(displayCues, timeMs)
      : undefined;
  const displayCue = translatedCue ?? fallbackCue;
  const translation = translatedCue?.translation ?? '';
  const source = displayCue?.sourceText ?? '';

  let actionLabel = '';
  let actionIntent = '';
  let actionDisabled = false;
  if (
    subtitlePreferences.displayMode !== 'source' &&
    fallbackCue &&
    !translatedCue &&
    activeWindow
  ) {
    if (activeWindowState?.status === 'working') {
      actionLabel =
        activeWindowState.stage === 'planning'
          ? '正在规划字幕'
          : activeWindowState.stage === 'retrying'
            ? '连接中断 正在重试'
            : activeWindowState.stage === 'resolving-entities'
              ? '正在识别专有名词'
              : activeWindowState.stage === 'repairing-boundaries'
                ? '正在修复断句'
                : activeWindowState.stage === 'repairing-output'
                  ? '正在修复字幕'
                  : '正在翻译此处';
      actionDisabled = true;
    } else if (
      activeWindowState?.status === 'failed' &&
      configurationFailure(activeWindowState.failureCode)
    ) {
      actionLabel = '配置模型后翻译';
      actionIntent = 'configure';
    } else if (activeWindowState?.status === 'failed') {
      actionLabel = '重试翻译此处';
      actionIntent = 'retry';
    } else if (!activeWindowState) {
      actionLabel = '立即翻译此处';
      actionIntent = 'translate';
    }
  }

  if (target) {
    if (overlayTranslation && overlayTranslation.textContent !== translation) {
      overlayTranslation.textContent = translation;
    }
    if (overlaySource && overlaySource.textContent !== source) overlaySource.textContent = source;
    if (overlayTranslateButton) {
      if (overlayTranslateButton.textContent !== actionLabel) {
        overlayTranslateButton.textContent = actionLabel;
      }
      overlayTranslateButton.disabled = actionDisabled;
      overlayTranslateButton.dataset.intent = actionIntent;
      overlayTranslateButton.setAttribute('aria-label', actionLabel || '翻译当前位置');
    }
    const showSource =
      subtitlePreferences.displayMode === 'bilingual' ||
      subtitlePreferences.displayMode === 'source';
    target.dataset.action = actionLabel ? 'true' : 'false';
    target.dataset.visible =
      translation || (showSource && source) || actionLabel ? 'true' : 'false';
    target.dataset.translated = translation ? 'true' : 'false';
    target.dataset.mode = subtitlePreferences.displayMode;
    target.dataset.order = subtitlePreferences.bilingualOrder;
  }

  window.requestAnimationFrame(renderLoop);
}

function preferredTrack(tracks: readonly CaptionTrack[]): CaptionTrack | undefined {
  return tracks.find((track) => !track.isAutoGenerated) ?? tracks[0];
}

function requestCaptionTrack(track: CaptionTrack, signal: AbortSignal): Promise<RawCue[]> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const request: CaptionTrackRequestDetail = { requestId, track };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      window.removeEventListener(CAPTION_TRACK_RESPONSE_EVENT, handleResponse);
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Caption request aborted.', 'AbortError'));
    };
    const handleResponse = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value !== 'string') return;

      let response: CaptionTrackResponseDetail;
      try {
        response = JSON.parse(value) as CaptionTrackResponseDetail;
      } catch {
        return;
      }
      if (response.requestId !== requestId) return;

      cleanup();
      if (response.ok) resolve(response.cues);
      else reject(new Error(response.error));
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('YouTube 字幕请求超时，请刷新视频页面后重试。'));
    }, 15_000);

    signal.addEventListener('abort', handleAbort, { once: true });
    window.addEventListener(CAPTION_TRACK_RESPONSE_EVENT, handleResponse);
    window.dispatchEvent(
      new CustomEvent(CAPTION_TRACK_REQUEST_EVENT, { detail: JSON.stringify(request) }),
    );
  });
}

async function loadTrack(detail: CaptionTracksEventDetail): Promise<void> {
  if (!isCaptionEventForCurrentVideo(window.location.href, detail.videoId)) {
    return;
  }

  observedLocationVideoId = detail.videoId;
  const track = preferredTrack(detail.tracks);
  if (!track) {
    resetSubtitleSession(detail.videoId);
    updateState({
      status: 'no-captions',
      message: '当前视频没有可用字幕。',
    });
    return;
  }

  const trackKey = `${detail.videoId}:${track.languageCode}:${track.baseUrl}`;
  if (trackKey === loadedTrackKey) return;
  rotateTranslationSession();
  subtitleSession += 1;
  loadedTrackKey = trackKey;
  currentTrack = {
    languageCode: track.languageCode,
    name: track.name,
    isAutoGenerated: track.isAutoGenerated,
  };
  recordDebugEvent('caption-track', currentTrack);
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  displayCues = [];
  rawCues = [];
  translatedCues = [];
  sourceTokens = [];
  tokenWindows = [];
  windowStates.clear();
  updateState({
    status: 'loading',
    videoId: detail.videoId,
    languageCode: track.languageCode,
    cueCount: 0,
    displayCueCount: 0,
    aiStatus: 'idle',
    aiMessage: undefined,
    message: '正在读取字幕轨。',
  });

  try {
    const cues = await requestCaptionTrack(track, request.signal);
    if (request.signal.aborted || trackKey !== loadedTrackKey) return;
    rawCues = cues;
    sourceTokens = buildSourceTokens(cues);
    displayCues = createLocalDisplayCues(sourceTokens);
    tokenWindows = createTokenWindows(sourceTokens).map((window, index) => ({
      ...window,
      id: `playback:${index}`,
    }));
    updateTranslationMetrics();
    updateState({
      status: 'ready',
      cueCount: cues.length,
      displayCueCount: displayCues.length,
      aiStatus: 'idle',
      message: `已整理 ${displayCues.length} 条可显示字幕。`,
    });
  } catch (error) {
    if (request.signal.aborted || trackKey !== loadedTrackKey) return;
    displayCues = [];
    translatedCues = [];
    sourceTokens = [];
    tokenWindows = [];
    windowStates.clear();
    updateState({
      status: 'error',
      cueCount: 0,
      displayCueCount: 0,
      aiStatus: 'error',
      message: error instanceof Error ? error.message : '字幕轨读取失败，请刷新视频后重试。',
    });
  }
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_start',
  async main(ctx) {
    ctx.onInvalidated(() => {
      contentActive = false;
      activeRequest?.abort();
      const invalidatedSession = translationSessionId;
      translationSessionId = crypto.randomUUID();
      void Promise.resolve()
        .then(() =>
          browser.runtime.sendMessage({
            type: CANCEL_TRANSLATION_SESSION_MESSAGE,
            sessionId: invalidatedSession,
          }),
        )
        .catch(() => undefined);
      if (bufferTimer !== undefined) clearTimeout(bufferTimer);
      observedVideo?.removeEventListener('seeked', handleVideoSeeked);
      for (const event of ['play', 'pause', 'ratechange', 'seeking'])
        observedVideo?.removeEventListener(event, handlePlaybackChange);
    });
    observedLocationVideoId = videoIdFromYouTubeUrl(window.location.href);
    try {
      const contentSettings = (await browser.runtime.sendMessage({
        type: GET_CONTENT_SETTINGS_MESSAGE,
      })) as Partial<ContentSettings>;
      subtitlePreferences = parseSubtitlePreferences(contentSettings.subtitlePreferences);
      debugEnabled = contentSettings.debugEnabled === true;
      updateState({
        enabled: contentSettings.enabled !== false,
        displayMode: subtitlePreferences.displayMode,
      });
    } catch {
      updateState({ enabled: true });
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message) {
        if (
          message.type === DEBUG_ENABLED_CHANGED &&
          'enabled' in message &&
          typeof message.enabled === 'boolean'
        ) {
          debugEnabled = message.enabled;
          recordDebugEvent('debug-enabled', { state });
          return Promise.resolve({ ok: true });
        }
        if (message.type === CAPTURE_DEBUG_SNAPSHOT) {
          return Promise.resolve(captureDebugSnapshot());
        }
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === REFRESH_VIDEO_TRANSLATIONS_MESSAGE &&
        'videoId' in message &&
        typeof message.videoId === 'string'
      ) {
        if (message.videoId !== state.videoId)
          return Promise.resolve({ ok: true, refreshed: false });
        resetTranslatedResults('术语已更新，正在重新翻译当前位置。');
        const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
        if (state.enabled && video && subtitlePreferences.displayMode !== 'source') {
          void ensureTranslatedWindow(video.currentTime * 1_000, true);
        }
        return Promise.resolve({ ok: true, refreshed: true });
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === TRANSLATION_PROGRESS_MESSAGE &&
        'windowId' in message &&
        typeof message.windowId === 'string' &&
        'stage' in message &&
        (message.stage === 'planning' ||
          message.stage === 'retrying' ||
          message.stage === 'resolving-entities' ||
          message.stage === 'translating' ||
          message.stage === 'repairing-boundaries' ||
          message.stage === 'repairing-output')
      ) {
        if ('sessionId' in message && message.sessionId !== translationSessionId)
          return Promise.resolve({ ok: true });
        const windowState = windowStates.get(message.windowId);
        const tokenWindow = tokenWindows.find((candidate) => candidate.id === message.windowId);
        if (windowState?.status === 'working') {
          windowStates.set(message.windowId, { ...windowState, stage: message.stage });
        }
        logTranslationEvent('progress', {
          stage: message.stage,
          startMs: tokenWindow?.startMs,
          endMs: tokenWindow?.endMs,
        });
        scheduleBufferPump();
        return Promise.resolve({ ok: true });
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === GET_CONTENT_STATE_MESSAGE
      ) {
        return Promise.resolve(state);
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === GET_TRANSCRIPT_REPORT_MESSAGE
      ) {
        return Promise.resolve(transcriptReport());
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === START_FULL_TRANSLATION_MESSAGE
      ) {
        void startFullTranslation();
        return Promise.resolve({ ok: true });
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === SET_CONTENT_ENABLED_MESSAGE &&
        'enabled' in message &&
        typeof message.enabled === 'boolean'
      ) {
        if (!message.enabled) {
          rotateTranslationSession();
          windowStates.forEach((windowState, windowId) => {
            if (windowState.status === 'working') windowStates.delete(windowId);
          });
        }
        updateState({ enabled: message.enabled });
        scheduleBufferPump();
        return Promise.resolve({ ok: true });
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === SET_SUBTITLE_PREFERENCES_MESSAGE &&
        'preferences' in message
      ) {
        const nextPreferences = parseSubtitlePreferences(message.preferences);
        const correctionSettingChanged =
          subtitlePreferences.transcriptCorrectionEnabled !==
          nextPreferences.transcriptCorrectionEnabled;
        const switchingToSource =
          subtitlePreferences.displayMode !== 'source' && nextPreferences.displayMode === 'source';
        subtitlePreferences = nextPreferences;
        if (switchingToSource && !correctionSettingChanged) {
          rotateTranslationSession();
        }
        if (switchingToSource) {
          windowStates.forEach((windowState, windowId) => {
            if (windowState.status === 'working') windowStates.delete(windowId);
          });
        }
        if (correctionSettingChanged) {
          resetTranslatedResults();
        }
        updateState({ displayMode: subtitlePreferences.displayMode });
        scheduleBufferPump();
        const host = document.getElementById(OVERLAY_ID);
        if (host) applySubtitlePreferences(host);
        return Promise.resolve({ ok: true });
      }
      return undefined;
    });

    window.addEventListener(CAPTION_TRACKS_EVENT, (event) => {
      const detail = (event as CustomEvent<CaptionTracksEventDetail>).detail;
      if (detail && Array.isArray(detail.tracks)) void loadTrack(detail);
    });
    window.dispatchEvent(new CustomEvent(CAPTION_TRACKS_REQUEST_EVENT));

    window.addEventListener('yt-navigate-start', () => {
      resetSubtitleSession(undefined, '正在切换视频。');
    });
    window.addEventListener('yt-navigate-finish', () => {
      synchronizeVideoSession();
    });
    window.addEventListener('popstate', synchronizeVideoSession);

    scheduleBufferPump();
    window.requestAnimationFrame(renderLoop);
  },
});
