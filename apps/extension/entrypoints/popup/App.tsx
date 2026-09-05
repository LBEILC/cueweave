import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  MagicWandIcon,
  SubtitlesIcon,
  TrashIcon,
  WarningCircleIcon,
  YoutubeLogoIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Brand } from '../../src/ui/Brand';
import {
  GET_DEBUG_STATE,
  EXPORT_DEBUG_REPORT,
  type DebugExportResult,
} from '../../src/debug/types';
import {
  CLEAR_TRANSLATION_CACHE_MESSAGE,
  GET_TRANSLATION_CACHE_STATS_MESSAGE,
} from '../../src/provider/messages';
import {
  GET_CONTENT_STATE_MESSAGE,
  SET_CONTENT_ENABLED_MESSAGE,
  UPDATE_SUBTITLE_DISPLAY_MODE_MESSAGE,
  type ContentState,
} from '../../src/platform/youtube/types';
import {
  readSubtitlePreferences,
  type SubtitleDisplayMode,
  type SubtitlePreferences,
} from '../../src/settings/subtitle';

const ENABLED_KEY = 'cueweave.enabled';

interface ViewState {
  loading: boolean;
  isYouTubeVideo: boolean;
  content?: ContentState;
  tabId?: number;
}

interface StatusPresentation {
  Icon: Icon;
  tone: 'neutral' | 'working' | 'success' | 'warning';
  title: string;
  detail: string;
}

function isYouTubeVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.youtube.com' &&
      (parsed.pathname === '/watch' || parsed.pathname.startsWith('/shorts/'))
    );
  } catch {
    return false;
  }
}

function statusPresentation(view: ViewState): StatusPresentation {
  if (view.loading) {
    return {
      Icon: CircleNotchIcon,
      tone: 'working',
      title: '正在检查当前页面',
      detail: '读取视频与字幕状态。',
    };
  }

  if (!view.isYouTubeVideo) {
    return {
      Icon: YoutubeLogoIcon,
      tone: 'neutral',
      title: '打开 YouTube 视频',
      detail: 'CueWeave 会读取视频已有的字幕轨。',
    };
  }

  if (!view.content) {
    return {
      Icon: WarningCircleIcon,
      tone: 'warning',
      title: '刷新当前视频页面',
      detail: '页面尚未载入 CueWeave 内容脚本。',
    };
  }

  switch (view.content.status) {
    case 'loading':
      return {
        Icon: CircleNotchIcon,
        tone: 'working',
        title: '正在整理字幕',
        detail: view.content.message ?? '正在读取字幕轨。',
      };
    case 'ready':
      if (view.content.displayMode === 'source') {
        return {
          Icon: CheckCircleIcon,
          tone: 'success',
          title: '原文字幕已就绪',
          detail: view.content.message ?? '当前位置会显示整理后的原文字幕。',
        };
      }
      if (view.content.aiStatus === 'working') {
        return {
          Icon: CircleNotchIcon,
          tone: 'working',
          title: (view.content.bufferedSeconds ?? 0) > 0 ? '正在补充后续字幕' : '正在准备翻译字幕',
          detail: view.content.aiMessage ?? '正在生成当前位置的双语字幕。',
        };
      }
      if (view.content.aiStatus === 'ready') {
        return {
          Icon: CheckCircleIcon,
          tone: 'success',
          title: view.content.displayMode === 'translation' ? '中文字幕已就绪' : '双语字幕已就绪',
          detail: view.content.aiMessage ?? '当前位置已完成语义断句和翻译。',
        };
      }
      if (view.content.aiStatus === 'error') {
        return {
          Icon: WarningCircleIcon,
          tone: 'warning',
          title: (view.content.bufferedSeconds ?? 0) > 0 ? '前方字幕待补齐' : '翻译暂时不可用',
          detail: view.content.aiMessage ?? '请在播放器中重试，或到设置检查模型连接。',
        };
      }
      return {
        Icon: CheckCircleIcon,
        tone: 'success',
        title: '原文字幕已就绪',
        detail:
          view.content.aiStatus === 'unconfigured'
            ? '配置模型后可生成语义断句和中文字幕。'
            : (view.content.message ?? '字幕会随播放位置同步显示。'),
      };
    case 'no-captions':
      return {
        Icon: WarningCircleIcon,
        tone: 'warning',
        title: '当前视频没有可用字幕',
        detail: '请选择带字幕的视频后再试。',
      };
    case 'error':
      return {
        Icon: WarningCircleIcon,
        tone: 'warning',
        title: '字幕读取失败',
        detail: view.content.message ?? '刷新视频页面后重试。',
      };
    default:
      return {
        Icon: SubtitlesIcon,
        tone: 'neutral',
        title: '等待字幕轨',
        detail: '播放视频或切换字幕轨后会自动读取。',
      };
  }
}

export function App() {
  const [enabled, setEnabled] = useState(true);
  const [view, setView] = useState<ViewState>({ loading: true, isYouTubeVideo: false });
  const [currentCacheEntries, setCurrentCacheEntries] = useState<number>();
  const [cacheMessage, setCacheMessage] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [displayMode, setDisplayMode] = useState<SubtitleDisplayMode>();
  const [savingMode, setSavingMode] = useState(false);
  const [modeMessage, setModeMessage] = useState('');
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [exportingDebug, setExportingDebug] = useState(false);
  const [debugMessage, setDebugMessage] = useState('');

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: GET_DEBUG_STATE })
      .then((result: { ok?: boolean; enabled?: boolean }) =>
        setDebugEnabled(result.ok === true && result.enabled === true),
      )
      .catch(() => setDebugMessage('无法读取调试设置，请重新打开弹窗。'));
  }, []);

  const exportDebug = async () => {
    if (view.tabId === undefined) return;
    setExportingDebug(true);
    setDebugMessage('正在保存当前位置的日志…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = (await Promise.race([
        browser.runtime.sendMessage({ type: EXPORT_DEBUG_REPORT, tabId: view.tabId }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('日志导出超时，请重新打开弹窗后再试。')),
            15_000,
          );
        }),
      ])) as DebugExportResult;
      if (!result.ok) throw new Error(result.message);
      const url = URL.createObjectURL(
        new Blob([result.json], { type: 'application/json;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setDebugMessage(
        result.partial
          ? '已生成日志文件，缺失的信息已在文件中注明。'
          : '已生成日志文件，可附上问题描述一起反馈。',
      );
    } catch (error) {
      setDebugMessage(
        error instanceof Error ? error.message : '日志导出失败，请重新打开弹窗后再试。',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setExportingDebug(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void readSubtitlePreferences()
      .then((preferences) => {
        if (!cancelled) setDisplayMode(preferences.displayMode);
      })
      .catch(() => {
        if (!cancelled) setModeMessage('无法读取显示设置，请重新打开弹窗。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let statusTimer: ReturnType<typeof setTimeout>;

    const pollStatus = async (tabId: number) => {
      try {
        const content = (await browser.tabs.sendMessage(tabId, {
          type: GET_CONTENT_STATE_MESSAGE,
        })) as ContentState;
        if (!cancelled) setView((current) => ({ ...current, content }));
      } catch {
        if (!cancelled) {
          setView((current) => ({
            loading: false,
            isYouTubeVideo: current.isYouTubeVideo,
            tabId,
          }));
        }
      } finally {
        if (!cancelled) statusTimer = setTimeout(() => void pollStatus(tabId), 1_000);
      }
    };

    const load = async () => {
      const [stored, tabs] = await Promise.all([
        browser.storage.local.get([ENABLED_KEY]),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      const tab = tabs[0];
      const isYouTubeVideo = isYouTubeVideoUrl(tab?.url);
      let content: ContentState | undefined;

      if (isYouTubeVideo && tab?.id !== undefined) {
        try {
          content = (await browser.tabs.sendMessage(tab.id, {
            type: GET_CONTENT_STATE_MESSAGE,
          })) as ContentState;
        } catch {
          content = undefined;
        }
      }

      let cacheEntries: number | undefined;
      if (content?.videoId) {
        try {
          const result = (await browser.runtime.sendMessage({
            type: GET_TRANSLATION_CACHE_STATS_MESSAGE,
            videoId: content.videoId,
          })) as { ok?: boolean; stats?: { entryCount: number } };
          if (result.ok) cacheEntries = result.stats?.entryCount;
        } catch {
          cacheEntries = undefined;
          if (!cancelled) setCacheMessage('无法读取本视频缓存');
        }
      }

      if (!cancelled) {
        setEnabled(stored[ENABLED_KEY] !== false);
        setView({
          loading: false,
          isYouTubeVideo,
          ...(content ? { content } : {}),
          ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
        });
        setCurrentCacheEntries(cacheEntries);
        if (isYouTubeVideo && tab?.id !== undefined) {
          statusTimer = setTimeout(() => void pollStatus(tab.id!), 1_000);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(statusTimer);
    };
  }, []);

  const presentation = useMemo(
    () =>
      enabled
        ? statusPresentation(view)
        : {
            Icon: SubtitlesIcon,
            tone: 'neutral' as const,
            title: '句织字幕已关闭',
            detail: '开启后，字幕会随播放位置同步显示。',
          },
    [enabled, view],
  );
  const StatusIcon = presentation.Icon;
  const sourceLabel =
    view.content?.languageCode && !/^en(?:-|$)/i.test(view.content.languageCode)
      ? '仅原文'
      : '仅英文';

  const changeDisplayMode = async (next: SubtitleDisplayMode) => {
    if (savingMode || displayMode === next) return;
    setSavingMode(true);
    setModeMessage('');
    try {
      const result = (await browser.runtime.sendMessage({
        type: UPDATE_SUBTITLE_DISPLAY_MODE_MESSAGE,
        displayMode: next,
      })) as { ok?: boolean; preferences?: SubtitlePreferences };
      if (!result.ok || !result.preferences) throw new Error('Mode update failed');
      setDisplayMode(result.preferences.displayMode);
      setView((current) =>
        current.content
          ? {
              ...current,
              content: { ...current.content, displayMode: result.preferences!.displayMode },
            }
          : current,
      );
    } catch {
      setModeMessage('切换未完成，请重试。');
    } finally {
      setSavingMode(false);
    }
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    setView((current) =>
      current.content ? { ...current, content: { ...current.content, enabled: next } } : current,
    );
    await browser.storage.local.set({ [ENABLED_KEY]: next });
    if (view.tabId !== undefined) {
      try {
        await browser.tabs.sendMessage(view.tabId, {
          type: SET_CONTENT_ENABLED_MESSAGE,
          enabled: next,
        });
      } catch {
        // The saved setting applies after the content script is available again.
      }
    }
  };

  const clearCurrentVideoCache = async () => {
    const videoId = view.content?.videoId;
    if (!videoId) return;
    setClearingCache(true);
    setCacheMessage('');
    try {
      const result = (await browser.runtime.sendMessage({
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
        videoId,
      })) as { ok?: boolean; removedEntries?: number; message?: string };
      if (!result.ok) throw new Error(result.message ?? '缓存未能清除。');
      setCurrentCacheEntries(0);
      setCacheMessage(
        result.removedEntries ? `已清除 ${result.removedEntries} 个窗口` : '本视频没有翻译缓存',
      );
    } catch (error) {
      setCacheMessage(error instanceof Error ? error.message : '缓存清除失败');
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <Brand />
        <button
          className="icon-button"
          type="button"
          aria-label="打开设置"
          onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/options.html') })}
        >
          <GearSixIcon size={20} aria-hidden="true" />
        </button>
      </header>
      <section className={'status-block status-' + presentation.tone} aria-live="polite">
        <div className="status-symbol">
          <StatusIcon
            className={presentation.tone === 'working' ? 'cw-spin' : undefined}
            size={24}
            weight="regular"
            aria-hidden="true"
          />
        </div>
        <h1>{presentation.title}</h1>
        <p>{presentation.detail}</p>
      </section>
      <section className="control-section" aria-labelledby="overlay-heading">
        <div>
          <h2 id="overlay-heading">显示句织字幕</h2>
          <p>{enabled ? '跟随播放器同步显示' : '保留 YouTube 原生字幕'}</p>
        </div>
        <button
          className="power-toggle"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="显示句织字幕"
          onClick={() => void toggleEnabled()}
        >
          <span />
        </button>
      </section>
      <section className="quick-language" aria-labelledby="language-heading">
        <h2 id="language-heading">字幕语言</h2>
        <div className="language-options" role="group" aria-label="字幕显示语言">
          {(
            [
              ['bilingual', '双语'],
              ['source', sourceLabel],
              ['translation', '仅中文'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={displayMode === mode}
              disabled={savingMode || displayMode === undefined}
              onClick={() => void changeDisplayMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {(savingMode || modeMessage) && (
          <p className={modeMessage ? 'mode-feedback mode-error' : 'mode-feedback'} role="status">
            {savingMode ? '正在切换…' : modeMessage}
          </p>
        )}
      </section>
      <button
        className="workspace-link"
        type="button"
        disabled={view.tabId === undefined || !view.content?.videoId}
        onClick={() => {
          if (view.tabId === undefined) return;
          const reviewUrl = new URL(browser.runtime.getURL('/review.html'));
          reviewUrl.searchParams.set('tabId', String(view.tabId));
          void browser.tabs.create({ url: reviewUrl.toString() });
        }}
      >
        <MagicWandIcon size={20} aria-hidden="true" />
        <span>
          <strong>打开字幕工作台</strong>
          <small>核对修正、确认术语、导出字幕</small>
        </span>
        <ArrowRightIcon size={18} aria-hidden="true" />
      </button>
      {debugEnabled && (
        <div className="debug-export">
          <button
            className="cw-button secondary"
            type="button"
            disabled={
              exportingDebug || view.loading || !view.isYouTubeVideo || view.tabId === undefined
            }
            onClick={() => void exportDebug()}
          >
            <DownloadSimpleIcon size={17} aria-hidden="true" />
            {exportingDebug ? '正在导出…' : '导出当前问题日志'}
          </button>
          <p role="status">
            {debugMessage ||
              (view.isYouTubeVideo
                ? '包含当前位置的字幕与模型响应，仅下载到本地。'
                : '请先打开需要反馈的 YouTube 视频。')}
          </p>
        </div>
      )}
      {!debugEnabled && debugMessage && (
        <p className="mode-feedback" role="status">
          {debugMessage}
        </p>
      )}
      {view.content?.videoId && (
        <div className="cache-action-row" aria-live="polite">
          <span>
            {cacheMessage ||
              (currentCacheEntries === undefined
                ? '无法读取本视频缓存'
                : '本视频缓存 ' + currentCacheEntries + ' 个窗口')}
          </span>
          <button
            type="button"
            disabled={
              clearingCache || currentCacheEntries === undefined || currentCacheEntries === 0
            }
            onClick={() => void clearCurrentVideoCache()}
          >
            <TrashIcon size={14} aria-hidden="true" />
            {clearingCache ? '清除中' : '清除'}
          </button>
        </div>
      )}
    </main>
  );
}
