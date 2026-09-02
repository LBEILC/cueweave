import {
  CheckCircleIcon,
  CircleNotchIcon,
  GearSixIcon,
  MagicWandIcon,
  PowerIcon,
  ShieldCheckIcon,
  SubtitlesIcon,
  TrashIcon,
  WarningCircleIcon,
  YoutubeLogoIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import {
  CLEAR_TRANSLATION_CACHE_MESSAGE,
  GET_TRANSLATION_CACHE_STATS_MESSAGE,
} from '../../src/provider/messages';
import {
  GET_CONTENT_STATE_MESSAGE,
  SET_CONTENT_ENABLED_MESSAGE,
  type ContentState,
} from '../../src/platform/youtube/types';

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
          title: '原文字幕已就绪',
          detail: view.content.aiMessage ?? '正在生成当前位置的双语字幕。',
        };
      }
      if (view.content.aiStatus === 'ready') {
        return {
          Icon: CheckCircleIcon,
          tone: 'success',
          title: '双语字幕已就绪',
          detail: view.content.aiMessage ?? '当前位置已完成语义断句和翻译。',
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

  useEffect(() => {
    let cancelled = false;

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
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const presentation = useMemo(() => statusPresentation(view), [view]);
  const StatusIcon = presentation.Icon;

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
      <div className="semantic-thread" aria-hidden="true" />

      <header className="brand-row">
        <img className="brand-mark" src="/cueweave-mark.svg" alt="" />
        <div>
          <p className="eyebrow">CueWeave</p>
          <h1>句织</h1>
        </div>
        <span className="mode-chip">
          {view.content?.displayMode === 'translation'
            ? '仅中文'
            : view.content?.displayMode === 'source'
              ? '仅原文'
              : view.content?.aiStatus === 'ready'
                ? '双语模式'
                : '原文降级'}
        </span>
      </header>

      <section className={`status-block status-${presentation.tone}`} aria-live="polite">
        <StatusIcon
          className={presentation.tone === 'working' ? 'status-icon spinning' : 'status-icon'}
          size={22}
          weight={presentation.tone === 'success' ? 'fill' : 'regular'}
          aria-hidden="true"
        />
        <div>
          <h2>{presentation.title}</h2>
          <p>{presentation.detail}</p>
        </div>
      </section>

      <section className="control-section" aria-labelledby="overlay-heading">
        <div className="control-copy">
          <p className="control-label" id="overlay-heading">
            字幕覆盖层
          </p>
          <p>{enabled ? '跟随播放器显示清洗后的原文' : '保留 YouTube 原生字幕显示'}</p>
        </div>
        <button
          className="power-toggle"
          type="button"
          aria-pressed={enabled}
          aria-label={enabled ? '关闭 CueWeave 字幕覆盖层' : '开启 CueWeave 字幕覆盖层'}
          onClick={() => void toggleEnabled()}
        >
          <PowerIcon size={18} weight="bold" aria-hidden="true" />
          <span>{enabled ? '开启' : '关闭'}</span>
        </button>
      </section>

      {view.content?.status === 'ready' && (
        <dl className="pipeline-readout" aria-label="字幕处理结果">
          <div>
            <dt>字幕片段</dt>
            <dd>{view.content.cueCount}</dd>
          </div>
          <div>
            <dt>显示字幕</dt>
            <dd>{view.content.displayCueCount}</dd>
          </div>
          <div>
            <dt>字幕语言</dt>
            <dd>{view.content.languageCode?.toUpperCase() ?? '—'}</dd>
          </div>
        </dl>
      )}

      {view.content?.videoId && (
        <div className="cache-action-row" aria-live="polite">
          <span>{cacheMessage || `本视频缓存 ${currentCacheEntries ?? '—'} 个窗口`}</span>
          <button
            type="button"
            disabled={
              clearingCache || currentCacheEntries === undefined || currentCacheEntries === 0
            }
            onClick={() => void clearCurrentVideoCache()}
          >
            <TrashIcon size={15} aria-hidden="true" />
            <span>{clearingCache ? '清除中' : '清除'}</span>
          </button>
        </div>
      )}

      <footer>
        <span className="privacy-summary">
          <ShieldCheckIcon size={16} weight="regular" aria-hidden="true" />
          <span>本地校验 · MiSans</span>
        </span>
        <span className="footer-actions">
          <button
            className="settings-link"
            type="button"
            disabled={view.tabId === undefined || !view.content?.videoId}
            onClick={() => {
              if (view.tabId === undefined) return;
              const reviewUrl = new URL(browser.runtime.getURL('/review.html'));
              reviewUrl.searchParams.set('tabId', String(view.tabId));
              void browser.tabs.create({ url: reviewUrl.toString() });
            }}
          >
            <MagicWandIcon size={16} aria-hidden="true" />
            <span>字幕工具</span>
          </button>
          <button
            className="settings-link"
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: browser.runtime.getURL('/options.html') })
            }
          >
            <GearSixIcon size={16} aria-hidden="true" />
            <span>设置</span>
          </button>
        </span>
      </footer>
    </main>
  );
}
