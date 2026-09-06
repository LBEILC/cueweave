import type {
  TranscriptReport,
  ContentState,
} from '../../apps/extension/src/platform/youtube/types';
import type { DisplayCue, TranscriptCorrection, TranslationTerm } from '@cueweave/core/subtitle';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  type SubtitlePreferences,
} from '../../apps/extension/src/settings/subtitle';

// Synthetic, in-memory UI fixtures. This bridge is bundled only by preview-ui.mjs.
const scenario = new URLSearchParams(window.location.search).get('state') ?? 'partial';
const examples = [
  [
    'Soul is the model we use for this task.',
    'Sol is the model we use for this task.',
    '我们用 Sol 模型来完成这个任务。',
    true,
    0.98,
    'proper-noun',
  ],
  [
    'I think a cleareyed view is important.',
    'I think a clear-eyed view is important.',
    '我认为保持清醒的认识很重要。',
    true,
    0.96,
    'formatting',
  ],
  [
    'We should check the agent evaluation harness before changing the model.',
    'We should check the agent evaluation framework before changing the model.',
    '我们应该先检查智能体的评估工具，再更换模型。',
    false,
    0.67,
    'other',
  ],
] as const;
const corrections: TranscriptCorrection[] = examples.map((row, index) => ({
  id: `example-${index}`,
  startIndex: index,
  endIndex: index,
  sourceTokenIds: [`token-${index}`],
  startMs: 354560 + index * 6000,
  endMs: 360160 + index * 6000,
  originalText: row[0],
  correctedText: row[1],
  applied: row[3],
  confidence: row[4],
  category: row[5],
}));
const cues: DisplayCue[] = examples.map((row, index) => ({
  id: `cue-${index}`,
  sourceTokenIds: [`token-${index}`],
  startMs: corrections[index]!.startMs,
  endMs: corrections[index]!.endMs,
  sourceText: row[3] ? row[1] : row[0],
  originalText: row[0],
  translation: row[2],
  sentenceEnd: true,
  status: 'translated',
  corrections: [corrections[index]!],
}));
const report: TranscriptReport = {
  videoId: 'preview-video',
  videoTitle: 'AI 模型与智能体评估 · 示例视频',
  languageCode: 'en',
  originalCues: cues.map((cue) => ({
    ...cue,
    sourceText: cue.originalText!,
    translation: '',
    status: 'pending',
  })),
  translatedCues: cues,
  corrections: scenario === 'empty' ? [] : corrections,
  terminology: [],
  translatedWindowCount: scenario === 'complete' ? 12 : 4,
  totalWindowCount: 12,
  translationComplete: scenario === 'complete',
  fullTranslationStatus:
    scenario === 'complete' ? 'ready' : scenario === 'failure' ? 'error' : 'idle',
  ...(scenario === 'failure' ? { message: '模型暂时没有响应，已完成的字幕会保留。' } : {}),
};
let manualTerms: TranslationTerm[] =
  scenario === 'empty' ? [] : [{ source: 'Soul', translation: 'Sol' }];
let cacheCount = 4;
let debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
let startedAt = 0;
const stored: Record<string, unknown> = {
  'cueweave.enabled': scenario !== 'disabled',
  'cueweave.provider': {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'preview-key',
    model: 'example-model',
    protocol: 'auto',
  },
  'cueweave.subtitle-preferences': { ...DEFAULT_SUBTITLE_PREFERENCES },
};
const cacheStats = () => ({
  entryCount: cacheCount,
  cueCount: cacheCount * 12,
  byteSize: cacheCount * 4096,
});
const previewDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 650));
const glossary = () => ({ terms: [], manualTerms: [...manualTerms] });
const invalidate = () => {
  report.translationComplete = false;
  report.fullTranslationStatus = 'idle';
  report.translatedWindowCount = 0;
  delete report.message;
  startedAt = 0;
  cacheCount = 0;
};
Object.assign(globalThis, {
  browser: {
    permissions: { request: async () => true },
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values);
        },
      },
    },
    tabs: {
      query: async () =>
        scenario === 'disconnected'
          ? []
          : [{ id: 1, url: 'https://www.youtube.com/watch?v=preview-video' }],
      create: async ({ url }: { url: string }) => {
        const target = new URL(url);
        if (target.origin !== window.location.origin) throw new Error('预览仅支持本地页面。');
        const theme = new URLSearchParams(window.location.search).get('theme') ?? 'light';
        const logo = new URLSearchParams(window.location.search).get('logo') ?? '';
        const surface = target.pathname === '/options.html' ? 'options' : 'review';
        window.top!.location.href = '/?' + new URLSearchParams({ surface, theme, logo });
      },
      sendMessage: async (_tabId: number, message: { type: string }) => {
        switch (message.type) {
          case 'cueweave:get-content-state':
            return {
              status: 'ready',
              enabled: true,
              videoId: report.videoId,
              languageCode: 'en',
              cueCount: 126,
              displayCueCount: 48,
              displayMode: (stored['cueweave.subtitle-preferences'] as SubtitlePreferences)
                .displayMode,
              aiStatus: scenario === 'failure' ? 'error' : 'ready',
              ...(scenario === 'failure' ? { aiMessage: report.message } : {}),
            } satisfies ContentState;
          case 'cueweave:get-transcript-report':
            if (startedAt) {
              report.translatedWindowCount = Math.min(
                12,
                4 + Math.floor((Date.now() - startedAt) / 400),
              );
              report.translationComplete = report.translatedWindowCount === 12;
              report.fullTranslationStatus = report.translationComplete ? 'ready' : 'working';
            }
            return { ...report };
          case 'cueweave:start-full-translation':
            startedAt = Date.now();
            report.fullTranslationStatus = 'working';
            delete report.message;
            return { ok: true };
          case 'cueweave:set-content-enabled':
            return { ok: true };
          default:
            throw new Error('预览不支持此视频操作。');
        }
      },
    },
    runtime: {
      getURL: (path: string) => new URL(path, window.location.origin).href,
      sendMessage: async (message: {
        type: string;
        term?: TranslationTerm;
        source?: string;
        preferences?: SubtitlePreferences;
        displayMode?: SubtitlePreferences['displayMode'];
        enabled?: boolean;
      }) => {
        switch (message.type) {
          case 'cueweave:get-debug-state':
            return { ok: true, enabled: debugEnabled };
          case 'cueweave:set-debug-state':
            await previewDelay();
            if (scenario === 'failure') return { ok: false };
            debugEnabled = message.enabled === true;
            return { ok: true, enabled: debugEnabled };
          case 'cueweave:export-debug-report':
            await previewDelay();
            return scenario === 'failure'
              ? { ok: false, message: '示例导出失败，请重新打开弹窗后再试。' }
              : {
                  ok: true,
                  partial: false,
                  filename: 'cueweave-debug-preview.json',
                  json: JSON.stringify(
                    {
                      preview: true,
                      video: { id: report.videoId, timeMs: 354560 },
                      translatedCues: cues,
                      records: [],
                    },
                    null,
                    2,
                  ),
                };
          case 'cueweave:test-provider':
            await previewDelay();
            return scenario === 'failure'
              ? {
                  ok: false,
                  message: '示例连接失败，请检查服务地址与 API Key 后重试。',
                  details:
                    '错误类型: network\n\n接口协议: chat-completions\n\n请求: POST https://provider.example/v1/chat/completions\n\n底层错误: TypeError: Failed to fetch\n\n未收到 HTTP 响应。浏览器可能只提供 Failed to fetch，无法据此区分网络、跨域、证书或权限问题。',
                }
              : { ok: true, message: '示例连接测试成功。预览未向模型发送请求。' };
          case 'cueweave:update-subtitle-preferences':
            await previewDelay();
            if (scenario === 'failure') return { ok: false };
            stored['cueweave.subtitle-preferences'] = message.preferences;
            return { ok: true, preferences: message.preferences };
          case 'cueweave:update-subtitle-display-mode': {
            await previewDelay();
            if (scenario === 'failure') return { ok: false };
            const preferences = {
              ...(stored['cueweave.subtitle-preferences'] as SubtitlePreferences),
              displayMode: message.displayMode,
            };
            stored['cueweave.subtitle-preferences'] = preferences;
            return { ok: true, preferences };
          }
          case 'cueweave:get-video-glossary':
            return { ok: true, glossary: glossary() };
          case 'cueweave:upsert-video-glossary-term': {
            const term = message.term!;
            manualTerms = [
              ...manualTerms.filter(
                (item) => item.source.toLowerCase() !== term.source.toLowerCase(),
              ),
              term,
            ];
            invalidate();
            return { ok: true, glossary: glossary() };
          }
          case 'cueweave:delete-video-glossary-term':
            manualTerms = manualTerms.filter((item) => item.source !== message.source);
            invalidate();
            return { ok: true, glossary: glossary() };
          case 'cueweave:get-translation-cache-stats':
            return { ok: true, stats: cacheStats() };
          case 'cueweave:clear-translation-cache': {
            const removedEntries = cacheCount;
            cacheCount = 0;
            return { ok: true, removedEntries, stats: cacheStats() };
          }
          default:
            throw new Error('预览不连接模型服务。');
        }
      },
    },
  },
});
