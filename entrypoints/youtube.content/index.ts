import {
  buildSourceTokens,
  createLocalDisplayCues,
  createTokenWindows,
  type DisplayCue,
  type RawCue,
  type SourceToken,
  type TokenWindow,
} from '../../src/domain/subtitle';
import { TRANSLATE_WINDOW_MESSAGE, type TranslateWindowResult } from '../../src/provider/messages';
import {
  CAPTION_TRACK_REQUEST_EVENT,
  CAPTION_TRACK_RESPONSE_EVENT,
  CAPTION_TRACKS_EVENT,
  GET_CONTENT_SETTINGS_MESSAGE,
  GET_CONTENT_STATE_MESSAGE,
  SET_CONTENT_ENABLED_MESSAGE,
  SET_SUBTITLE_PREFERENCES_MESSAGE,
  type CaptionTrack,
  type CaptionTrackRequestDetail,
  type CaptionTrackResponseDetail,
  type CaptionTracksEventDetail,
  type ContentState,
  type ContentSettings,
} from '../../src/platform/youtube/types';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  parseSubtitlePreferences,
  type SubtitlePreferences,
} from '../../src/settings/subtitle';

const OVERLAY_ID = 'cueweave-subtitle-overlay';
const PREFETCH_WINDOW_COUNT = 3;

type WindowTranslationStatus = 'working' | 'ready' | 'failed';

interface WindowTranslationState {
  status: WindowTranslationStatus;
  priority: 'current' | 'prefetch';
  failureCode?: string;
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

function updateState(patch: Partial<ContentState>): void {
  state = { ...state, ...patch };
  const host = document.getElementById(OVERLAY_ID);
  if (host) reflectState(host);
}

function reflectState(host: HTMLElement): void {
  host.dataset.cueweaveStatus = state.status;
  host.dataset.cueweaveCueCount = String(state.cueCount);
  host.dataset.cueweaveDisplayCueCount = String(state.displayCueCount);
  host.dataset.cueweaveAiStatus = state.aiStatus;
  host.dataset.cueweaveAiMessage = state.aiMessage ?? '';
  host.dataset.cueweaveMessage = state.message ?? '';
  host.dataset.cueweaveDisplayMode = subtitlePreferences.displayMode;
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
  if (overlayRoot) overlayRoot.dataset.mode = subtitlePreferences.displayMode;
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
    .cueweave-caption[data-visible="true"] { display: block; }
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

  if (!promotingPrefetch) windowStates.set(window.id, { status: 'working', priority });
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
      },
      priority,
    })) as TranslateWindowResult;
    if (requestSession !== subtitleSession) return;

    if (!result.ok) {
      windowStates.set(window.id, { status: 'failed', priority, failureCode: result.error.code });
      const needsConfiguration =
        result.error.code === 'not-configured' || result.error.code === 'permission-missing';
      windowRetryAfterMs.set(window.id, Date.now() + (needsConfiguration ? 15_000 : 30_000));
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
    if (requestSession !== subtitleSession) return;
    windowStates.set(window.id, { status: 'failed', priority, failureCode: 'network' });
    windowRetryAfterMs.set(window.id, Date.now() + 30_000);
    if (focusVersion !== translationFocusVersion) return;
    updateState({
      aiStatus: 'error',
      aiMessage: '无法连接扩展后台。CueWeave 已保留原文字幕。',
    });
  }
}

async function ensureTranslatedWindow(timeMs: number, force = false): Promise<void> {
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
  if (state.enabled) void ensureTranslatedWindow(video.currentTime * 1_000, true);
}

function observeVideo(video: HTMLVideoElement | null | undefined): void {
  const nextVideo = video ?? undefined;
  if (nextVideo === observedVideo) return;
  observedVideo?.removeEventListener('seeked', handleVideoSeeked);
  observedVideo = nextVideo;
  observedVideo?.addEventListener('seeked', handleVideoSeeked);
}

function renderLoop(): void {
  const target = ensureOverlay();
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  observeVideo(video);
  const timeMs = video ? video.currentTime * 1_000 : 0;
  if (state.enabled && video && !video.seeking) void ensureTranslatedWindow(timeMs);
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
  if (fallbackCue && !translatedCue && activeWindow) {
    if (activeWindowState?.status === 'working') {
      actionLabel = '正在翻译此处';
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
    const showSource = subtitlePreferences.displayMode === 'bilingual';
    target.dataset.action = actionLabel ? 'true' : 'false';
    target.dataset.visible =
      translation || (showSource && source) || actionLabel ? 'true' : 'false';
    target.dataset.translated = translation ? 'true' : 'false';
    target.dataset.mode = subtitlePreferences.displayMode;
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
  const track = preferredTrack(detail.tracks);
  if (!track) {
    subtitleSession += 1;
    loadedTrackKey = '';
    displayCues = [];
    translatedCues = [];
    sourceTokens = [];
    tokenWindows = [];
    windowStates.clear();
    windowRetryAfterMs.clear();
    focusedWindowId = '';
    translationFocusVersion += 1;
    updateState({
      status: detail.videoId ? 'no-captions' : 'idle',
      videoId: detail.videoId || undefined,
      languageCode: undefined,
      cueCount: 0,
      displayCueCount: 0,
      aiStatus: 'idle',
      aiMessage: undefined,
      message: detail.videoId ? '当前视频没有可用字幕。' : undefined,
    });
    return;
  }

  const trackKey = `${detail.videoId}:${track.languageCode}:${track.baseUrl}`;
  if (trackKey === loadedTrackKey) return;
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
        message.type === GET_CONTENT_STATE_MESSAGE
      ) {
        return Promise.resolve(state);
      }
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === SET_CONTENT_ENABLED_MESSAGE &&
        'enabled' in message &&
        typeof message.enabled === 'boolean'
      ) {
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
        subtitlePreferences = parseSubtitlePreferences(message.preferences);
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

    window.requestAnimationFrame(renderLoop);
  },
});
