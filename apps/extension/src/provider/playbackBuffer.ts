import type { TokenWindow } from '@cueweave/core/subtitle';
import type { TranslationPriority, TranslationProgressStage } from './messages';

export const PLAYBACK_BUFFER_POLICY = {
  playingSeconds: 90,
  pausedSeconds: 120,
  maxMediaSeconds: 300,
  maxWindows: 20,
  maxWorking: 2,
  tickMs: 500,
  retryDelaysMs: [2_000, 5_000, 15_000] as readonly number[],
};

export interface BufferWindowState {
  status: 'working' | 'ready' | 'failed';
  priority: TranslationPriority;
  stage?: TranslationProgressStage;
  failureCode?: string;
  failureMessage?: string;
  failures?: number;
  retryAt?: number;
}
export interface PlaybackPosition {
  timeMs: number;
  paused: boolean;
  playbackRate: number;
  enabled: boolean;
  seeking: boolean;
}
export interface PlaybackBufferSnapshot {
  contiguousUntilMs: number;
  availableSeconds: number;
  targetSeconds: number;
  complete: boolean;
  firstMissingIndex: number | undefined;
}
export interface BufferWork {
  window: TokenWindow;
  priority: TranslationPriority;
}
export function configurationFailure(code?: string): boolean {
  return ['not-configured', 'permission-missing', 'authentication', 'model-not-found'].includes(
    code ?? '',
  );
}

export function failedBufferWindow(
  previous: BufferWindowState | undefined,
  code: string,
  message: string,
  priority: TranslationPriority,
  now: number,
): BufferWindowState {
  const failures = (previous?.failures ?? 0) + 1;
  const delay = configurationFailure(code)
    ? undefined
    : PLAYBACK_BUFFER_POLICY.retryDelaysMs[failures - 1];
  return {
    status: 'failed',
    priority,
    failureCode: code,
    failureMessage: message,
    failures,
    ...(delay !== undefined ? { retryAt: now + delay } : {}),
  };
}

export function selectBufferWork(
  windows: readonly TokenWindow[],
  states: ReadonlyMap<string, BufferWindowState>,
  position: PlaybackPosition,
  now: number,
) {
  const rate =
    Number.isFinite(position.playbackRate) && position.playbackRate > 0 ? position.playbackRate : 1;
  let targetMediaMs = Math.min(
    PLAYBACK_BUFFER_POLICY.maxMediaSeconds * 1000,
    (position.paused
      ? PLAYBACK_BUFFER_POLICY.pausedSeconds
      : PLAYBACK_BUFFER_POLICY.playingSeconds) *
      1000 *
      rate,
  );
  const first = windows.findIndex((w) => w.endMs > position.timeMs);
  const limit = windows[first + PLAYBACK_BUFFER_POLICY.maxWindows];
  if (first !== -1 && limit)
    targetMediaMs = Math.min(targetMediaMs, Math.max(0, limit.startMs - position.timeMs));
  let contiguousUntilMs = position.timeMs;
  let firstMissingIndex: number | undefined;
  if (first !== -1) {
    for (let i = first; i < windows.length; i++) {
      const window = windows[i]!;
      // Silence between source windows needs no translation, unlike an unfinished owned range.
      contiguousUntilMs = Math.max(contiguousUntilMs, window.startMs);
      if (states.get(window.id)?.status !== 'ready') {
        firstMissingIndex = i;
        break;
      }
      contiguousUntilMs = Math.max(contiguousUntilMs, window.endMs);
    }
  }
  const buffer: PlaybackBufferSnapshot = {
    contiguousUntilMs,
    availableSeconds: Math.max(0, (contiguousUntilMs - position.timeMs) / 1000 / rate),
    targetSeconds: targetMediaMs / 1000 / rate,
    complete: windows.length > 0 && firstMissingIndex === undefined,
    firstMissingIndex,
  };
  const work: BufferWork[] = [],
    promotions: TokenWindow[] = [];
  if (!position.enabled || position.seeking || first === -1) return { buffer, work, promotions };
  // A provider configuration error affects every window, not just the one that discovered it.
  if (
    [...states.values()].some((s) => s.status === 'failed' && configurationFailure(s.failureCode))
  )
    return { buffer, work, promotions };
  let slots = Math.max(
    0,
    PLAYBACK_BUFFER_POLICY.maxWorking -
      [...states.values()].filter((s) => s.status === 'working').length,
  );
  const nearest =
    firstMissingIndex === undefined ? undefined : states.get(windows[firstMissingIndex]!.id);
  let reserved = nearest?.status === 'failed' && nearest.retryAt !== undefined ? 1 : 0;
  const horizon = position.timeMs + targetMediaMs;
  for (
    let i = first;
    i < Math.min(windows.length, first + PLAYBACK_BUFFER_POLICY.maxWindows);
    i++
  ) {
    const window = windows[i]!;
    if (window.startMs >= horizon) break;
    const state = states.get(window.id);
    const priority = i === firstMissingIndex ? 'current' : 'prefetch';
    if (state?.status === 'ready') continue;
    if (state?.status === 'working') {
      if (priority === 'current' && state.priority !== 'current') promotions.push(window);
      continue;
    }
    if (state?.status === 'failed' && (state.retryAt === undefined || state.retryAt > now))
      continue;
    if (i !== firstMissingIndex && slots <= reserved) continue;
    if (slots > 0) {
      work.push({ window, priority });
      slots--;
      if (i === firstMissingIndex) reserved = 0;
    }
  }
  return { buffer, work, promotions };
}

/** Pure status text: never claim that a later isolated success covers an earlier hole. */
export function bufferPresentation(buffer: PlaybackBufferSnapshot, missing?: BufferWindowState) {
  const seconds = Math.floor(buffer.availableSeconds);
  const available = `字幕已连续准备 ${seconds} 秒`;
  if (buffer.complete) return { status: 'ready' as const, message: '剩余字幕已全部准备好。' };
  if (buffer.availableSeconds >= buffer.targetSeconds)
    return { status: 'ready' as const, message: `${available}。` };
  if (missing?.status === 'failed') {
    if (configurationFailure(missing.failureCode))
      return {
        status: 'unconfigured' as const,
        message: `${seconds > 0 ? `${available}。` : ''}${missing.failureMessage ?? '请检查模型配置后重试。'}`,
      };
    return {
      status: 'error' as const,
      message: `${seconds > 0 ? `${available}；` : '当前位置字幕尚未完成；'}${missing.retryAt !== undefined ? '前方缺失字幕将自动重试。' : '自动重试未完成，请重试此处或检查模型连接。'}`,
    };
  }
  const stage = missing?.stage;
  const action =
    stage === 'planning'
      ? '正在规划字幕窗口'
      : stage === 'retrying'
        ? '连接暂时中断，正在自动重试'
        : stage === 'resolving-entities'
          ? '正在识别专有名词'
          : stage === 'repairing-output'
            ? '正在恢复字幕结果'
            : '正在翻译字幕';
  return {
    status: seconds >= buffer.targetSeconds ? ('ready' as const) : ('working' as const),
    message:
      seconds > 0
        ? `${available}${seconds < buffer.targetSeconds ? '，正在补充后续字幕。' : '。'}`
        : `${action}。`,
  };
}
