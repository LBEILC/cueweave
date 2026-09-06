import {
  ArrowsOutLineVerticalIcon,
  ArrowsLeftRightIcon,
  BugIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleHalfIcon,
  CpuIcon,
  DatabaseIcon,
  EyeIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  KeyIcon,
  LinkSimpleIcon,
  MagicWandIcon,
  PlugsConnectedIcon,
  RectangleIcon,
  ShieldCheckIcon,
  SubtitlesIcon,
  TextAaIcon,
  TranslateIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Brand } from '../../src/ui/Brand';
import { GET_DEBUG_STATE, SET_DEBUG_STATE, DEBUG_POLICY } from '../../src/debug/types';
import { subtitleTextShadow } from '../../src/ui/subtitle-style';
import type { TranslationCacheStats } from '../../src/cache/translationCache';
import {
  CLEAR_TRANSLATION_CACHE_MESSAGE,
  GET_TRANSLATION_CACHE_STATS_MESSAGE,
  TEST_PROVIDER_MESSAGE,
  type TestProviderResult,
} from '../../src/provider/messages';
import {
  DEFAULT_PROVIDER_SETTINGS,
  providerOriginPattern,
  readProviderSettings,
  saveProviderSettings,
} from '../../src/provider/settings';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import { diagnosticError, redactProviderDiagnostic } from '@cueweave/core/provider/diagnostics';
import { UPDATE_SUBTITLE_PREFERENCES_MESSAGE } from '../../src/platform/youtube/types';
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  readSubtitlePreferences,
  type BilingualOrder,
  type SubtitleDisplayMode,
  type SubtitlePreferences,
} from '../../src/settings/subtitle';

type SaveState = 'idle' | 'saving' | 'success' | 'error';

const BACKGROUND_RESPONSE_TIMEOUT_MS = 50_000;

function formatCacheSize(byteSize: number): string {
  if (byteSize < 1_024) return `${byteSize} B`;
  if (byteSize < 1_024 * 1_024) return `${(byteSize / 1_024).toFixed(1)} KB`;
  return `${(byteSize / (1_024 * 1_024)).toFixed(1)} MB`;
}

async function sendProviderTest(): Promise<TestProviderResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('扩展后台未响应。请重新加载 CueWeave 后再试。'));
    }, BACKGROUND_RESPONSE_TIMEOUT_MS);
  });

  try {
    return (await Promise.race([
      browser.runtime.sendMessage({ type: TEST_PROVIDER_MESSAGE }),
      timeout,
    ])) as TestProviderResult;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function App() {
  const [settings, setSettings] = useState<ProviderSettings>({ ...DEFAULT_PROVIDER_SETTINGS });
  const [subtitle, setSubtitle] = useState<SubtitlePreferences>({
    ...DEFAULT_SUBTITLE_PREFERENCES,
  });
  const [showKey, setShowKey] = useState(false);
  const [activeSection, setActiveSection] = useState('provider');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [displaySaveState, setDisplaySaveState] = useState<SaveState>('idle');
  const [displayMessage, setDisplayMessage] = useState('');
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats>();
  const [cacheState, setCacheState] = useState<SaveState>('idle');
  const [cacheMessage, setCacheMessage] = useState('');
  const [debugEnabled, setDebugEnabled] = useState<boolean>();
  const [debugSaving, setDebugSaving] = useState(false);
  const [debugMessage, setDebugMessage] = useState('');

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: GET_DEBUG_STATE })
      .then((result: { ok?: boolean; enabled?: boolean }) => {
        if (!result.ok || typeof result.enabled !== 'boolean') throw new Error();
        setDebugEnabled(result.enabled);
      })
      .catch(() => setDebugMessage('无法读取调试设置，请重新打开设置页面。'));
  }, []);

  const toggleDebug = async () => {
    setDebugSaving(true);
    setDebugMessage('');
    try {
      const result = (await browser.runtime.sendMessage({
        type: SET_DEBUG_STATE,
        enabled: !debugEnabled,
      })) as { ok?: boolean; enabled?: boolean; message?: string };
      if (!result.ok || typeof result.enabled !== 'boolean') throw new Error(result.message);
      setDebugEnabled(result.enabled);
      setDebugMessage(
        result.enabled
          ? '已开启。遇到问题后，从视频页面的扩展弹窗导出日志。'
          : '已关闭，本地调试日志已清除。',
      );
    } catch {
      setDebugMessage('调试设置未能保存，请重新打开设置页面后再试。');
    } finally {
      setDebugSaving(false);
    }
  };

  useEffect(() => {
    void Promise.all([readProviderSettings(), readSubtitlePreferences()]).then(
      ([providerSettings, subtitlePreferences]) => {
        setSettings(providerSettings);
        setSubtitle(subtitlePreferences);
      },
    );
    void browser.runtime
      .sendMessage({ type: GET_TRANSLATION_CACHE_STATS_MESSAGE })
      .then((result: { ok?: boolean; stats?: TranslationCacheStats }) => {
        if (!result.ok || !result.stats) throw new Error();
        setCacheStats(result.stats);
      })
      .catch(() => {
        setCacheState('error');
        setCacheMessage('无法读取翻译缓存，请重新加载扩展后再试。');
      });
  }, []);

  const clearAllCache = async () => {
    setCacheState('saving');
    setCacheMessage('正在清除全部翻译缓存。');
    try {
      const result = (await browser.runtime.sendMessage({
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
      })) as { ok?: boolean; stats?: TranslationCacheStats; message?: string };
      if (!result.ok || !result.stats) {
        throw new Error(result.message ?? '缓存未能清除，请重新加载扩展后再试。');
      }
      setCacheStats(result.stats);
      setCacheState('success');
      setCacheMessage('全部翻译缓存已清除；需要时会重新翻译。');
    } catch (error) {
      setCacheState('error');
      setCacheMessage(error instanceof Error ? error.message : '缓存清除失败，请重试。');
    }
  };

  const updateField = (field: keyof ProviderSettings, value: string) => {
    setErrorDetails('');
    setSettings((current) => ({ ...current, [field]: value }));
    setSaveState('idle');
    setMessage('');
  };

  const updateSubtitle = <Key extends keyof SubtitlePreferences>(
    key: Key,
    value: SubtitlePreferences[Key],
  ) => {
    setSubtitle((current) => ({ ...current, [key]: value }));
    setDisplaySaveState('idle');
    setDisplayMessage('');
  };

  const saveDisplaySettings = async () => {
    setDisplaySaveState('saving');
    setDisplayMessage('正在保存并应用字幕显示设置。');

    try {
      const result = (await browser.runtime.sendMessage({
        type: UPDATE_SUBTITLE_PREFERENCES_MESSAGE,
        preferences: subtitle,
      })) as { ok?: boolean; preferences?: SubtitlePreferences };
      if (!result.ok) throw new Error('字幕显示设置未能应用，请重新加载扩展后再试。');
      if (result.preferences) setSubtitle(result.preferences);
      setDisplaySaveState('success');
      setDisplayMessage('显示设置已应用到打开的 YouTube 页面。');
    } catch (error) {
      setDisplaySaveState('error');
      setDisplayMessage(error instanceof Error ? error.message : '显示设置保存失败，请重试。');
    }
  };

  const setDisplayMode = (displayMode: SubtitleDisplayMode) => {
    updateSubtitle('displayMode', displayMode);
  };

  const setBilingualOrder = (bilingualOrder: BilingualOrder) => {
    updateSubtitle('bilingualOrder', bilingualOrder);
  };

  const saveAndTest = async () => {
    setErrorDetails('');
    setSaveState('saving');
    setMessage('正在保存设置并测试模型连接。');

    try {
      const parsedUrl = new URL(settings.baseUrl);
      if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
        throw new Error('Base URL 需要使用 http 或 https 协议。');
      }
      if (!settings.apiKey.trim()) throw new Error('请输入 API Key。');
      if (!settings.model.trim()) throw new Error('请输入模型名称。');

      const origin = providerOriginPattern(settings.baseUrl);
      const granted = await browser.permissions.request({ origins: [origin] });
      if (!granted) {
        throw new Error('未获得模型服务访问权限。请再次保存并允许访问该域名。');
      }

      await saveProviderSettings(settings);
      const result = await sendProviderTest();
      setSaveState(result.ok ? 'success' : 'error');
      setMessage(result.message);
      setErrorDetails(result.ok ? '' : (result.details ?? result.message));
    } catch (error) {
      setSaveState('error');
      setErrorDetails(redactProviderDiagnostic(diagnosticError(error), settings));
      setMessage(error instanceof Error ? error.message : '设置保存失败，请检查后重试。');
    }
  };

  useEffect(() => {
    const sections = ['provider', 'display', 'cache', 'debug'];
    const updateSection = () => {
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        setActiveSection('debug');
        return;
      }
      const current = sections
        .filter(
          (id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 160,
        )
        .at(-1);
      setActiveSection(current ?? 'provider');
    };
    window.addEventListener('scroll', updateSection, { passive: true });
    window.addEventListener('resize', updateSection);
    updateSection();
    return () => {
      window.removeEventListener('scroll', updateSection);
      window.removeEventListener('resize', updateSection);
    };
  }, []);

  const previewTranslation = { language: 'translation', text: '让每一句话，完整地表达。' };
  const previewSource = { language: 'source', text: 'Let every sentence tell the whole story.' };
  const previewLines =
    subtitle.displayMode === 'translation'
      ? [previewTranslation]
      : subtitle.displayMode === 'source'
        ? [previewSource]
        : subtitle.bilingualOrder === 'translation-first'
          ? [previewTranslation, previewSource]
          : [previewSource, previewTranslation];

  return (
    <main className="settings-shell">
      <header className="settings-bar">
        <Brand />
        <h1>设置</h1>
      </header>
      <div className="settings-layout">
        <aside className="settings-navigation">
          <nav aria-label="设置分区">
            <a
              href="#provider"
              aria-current={activeSection === 'provider' ? 'location' : undefined}
            >
              <PlugsConnectedIcon size={19} aria-hidden="true" />
              模型服务
            </a>
            <a href="#display" aria-current={activeSection === 'display' ? 'location' : undefined}>
              <SubtitlesIcon size={19} aria-hidden="true" />
              字幕显示
            </a>
            <a href="#cache" aria-current={activeSection === 'cache' ? 'location' : undefined}>
              <DatabaseIcon size={19} aria-hidden="true" />
              翻译缓存
            </a>
            <a href="#debug" aria-current={activeSection === 'debug' ? 'location' : undefined}>
              <BugIcon size={19} aria-hidden="true" />
              问题排查
            </a>
          </nav>
        </aside>

        <div className="settings-content">
          <section className="settings-section" id="provider" aria-labelledby="provider-heading">
            <header className="section-heading">
              <div>
                <h2 id="provider-heading">连接模型服务</h2>
                <p>接入你使用的模型，完成语义断句与中文翻译。</p>
              </div>
            </header>

            <form
              className="provider-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveAndTest();
              }}
            >
              <label className="field-row">
                <span className="field-icon" aria-hidden="true">
                  <LinkSimpleIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">Base URL</span>
                  <span className="field-help">OpenAI 兼容接口的版本根路径</span>
                </span>
                <input
                  type="url"
                  value={settings.baseUrl}
                  onChange={(event) => updateField('baseUrl', event.target.value)}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                  required
                />
              </label>

              <label className="field-row">
                <span className="field-icon" aria-hidden="true">
                  <ArrowsLeftRightIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">请求格式</span>
                  <span className="field-help">不确定时使用自动检测</span>
                </span>
                <span className="select-field">
                  <select
                    value={settings.protocol}
                    onChange={(event) => updateField('protocol', event.target.value)}
                  >
                    <option value="auto">自动检测</option>
                    <option value="chat-completions">Chat Completions</option>
                    <option value="responses">Responses</option>
                  </select>
                  <span className="select-indicator" aria-hidden="true">
                    <CaretDownIcon size={19} />
                  </span>
                </span>
              </label>

              <label className="field-row">
                <span className="field-icon" aria-hidden="true">
                  <CpuIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">模型</span>
                  <span className="field-help">用于断句和翻译的模型名称</span>
                </span>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(event) => updateField('model', event.target.value)}
                  placeholder={DEFAULT_PROVIDER_SETTINGS.model}
                  spellCheck={false}
                  required
                />
              </label>

              <label className="field-row key-row">
                <span className="field-icon" aria-hidden="true">
                  <KeyIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">API Key</span>
                  <span className="field-help">填写模型服务提供商签发的访问 Key</span>
                </span>
                <span className="key-input">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(event) => updateField('apiKey', event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <button
                    className="key-visibility"
                    type="button"
                    aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                    aria-pressed={showKey}
                    onClick={() => setShowKey((current) => !current)}
                  >
                    {showKey ? <EyeSlashIcon size={19} /> : <EyeIcon size={19} />}
                  </button>
                </span>
              </label>

              <div className="form-actions">
                <div className="privacy-note">
                  <ShieldCheckIcon size={19} aria-hidden="true" />
                  <span>字幕只会发送到上方配置的 Provider，不经过 CueWeave 服务器。</span>
                </div>
                <button className="cw-button" type="submit" disabled={saveState === 'saving'}>
                  <PlugsConnectedIcon size={19} weight="bold" aria-hidden="true" />
                  <span>{saveState === 'saving' ? '正在测试连接' : '保存并测试连接'}</span>
                </button>
              </div>

              {message && (
                <p className={`form-message message-${saveState}`} role="status">
                  {saveState === 'success' ? (
                    <CheckCircleIcon size={19} weight="fill" aria-hidden="true" />
                  ) : saveState === 'error' ? (
                    <WarningCircleIcon size={19} weight="fill" aria-hidden="true" />
                  ) : (
                    <PlugsConnectedIcon size={19} aria-hidden="true" />
                  )}
                  <span>{message}</span>
                </p>
              )}
              {saveState === 'error' && errorDetails && (
                <details className="connection-error-details">
                  <summary>错误详情</summary>
                  <pre>{errorDetails}</pre>
                </details>
              )}
            </form>
          </section>

          <section className="settings-section" id="display" aria-labelledby="display-heading">
            <header className="section-heading">
              <div>
                <h2 id="display-heading">字幕显示</h2>
                <p>调整语言、字号和位置，保存后应用到已打开的 YouTube 页面。</p>
              </div>
            </header>

            <figure className="subtitle-preview" aria-label="字幕显示预览">
              <figcaption>
                字幕预览<span>示例文本</span>
              </figcaption>
              <div
                className="preview-stage"
                style={
                  {
                    '--preview-size': subtitle.sizePercent / 100,
                    '--preview-source-scale':
                      subtitle.displayMode === 'bilingual' ? subtitle.sourceSizePercent / 100 : 1,
                    '--preview-position': `${subtitle.positionPercent}%`,
                    '--preview-shadow': subtitleTextShadow(subtitle),
                    '--preview-background': subtitle.backgroundEnabled
                      ? `rgb(26 26 26 / ${subtitle.backgroundOpacityPercent / 100})`
                      : 'transparent',
                  } as CSSProperties
                }
              >
                <div className="preview-subtitles" data-backing={subtitle.backgroundEnabled}>
                  {previewLines.map((line) => (
                    <span key={line.language} data-language={line.language}>
                      {line.text}
                    </span>
                  ))}
                </div>
              </div>
            </figure>

            <form
              className="display-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDisplaySettings();
              }}
            >
              <div className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <TranslateIcon size={19} />
                </span>
                <span className="field-copy">
                  <label className="field-label" htmlFor="translation-mode">
                    翻译偏好
                  </label>
                  <span className="field-help">
                    {subtitle.translationMode === 'speed'
                      ? '优先尽快提供字幕'
                      : subtitle.translationMode === 'quality'
                        ? '逐句核对原文含义，等待可能更长'
                        : '兼顾等待时间与理解'}
                  </span>
                </span>
                <div className="select-field">
                  <select
                    id="translation-mode"
                    value={subtitle.translationMode}
                    onChange={(event) =>
                      updateSubtitle(
                        'translationMode',
                        event.target.value as SubtitlePreferences['translationMode'],
                      )
                    }
                  >
                    <option value="speed">速度优先</option>
                    <option value="balanced">均衡（默认）</option>
                    <option value="quality">质量优先</option>
                  </select>
                  <span className="select-indicator" aria-hidden="true">
                    <CaretDownIcon size={19} />
                  </span>
                </div>
              </div>

              <div className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <MagicWandIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">AI 修复转录错误</span>
                  <span className="field-help">修正高置信度的人名、产品名和明显识别错误</span>
                </span>
                <button
                  className="toggle-control"
                  type="button"
                  role="switch"
                  aria-label="AI 修复转录错误"
                  aria-checked={subtitle.transcriptCorrectionEnabled}
                  onClick={() =>
                    updateSubtitle(
                      'transcriptCorrectionEnabled',
                      !subtitle.transcriptCorrectionEnabled,
                    )
                  }
                >
                  <span aria-hidden="true" />
                </button>
              </div>

              <div className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <TranslateIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">显示语言</span>
                  <span className="field-help">选择中文、原文或双语字幕</span>
                </span>
                <div
                  className="segmented-control display-mode-control"
                  role="group"
                  aria-label="字幕显示语言"
                >
                  <button
                    type="button"
                    aria-pressed={subtitle.displayMode === 'translation'}
                    onClick={() => setDisplayMode('translation')}
                  >
                    仅中文
                  </button>
                  <button
                    type="button"
                    aria-pressed={subtitle.displayMode === 'source'}
                    onClick={() => setDisplayMode('source')}
                  >
                    仅原文
                  </button>
                  <button
                    type="button"
                    aria-pressed={subtitle.displayMode === 'bilingual'}
                    onClick={() => setDisplayMode('bilingual')}
                  >
                    中英双语
                  </button>
                </div>
              </div>

              {subtitle.displayMode === 'bilingual' && (
                <div className="field-row display-field">
                  <span className="field-icon" aria-hidden="true">
                    <SubtitlesIcon size={19} />
                  </span>
                  <span className="field-copy">
                    <span className="field-label">双语顺序</span>
                    <span className="field-help">选择字幕中先显示的语言</span>
                  </span>
                  <div className="segmented-control" role="group" aria-label="双语字幕顺序">
                    <button
                      type="button"
                      aria-pressed={subtitle.bilingualOrder === 'translation-first'}
                      onClick={() => setBilingualOrder('translation-first')}
                    >
                      中文在上
                    </button>
                    <button
                      type="button"
                      aria-pressed={subtitle.bilingualOrder === 'source-first'}
                      onClick={() => setBilingualOrder('source-first')}
                    >
                      原文在上
                    </button>
                  </div>
                </div>
              )}

              <label className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <TextAaIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">字幕大小</span>
                  <span className="field-help">按播放器尺寸等比例缩放</span>
                </span>
                <span className="range-control">
                  <input
                    type="range"
                    min="75"
                    max="150"
                    step="5"
                    value={subtitle.sizePercent}
                    onChange={(event) => updateSubtitle('sizePercent', Number(event.target.value))}
                  />
                  <output>{subtitle.sizePercent}%</output>
                </span>
              </label>

              {subtitle.displayMode === 'bilingual' && (
                <label className="field-row display-field">
                  <span className="field-icon" aria-hidden="true">
                    <TextAaIcon size={19} />
                  </span>
                  <span className="field-copy">
                    <span className="field-label">原文字号比例</span>
                    <span className="field-help" id="source-size-help">
                      原文相对译文的大小，100% 表示等大
                    </span>
                  </span>
                  <span className="range-control">
                    <input
                      type="range"
                      min="50"
                      max="150"
                      step="1"
                      aria-label="原文相对译文的字号比例"
                      aria-describedby="source-size-help"
                      aria-valuetext={`${subtitle.sourceSizePercent}%（原文 / 译文）`}
                      value={subtitle.sourceSizePercent}
                      onChange={(event) =>
                        updateSubtitle('sourceSizePercent', Number(event.target.value))
                      }
                    />
                    <output>{subtitle.sourceSizePercent}%</output>
                  </span>
                </label>
              )}

              <label className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <ArrowsOutLineVerticalIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">字幕位置</span>
                  <span className="field-help">调整字幕与播放器底部的距离</span>
                </span>
                <span className="range-control">
                  <input
                    type="range"
                    min="4"
                    max="28"
                    step="1"
                    value={subtitle.positionPercent}
                    onChange={(event) =>
                      updateSubtitle('positionPercent', Number(event.target.value))
                    }
                  />
                  <output>{subtitle.positionPercent}%</output>
                </span>
              </label>

              <div className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <RectangleIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">字幕背景</span>
                  <span className="field-help">调整字幕文字背后的深色底板</span>
                </span>
                <div className="background-controls">
                  <button
                    className="toggle-control"
                    type="button"
                    role="switch"
                    aria-label="字幕背景"
                    aria-checked={subtitle.backgroundEnabled}
                    onClick={() => updateSubtitle('backgroundEnabled', !subtitle.backgroundEnabled)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <label className="range-control compact-range">
                    <span className="visually-hidden">字幕背景不透明度</span>
                    <input
                      type="range"
                      min="10"
                      max="95"
                      step="5"
                      value={subtitle.backgroundOpacityPercent}
                      disabled={!subtitle.backgroundEnabled}
                      onChange={(event) =>
                        updateSubtitle('backgroundOpacityPercent', Number(event.target.value))
                      }
                    />
                    <output>{subtitle.backgroundOpacityPercent}%</output>
                  </label>
                </div>
              </div>

              <div className="field-row display-field">
                <span className="field-icon" aria-hidden="true">
                  <CircleHalfIcon size={19} />
                </span>
                <span className="field-copy">
                  <span className="field-label">字幕阴影</span>
                  <span className="field-help">调整文字阴影的深浅，可独立于背景开关</span>
                </span>
                <div className="background-controls">
                  <button
                    className="toggle-control"
                    type="button"
                    role="switch"
                    aria-label="字幕阴影"
                    aria-checked={subtitle.shadowEnabled}
                    onClick={() => updateSubtitle('shadowEnabled', !subtitle.shadowEnabled)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <label className="range-control compact-range">
                    <span className="visually-hidden">字幕阴影强度</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={subtitle.shadowStrengthPercent}
                      disabled={!subtitle.shadowEnabled}
                      onChange={(event) =>
                        updateSubtitle('shadowStrengthPercent', Number(event.target.value))
                      }
                    />
                    <output>{subtitle.shadowStrengthPercent}%</output>
                  </label>
                </div>
              </div>

              <div className="display-actions">
                <p className="display-guidance">
                  {subtitle.displayMode === 'translation'
                    ? '仅中文模式下，尚未完成翻译的位置不会显示原文字幕。'
                    : subtitle.displayMode === 'source'
                      ? '仅原文模式不会发起新的模型翻译请求。'
                      : '双语模式会按上方顺序显示翻译与原文。'}
                </p>
                <button
                  className="cw-button"
                  type="submit"
                  disabled={displaySaveState === 'saving'}
                >
                  <FloppyDiskIcon size={19} weight="bold" aria-hidden="true" />
                  <span>{displaySaveState === 'saving' ? '正在应用' : '保存字幕设置'}</span>
                </button>
              </div>

              {displayMessage && (
                <p className={`form-message message-${displaySaveState}`} role="status">
                  {displaySaveState === 'success' ? (
                    <CheckCircleIcon size={19} weight="fill" aria-hidden="true" />
                  ) : displaySaveState === 'error' ? (
                    <WarningCircleIcon size={19} weight="fill" aria-hidden="true" />
                  ) : (
                    <FloppyDiskIcon size={19} aria-hidden="true" />
                  )}
                  <span>{displayMessage}</span>
                </p>
              )}
            </form>
          </section>

          <section className="settings-section" id="cache" aria-labelledby="cache-heading">
            <header className="section-heading">
              <div>
                <h2 id="cache-heading">管理翻译缓存</h2>
                <p>缓存可减少重复请求；清除后，已看过的位置会在需要时重新翻译。</p>
              </div>
            </header>

            <div className="cache-panel">
              <div className="cache-summary" aria-live="polite">
                <DatabaseIcon size={20} aria-hidden="true" />
                <div>
                  <strong>
                    {cacheStats ? `${cacheStats.entryCount} 个翻译窗口` : '正在读取缓存'}
                  </strong>
                  <span>
                    {cacheStats
                      ? `${cacheStats.cueCount} 条字幕 · ${formatCacheSize(cacheStats.byteSize)}`
                      : '请稍候'}
                  </span>
                </div>
              </div>
              <button
                className="cw-button secondary danger-action"
                type="button"
                disabled={cacheState === 'saving' || !cacheStats || cacheStats.entryCount === 0}
                onClick={() => void clearAllCache()}
              >
                <TrashIcon size={18} aria-hidden="true" />
                <span>{cacheState === 'saving' ? '正在清除' : '清除全部缓存'}</span>
              </button>
            </div>

            {cacheMessage && (
              <p className={`form-message message-${cacheState}`} role="status">
                {cacheState === 'success' ? (
                  <CheckCircleIcon size={19} weight="fill" aria-hidden="true" />
                ) : cacheState === 'error' ? (
                  <WarningCircleIcon size={19} weight="fill" aria-hidden="true" />
                ) : (
                  <DatabaseIcon size={19} aria-hidden="true" />
                )}
                <span>{cacheMessage}</span>
              </p>
            )}
          </section>
          <section className="settings-section" id="debug" aria-labelledby="debug-heading">
            <header className="section-heading">
              <div>
                <h2 id="debug-heading">问题排查</h2>
                <p>开启调试后，可以在视频页面的扩展弹窗中导出当前问题日志。</p>
              </div>
            </header>
            <div className="debug-setting">
              <div>
                <label id="debug-label">调试模式</label>
                <p id="debug-help">在本地记录字幕、模型请求与响应，以及播放和重试过程。</p>
              </div>
              <button
                className="toggle-control"
                type="button"
                role="switch"
                aria-labelledby="debug-label"
                aria-describedby="debug-help"
                aria-checked={debugEnabled === true}
                disabled={debugEnabled === undefined || debugSaving}
                onClick={() => void toggleDebug()}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <p className="debug-retention">
              日志最多保留 {DEBUG_POLICY.maxAgeMs / 3_600_000} 小时、
              {DEBUG_POLICY.maxBytes / 1024 / 1024} MB，超出后自动清理。
              关闭调试会清除本地日志。导出文件包含相关字幕与模型响应，会去除 API Key
              和认证信息；仅在你下载并分享后用于反馈。
            </p>
            {debugMessage && (
              <p className="form-message" role="status">
                {debugMessage}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
