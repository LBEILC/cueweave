import {
  buildSourceTokens,
  createLocalDisplayCues,
  createTokenWindows,
  extractTranscriptEvidenceTerms,
  type DisplayCue,
  type RawCue,
  type SourceToken,
  type TokenWindow,
} from '../../src/domain/subtitle';
import {
  CANCEL_TRANSLATION_SESSION_MESSAGE,
  TRANSLATE_WINDOW_MESSAGE,
  TRANSLATION_PROGRESS_MESSAGE,
  type TranslateWindowResult,
  type TranslationProgressStage,
} from '../../src/provider/messages';
import {
  CAPTION_TRACK_REQUEST_EVENT,
  CAPTION_TRACK_RESPONSE_EVENT,
  CAPTION_TRACKS_EVENT,
  GET_CONTENT_SETTINGS_MESSAGE,
  GET_CONTENT_STATE_MESSAGE,
  GET_TRANSCRIPT_REPORT_MESSAGE,
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

const OVERLAY_ID = 'cueweave-subtitle-overlay';
const CONTENT_BUILD_MARKER = 'proper-noun-grounding-v1';
const PREFETCH_WINDOW_COUNT = 3;

type WindowTranslationStatus = 'working' | 'ready' | 'failed';

interface WindowTranslationState {
  status: WindowTranslationStatus;
  priority: 'current' | 'prefetch';
  failureCode?: string;
  stage?: TranslationProgressStage;
}

let state: ContentState = {
  status: 'idle',
  enabled: true,
  cueCount: 0,
  displayCueCount: 0,
  displayMode: DEFAULT_SUBTITLE_PREFERENCES.displayMode,
  aiStatus: 'idle',
};
let displayCues: DisplayCue[] = [];
let translatedCues: DisplayCue[] = [];
let sourceTokens: SourceToken[] = [];
let tokenWindows: TokenWindow[] = [];
let subtitlePreferences: SubtitlePreferences = { ...DEFAULT_SUBTITLE_PREFERENCES };
const windowStates = new Map<string, WindowTranslationState>();
const windowRetryAfterMs = new Map<string, number>();
let overlayRoot: HTMLDivElement | undefined;
let overlayTranslation: HTMLDivElement | undefined;
let overlaySource: HTMLDivElement | undefined;
let overlayTranslateButton: HTMLButtonElement | undefined;
let activeRequest: AbortController | undefined;
let loadedTrackKey = '';
let subtitleSession = 0;
let focusedWindowId = '';
let translationFocusVersion = 0;
let observedVideo: HTMLVideoElement | undefined;
let observedLocationVideoId: string | undefined;
let translationSessionId = crypto.randomUUID();
let fullTranslationStatus: TranscriptReport['fullTranslationStatus'] = 'idle';
let fullTranslationMessage = '';
let fullTranslationJob: Promise<void> | undefined;

function rotateTranslationSession(): void {
  const previousSessionId = translationSessionId;
  translationSessionId = crypto.randomUUID();
  void browser.runtime
    .sendMessage({
      type: CANCEL_TRANSLATION_SESSION_MESSAGE,
      sessionId: previousSessionId,
    })
    .catch(() => undefined);
}

function updateState(patch: Partial<ContentState>): void {
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
  translatedCues = [];
  sourceTokens = [];
  tokenWindows = [];
  windowStates.clear();
  windowRetryAfterMs.clear();
  focusedWindowId = '';
  translationFocusVersion += 1;
  updateState({
    status: videoId ? 'loading' : 'idle',
    videoId,
    languageCode: undefined,
    cueCount: 0,
    displayCueCount: 0,
    aiStatus: 'idle',
    aiMessage: undefined,
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
  host.dataset.cueweaveMessage = state.message ?? '';
  host.dataset.cueweaveDisplayMode = subtitlePreferences.displayMode;
  host.dataset.cueweaveBilingualOrder = subtitlePreferences.bilingualOrder;
  host.dataset.cueweavePosition = String(subtitlePreferences.positionPercent);
  host.dataset.cueweaveSize = String(subtitlePreferences.sizePercent);
  host.dataset.cueweaveBackground = String(subtitlePreferences.backgroundEnabled);
  host.dataset.cueweaveBackgroundOpacity = String(subtitlePreferences.backgroundOpacityPercent);
}

function applySubtitlePreferences(host: HTMLElement): void {
  host.style.paddingBottom = `${subtitlePreferences.positionPercent}%`;
  host.style.background = 'none';
  host.style.setProperty('--cueweave-font-scale', String(subtitlePreferences.sizePercent / 100));
  host.style.setProperty(
    '--cueweave-caption-background-opacity',
    subtitlePreferences.backgroundEnabled
      ? String(subtitlePreferences.backgroundOpacityPercent / 100)
      : '0',
  );
  host.style.setProperty(
    '--cueweave-caption-border-opacity',
    subtitlePreferences.backgroundEnabled ? '0.42' : '0',
  );
  host.style.setProperty(
    '--cueweave-caption-shadow-opacity',
    subtitlePreferences.backgroundEnabled ? '0.32' : '0',
  );
  if (overlayRoot) {
    overlayRoot.dataset.mode = subtitlePreferences.displayMode;
    overlayRoot.dataset.order = subtitlePreferences.bilingualOrder;
  }
  state = { ...state, displayMode: subtitlePreferences.displayMode };
  reflectState(host);
}

function ensureOverlay(): HTMLDivElement | undefined {
  if (overlayRoot?.isConnected) return overlayRoot;
  const player = document.querySelector<HTMLElement>('.html5-video-player');
  if (!player) return undefined;

  document.getElementById(OVERLAY_ID)?.remove();
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.cssText = [
    'position:absolute',
    'inset:0',
    'pointer-events:none',
    'z-index:60',
    'display:flex',
    'align-items:flex-end',
    'justify-content:center',
    'padding:0 5%',
    'box-sizing:border-box',
  ].join(';');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  const regularFontUrl = browser.runtime.getURL('/fonts/MiSans-Regular.woff2');
  const semiboldFontUrl = browser.runtime.getURL('/fonts/MiSans-Semibold.woff2');
  style.textContent = `
    @font-face {
      font-family: "MiSans";
      src: url("${regularFontUrl}") format("woff2");
      font-style: normal;
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: "MiSans";
      src: url("${semiboldFontUrl}") format("woff2");
      font-style: normal;
      font-weight: 600;
      font-display: swap;
    }
    :host { font-size: medium; }
    .cueweave-caption {
      display: none;
      max-width: min(52em, 88%);
      color: #f7efe3;
      background: rgb(24 22 19 / var(--cueweave-caption-background-opacity, 0.8));
      border: 1px solid rgb(242 163 58 / var(--cueweave-caption-border-opacity, 0.42));
      border-radius: 3px;
      box-shadow: 0 8px 32px rgb(0 0 0 / var(--cueweave-caption-shadow-opacity, 0.32));
      padding: 0.48em 0.75em 0.52em;
      font-family: "MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: clamp(
        calc(1.125em * var(--cueweave-font-scale, 1)),
        calc(1.65vw * var(--cueweave-font-scale, 1)),
        calc(1.75em * var(--cueweave-font-scale, 1))
      );
      font-weight: 600;
      line-height: 1.42;
      text-align: center;
      text-wrap: balance;
      text-shadow: 0 2px 3px rgb(0 0 0 / 72%);
    }
    .cueweave-caption[data-visible="true"] {
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
    .cueweave-translation { display: none; }
    .cueweave-caption[data-translated="true"] .cueweave-translation {
      display: block;
    }
    .cueweave-caption[data-translated="true"] .cueweave-source {
      margin-top: 0.22em;
      color: #d4ccc1;
      font-size: 0.68em;
      font-weight: 400;
      line-height: 1.36;
    }
    .cueweave-caption[data-mode="translation"] .cueweave-source { display: none; }
    .cueweave-caption[data-mode="source"] .cueweave-translation { display: none; }
    .cueweave-caption[data-mode="source"] .cueweave-source {
      margin: 0;
      color: inherit;
      font-size: inherit;
      font-weight: inherit;
      line-height: inherit;
    }
    .cueweave-caption[data-mode="bilingual"][data-order="source-first"][data-translated="true"] .cueweave-source {
      order: -1;
      margin-top: 0;
      margin-bottom: 0.22em;
    }
    .cueweave-translate-action {
      display: none;
      align-items: center;
      justify-content: center;
      min-height: 2.15em;
      margin: 0.55em auto 0;
      padding: 0.28em 0.72em 0.32em;
      border: 1px solid rgb(242 163 58 / 58%);
      border-radius: 2px;
      color: #f7d9ad;
      background: rgb(54 43 30 / 88%);
      font: inherit;
      font-size: 0.56em;
      font-weight: 600;
      letter-spacing: 0.015em;
      line-height: 1.2;
      pointer-events: auto;
      cursor: pointer;
    }
    .cueweave-caption[data-action="true"] .cueweave-translate-action {
      display: inline-flex;
    }
    .cueweave-translate-action:hover:not(:disabled) {
      border-color: rgb(242 163 58 / 84%);
      background: rgb(72 52 31 / 94%);
    }
    .cueweave-translate-action:focus-visible {
      outline: 3px solid rgb(242 163 58 / 52%);
      outline-offset: 3px;
    }
    .cueweave-translate-action:disabled {
      color: #d4ccc1;
      border-color: rgb(212 204 193 / 28%);
      background: rgb(42 38 33 / 80%);
      cursor: wait;
    }
  `;
  overlayRoot = document.createElement('div');
  overlayRoot.className = 'cueweave-caption';
  overlayRoot.dataset.visible = 'false';
  overlayRoot.dataset.translated = 'false';
  overlayRoot.dataset.mode = subtitlePreferences.displayMode;
  overlayRoot.dataset.order = subtitlePreferences.bilingualOrder;
  overlayTranslation = document.createElement('div');
  overlayTranslation.className = 'cueweave-translation';
  overlaySource = document.createElement('div');
  overlaySource.className = 'cueweave-source';
  overlayTranslateButton = document.createElement('button');
  overlayTranslateButton.className = 'cueweave-translate-action';
  overlayTranslateButton.type = 'button';
  overlayTranslateButton.addEventListener('pointerdown', (event) => event.stopPropagation());
  overlayTranslateButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (overlayTranslateButton?.dataset.intent === 'configure') {
      void browser.runtime.openOptionsPage();
      return;
    }
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    if (video) void ensureTranslatedWindow(video.currentTime * 1_000, true);
  });
  overlayRoot.append(overlayTranslation, overlaySource, overlayTranslateButton);
  shadow.append(style, overlayRoot);
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

function formatTime(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function currentVideoContext(): {
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  transcriptEvidence?: string[];
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
  return {
    ...(rawTitle ? { videoTitle: rawTitle.slice(0, 200) } : {}),
    ...(channelName ? { channelName: channelName.slice(0, 120) } : {}),
    ...(videoDescription ? { videoDescription: videoDescription.slice(0, 1_200) } : {}),
    ...(transcriptEvidence.length > 0 ? { transcriptEvidence } : {}),
  };
}

function logTranslationEvent(
  event: 'start' | 'promote' | 'progress' | 'success' | 'failure',
  details: Record<string, boolean | number | string | undefined>,
): void {
  const payload = { event, ...details };
  if (event === 'failure') console.warn('[CueWeave] 字幕翻译', payload);
  else console.info('[CueWeave] 字幕翻译', payload);
}

function continuePrefetch(
  window: TokenWindow,
  remainingPrefetch: number,
  focusVersion: number,
): void {
  if (remainingPrefetch <= 0 || focusVersion !== translationFocusVersion) return;
  const windowIndex = tokenWindows.findIndex((candidate) => candidate.id === window.id);
  const nextWindow = tokenWindows[windowIndex + 1];
  if (nextWindow) void translateWindow(nextWindow, remainingPrefetch - 1, focusVersion);
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
  const deadline = Date.now() + 60_000;
  while (windowStates.get(windowId)?.status === 'working' && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
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
        fullTranslationStatus = 'error';
        fullTranslationMessage = '完整翻译已停止；请重新开始。';
        updateTranslationMetrics();
        return;
      }
      await translateWindow(window, 0, translationFocusVersion, true);
      await waitForWindowTranslation(window.id);
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
    fullTranslationJob = undefined;
  });
  return fullTranslationJob;
}

async function translateWindow(
  window: TokenWindow,
  remainingPrefetch: number,
  focusVersion: number,
  force = false,
): Promise<void> {
  const priority = remainingPrefetch === PREFETCH_WINDOW_COUNT ? 'current' : 'prefetch';
  const retryAfterMs = windowRetryAfterMs.get(window.id) ?? 0;
  if (force) {
    windowRetryAfterMs.delete(window.id);
    if (windowStates.get(window.id)?.status === 'failed') windowStates.delete(window.id);
  } else if (Date.now() < retryAfterMs) {
    return;
  } else if (retryAfterMs > 0) {
    windowRetryAfterMs.delete(window.id);
    if (windowStates.get(window.id)?.status === 'failed') windowStates.delete(window.id);
  }

  const existingState = windowStates.get(window.id);
  let promotingPrefetch = false;
  if (existingState) {
    if (existingState.status === 'ready') {
      continuePrefetch(window, remainingPrefetch, focusVersion);
      return;
    }
    if (existingState.status === 'working') {
      if (priority === 'current' && existingState.priority === 'prefetch') {
        windowStates.set(window.id, { status: 'working', priority: 'current' });
        promotingPrefetch = true;
      } else {
        return;
      }
    } else {
      return;
    }
  }
  const requestSession = subtitleSession;
  const requestTranslationSessionId = translationSessionId;

  if (!promotingPrefetch) windowStates.set(window.id, { status: 'working', priority });
  logTranslationEvent(promotingPrefetch ? 'promote' : 'start', {
    priority,
    startMs: window.startMs,
    endMs: window.endMs,
    tokenCount: window.tokens.length,
  });
  const requestStartedAt = performance.now();
  const previousCues = translatedCues
    .filter((cue) => cue.endMs < window.startMs)
    .slice(-6)
    .map((cue) => ({ sourceText: cue.sourceText, translation: cue.translation }));
  updateState({
    aiStatus: 'working',
    aiMessage:
      priority === 'current'
        ? '正在翻译当前位置。'
        : `正在准备 ${formatTime(window.endMs)} 前的后续字幕。`,
  });

  try {
    const result = (await browser.runtime.sendMessage({
      type: TRANSLATE_WINDOW_MESSAGE,
      tokens: window.tokens,
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
    })) as TranslateWindowResult;
    if (
      requestSession !== subtitleSession ||
      requestTranslationSessionId !== translationSessionId
    ) {
      return;
    }

    if (!result.ok) {
      windowStates.set(window.id, { status: 'failed', priority, failureCode: result.error.code });
      const needsConfiguration =
        result.error.code === 'not-configured' || result.error.code === 'permission-missing';
      windowRetryAfterMs.set(window.id, Date.now() + (needsConfiguration ? 15_000 : 30_000));
      logTranslationEvent('failure', {
        priority,
        startMs: window.startMs,
        endMs: window.endMs,
        durationMs: Math.round(performance.now() - requestStartedAt),
        code: result.error.code,
      });
      if (focusVersion !== translationFocusVersion) return;
      if (needsConfiguration) {
        updateState({ aiStatus: 'unconfigured', aiMessage: result.error.message });
      } else {
        updateState({ aiStatus: 'error', aiMessage: result.error.message });
      }
      return;
    }

    windowRetryAfterMs.delete(window.id);
    windowStates.set(window.id, { status: 'ready', priority });
    mergeTranslatedCues(result.cues);
    logTranslationEvent('success', {
      priority,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: Math.round(performance.now() - requestStartedAt),
      cacheHit: result.cacheHit,
      cueCount: result.cues.length,
    });
    if (focusVersion === translationFocusVersion) {
      updateState({
        aiStatus: 'ready',
        aiMessage: result.cacheHit
          ? `已从缓存恢复至 ${formatTime(window.endMs)}。`
          : `已预翻译至 ${formatTime(window.endMs)}。`,
      });
    }
    continuePrefetch(window, remainingPrefetch, focusVersion);
  } catch {
    if (
      requestSession !== subtitleSession ||
      requestTranslationSessionId !== translationSessionId
    ) {
      return;
    }
    windowStates.set(window.id, { status: 'failed', priority, failureCode: 'network' });
    windowRetryAfterMs.set(window.id, Date.now() + 30_000);
    logTranslationEvent('failure', {
      priority,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: Math.round(performance.now() - requestStartedAt),
      code: 'background-unreachable',
    });
    if (focusVersion !== translationFocusVersion) return;
    updateState({
      aiStatus: 'error',
      aiMessage: '无法连接扩展后台。CueWeave 已保留原文字幕。',
    });
  }
}

async function ensureTranslatedWindow(timeMs: number, force = false): Promise<void> {
  if (subtitlePreferences.displayMode === 'source') return;
  const window = windowAt(timeMs);
  if (!window) return;
  if (window.id !== focusedWindowId) {
    focusedWindowId = window.id;
    translationFocusVersion += 1;
  }
  await translateWindow(window, PREFETCH_WINDOW_COUNT, translationFocusVersion, force);
}

function handleVideoSeeked(event: Event): void {
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
  observedVideo = nextVideo;
  observedVideo?.addEventListener('seeked', handleVideoSeeked);
}

function renderLoop(): void {
  synchronizeVideoSession();
  const target = ensureOverlay();
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  observeVideo(video);
  const timeMs = video ? video.currentTime * 1_000 : 0;
  if (state.enabled && subtitlePreferences.displayMode !== 'source' && video && !video.seeking) {
    void ensureTranslatedWindow(timeMs);
  }
  const translatedCue =
    state.enabled && video ? currentDisplayCueAt(translatedCues, timeMs) : undefined;
  const fallbackCue = state.enabled && video ? currentDisplayCueAt(displayCues, timeMs) : undefined;
  const displayCue = translatedCue ?? fallbackCue;
  const translation = translatedCue?.translation ?? '';
  const source = displayCue?.sourceText ?? '';
  const activeWindow = state.enabled && video ? windowAt(timeMs) : undefined;
  const activeWindowState = activeWindow ? windowStates.get(activeWindow.id) : undefined;

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
        activeWindowState.stage === 'repairing-boundaries'
          ? '正在修复断句'
          : activeWindowState.stage === 'repairing-output'
            ? '正在修复字幕'
            : '正在翻译此处';
      actionDisabled = true;
    } else if (
      activeWindowState?.status === 'failed' &&
      (activeWindowState.failureCode === 'not-configured' ||
        activeWindowState.failureCode === 'permission-missing')
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
  activeRequest?.abort();
  activeRequest = new AbortController();
  displayCues = [];
  translatedCues = [];
  sourceTokens = [];
  tokenWindows = [];
  windowStates.clear();
  windowRetryAfterMs.clear();
  focusedWindowId = '';
  translationFocusVersion += 1;
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
    const cues = await requestCaptionTrack(track, activeRequest.signal);
    if (activeRequest.signal.aborted || trackKey !== loadedTrackKey) return;
    sourceTokens = buildSourceTokens(cues);
    displayCues = createLocalDisplayCues(sourceTokens);
    tokenWindows = createTokenWindows(sourceTokens);
    updateTranslationMetrics();
    updateState({
      status: 'ready',
      cueCount: cues.length,
      displayCueCount: displayCues.length,
      aiStatus: 'idle',
      message: `已整理 ${displayCues.length} 条可显示字幕。`,
    });
  } catch (error) {
    if (activeRequest.signal.aborted || trackKey !== loadedTrackKey) return;
    displayCues = [];
    translatedCues = [];
    sourceTokens = [];
    tokenWindows = [];
    windowStates.clear();
    windowRetryAfterMs.clear();
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
  async main() {
    observedLocationVideoId = videoIdFromYouTubeUrl(window.location.href);
    try {
      const contentSettings = (await browser.runtime.sendMessage({
        type: GET_CONTENT_SETTINGS_MESSAGE,
      })) as Partial<ContentSettings>;
      subtitlePreferences = parseSubtitlePreferences(contentSettings.subtitlePreferences);
      updateState({
        enabled: contentSettings.enabled !== false,
        displayMode: subtitlePreferences.displayMode,
      });
    } catch {
      updateState({ enabled: true });
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === TRANSLATION_PROGRESS_MESSAGE &&
        'windowId' in message &&
        typeof message.windowId === 'string' &&
        'stage' in message &&
        (message.stage === 'translating' ||
          message.stage === 'repairing-boundaries' ||
          message.stage === 'repairing-output')
      ) {
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
        if (message.windowId === focusedWindowId) {
          updateState({
            aiStatus: 'working',
            aiMessage:
              message.stage === 'repairing-boundaries'
                ? '正在修复当前位置的断句。'
                : message.stage === 'repairing-output'
                  ? '正在修复当前位置的字幕结果。'
                  : '正在翻译当前位置。',
          });
        }
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
        if (correctionSettingChanged || switchingToSource) {
          rotateTranslationSession();
        }
        if (switchingToSource) {
          windowStates.forEach((windowState, windowId) => {
            if (windowState.status === 'working') windowStates.delete(windowId);
          });
        }
        if (correctionSettingChanged) {
          translatedCues = [];
          windowStates.clear();
          windowRetryAfterMs.clear();
          fullTranslationStatus = 'idle';
          fullTranslationMessage = '';
          updateTranslationMetrics();
        }
        updateState({ displayMode: subtitlePreferences.displayMode });
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

    window.addEventListener('yt-navigate-start', () => {
      resetSubtitleSession(undefined, '正在切换视频。');
    });
    window.addEventListener('yt-navigate-finish', () => {
      synchronizeVideoSession();
    });
    window.addEventListener('popstate', synchronizeVideoSession);

    window.requestAnimationFrame(renderLoop);
  },
});
