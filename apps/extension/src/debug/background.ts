import { readProviderSettings } from '../provider/settings';
import { readSubtitlePreferences } from '../settings/subtitle';
import { readVideoGlossaryState } from '../context/videoGlossary';
import { videoIdFromYouTubeUrl } from '../platform/youtube/navigation';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '@cueweave/core/subtitle/ai';
import { FIRST_PASS_VERSION } from '@cueweave/core/provider/firstPass';
import { PLAYBACK_PLAN_VERSION } from '@cueweave/core/provider/playbackPlan';
import { ENTITY_ALIAS_PROMPT_VERSION } from '@cueweave/core/subtitle';
import type { DebugRecorder } from './recorder';
import { redactDebug, providerSecrets } from './redact';
import { DEBUG_BUILD_ID } from './build';
import { debugFilename, selectDebugRecords } from './report';
import {
  CAPTURE_DEBUG_SNAPSHOT,
  DEBUG_POLICY,
  type DebugExportResult,
  type DebugSnapshot,
} from './types';

export async function exportDebugReport(
  recorder: DebugRecorder,
  tabId: number,
): Promise<DebugExportResult> {
  const requestedAt = Date.now();
  const initial = await recorder.read();
  if (!initial.enabled) return { ok: false, message: '调试模式已关闭，请先在设置中开启。' };
  const tab = await browser.tabs.get(tabId);
  const videoId = videoIdFromYouTubeUrl(tab.url ?? '');
  if (!videoId || new URL(tab.url!).hostname !== 'www.youtube.com')
    return { ok: false, message: '请在需要反馈的 YouTube 视频页面导出日志。' };

  let snapshot: DebugSnapshot | null = null;
  const missing: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = (await Promise.race([
      browser.tabs.sendMessage(tabId, { type: CAPTURE_DEBUG_SNAPSHOT }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('内容脚本未及时响应')), 3_000);
      }),
    ])) as DebugSnapshot | undefined;
    if (
      !value ||
      value.videoId !== videoId ||
      typeof value.capturedAt !== 'number' ||
      !Array.isArray(value.windows)
    ) {
      missing.push('视频页面未返回匹配的现场快照；播放位置未知。');
    } else snapshot = value;
  } catch {
    missing.push('无法连接当前视频的内容脚本；已保留可用后台日志，播放位置未知。');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const capturedAt = snapshot?.capturedAt ?? requestedAt;
  const [provider, preferences, glossary] = await Promise.allSettled([
    readProviderSettings(),
    readSubtitlePreferences(),
    readVideoGlossaryState(videoId),
  ]);
  const settings = provider.status === 'fulfilled' ? provider.value : null;
  if (!settings) missing.push('模型设置读取失败。');
  if (preferences.status === 'rejected') missing.push('字幕显示设置读取失败。');
  if (glossary.status === 'rejected') missing.push('当前术语读取失败。');
  const current = await recorder.read();
  if (!current.enabled || current.generation !== initial.generation)
    return { ok: false, message: '调试模式在导出期间发生变化，请重新导出。' };
  const records = selectDebugRecords(current.records, videoId, tabId, snapshot, capturedAt);
  if (!records.some((r) => r.kind === 'request'))
    missing.push('相关原始请求记录不可用：可能命中缓存、开启调试前已生成，或记录已过期。');
  if (
    records.some(
      (r) =>
        r.kind === 'window-result' &&
        (r.data as { detail?: { cacheHit?: boolean } }).detail?.cacheHit === true,
    )
  )
    missing.push('部分结果来自缓存；缓存结果不附带生成它的原始请求，邻近请求不一定是其来源。');
  if (records.some((r) => JSON.stringify(r.data).includes('size-limit')))
    missing.push('部分记录超过容量限制，省略位置已标记。');
  if (
    records.some((r) => r.kind === 'request' && (r.data as { state?: string }).state === 'pending')
  )
    missing.push('部分模型请求尚未取得完整响应，已保留请求开始记录。');
  if (current.evictedRecords) missing.push('较早的日志已按保留策略清理；不保证包含全部历史尝试。');
  if (recorder.lastError) missing.push(recorder.lastError);
  const report = redactDebug(
    {
      schemaVersion: 1,
      capturedAt: new Date(capturedAt).toISOString(),
      collectedAt: new Date().toISOString(),
      video: {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: snapshot?.videoTitle ?? tab.title ?? null,
        timeMs: snapshot?.timeMs ?? null,
        tabId,
      },
      build: {
        background: DEBUG_BUILD_ID,
        content: snapshot?.contentBuild ?? null,
        extensionVersion: browser.runtime.getManifest().version,
        aiPrompt: AI_PROMPT_VERSION,
        firstPass: FIRST_PASS_VERSION,
        segmentation: DISPLAY_SEGMENTATION_VERSION,
        playbackPlan: PLAYBACK_PLAN_VERSION,
        entityAliases: ENTITY_ALIAS_PROMPT_VERSION,
      },
      environment: { userAgent: navigator.userAgent, language: navigator.language },
      recording: {
        enabledAt: current.enabledAt,
        policy: DEBUG_POLICY,
        evictedRecords: current.evictedRecords,
      },
      provider: settings
        ? { baseUrl: settings.baseUrl, model: settings.model, protocol: settings.protocol }
        : null,
      preferences: preferences.status === 'fulfilled' ? preferences.value : null,
      currentGlossary: glossary.status === 'fulfilled' ? glossary.value : null,
      snapshot,
      records,
      missing,
    },
    settings ? providerSecrets(settings.apiKey, settings.baseUrl) : [],
  );
  return {
    ok: true,
    filename: debugFilename(videoId, snapshot?.timeMs ?? null, capturedAt),
    json: JSON.stringify(report, null, 2),
    partial: missing.length > 0,
  };
}

export function exportFailure(): DebugExportResult {
  return { ok: false, message: '日志导出失败，请重新打开视频弹窗后再试。' };
}
