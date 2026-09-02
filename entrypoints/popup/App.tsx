import {
  CheckCircleIcon,
  CircleNotchIcon,
  PowerIcon,
  ShieldCheckIcon,
  SubtitlesIcon,
  WarningCircleIcon,
  YoutubeLogoIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { GET_CONTENT_STATE_MESSAGE, type ContentState } from '../../src/platform/youtube/types';

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
      return {
        Icon: CheckCircleIcon,
        tone: 'success',
        title: '原文字幕已就绪',
        detail: view.content.message ?? '字幕会随播放位置同步显示。',
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

      if (!cancelled) {
        setEnabled(stored[ENABLED_KEY] !== false);
        setView({
          loading: false,
          isYouTubeVideo,
          ...(content ? { content } : {}),
          ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
        });
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
        <span className="mode-chip">原文模式</span>
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
            <dt>完整语义段</dt>
            <dd>{view.content.segmentCount}</dd>
          </div>
          <div>
            <dt>字幕语言</dt>
            <dd>{view.content.languageCode?.toUpperCase() ?? '—'}</dd>
          </div>
        </dl>
      )}

      <footer>
        <ShieldCheckIcon size={16} weight="regular" aria-hidden="true" />
        <span>字幕清洗与断句在本机完成</span>
      </footer>
    </main>
  );
}
