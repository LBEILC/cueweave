import {
  ArrowsOutLineVerticalIcon,
  CheckCircleIcon,
  DatabaseIcon,
  EyeIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  KeyIcon,
  LinkSimpleIcon,
  PlugsConnectedIcon,
  RectangleIcon,
  ShieldCheckIcon,
  SubtitlesIcon,
  TextAaIcon,
  TranslateIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
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
import type { ProviderSettings } from '../../src/provider/types';
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
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [displaySaveState, setDisplaySaveState] = useState<SaveState>('idle');
  const [displayMessage, setDisplayMessage] = useState('');
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats>();
  const [cacheState, setCacheState] = useState<SaveState>('idle');
  const [cacheMessage, setCacheMessage] = useState('');

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
    } catch (error) {
      setSaveState('error');
      setMessage(error instanceof Error ? error.message : '设置保存失败，请检查后重试。');
    }
  };

  return (
    <main className="settings-shell">
      <aside className="identity-rail" aria-label="CueWeave">
        <div className="thread-line" aria-hidden="true" />
        <img src="/cueweave-mark.svg" alt="" />
        <div>
          <p className="eyebrow">CueWeave</p>
          <p className="brand-name">句织</p>
        </div>
        <p className="rail-note">把碎片字幕编织成完整语义。</p>
      </aside>

      <section className="settings-content" aria-labelledby="provider-heading">
        <header className="page-heading">
          <div>
            <p className="section-index">01 / MODEL PROVIDER</p>
            <h1 id="provider-heading">连接模型服务</h1>
            <p>模型负责语义断句与中文翻译，时间轴和完整性校验仍由 CueWeave 在本机完成。</p>
          </div>
          <PlugsConnectedIcon size={28} weight="regular" aria-hidden="true" />
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
              <PlugsConnectedIcon size={19} />
            </span>
            <span className="field-copy">
              <span className="field-label">请求格式</span>
              <span className="field-help">不确定时使用自动检测</span>
            </span>
            <select
              value={settings.protocol}
              onChange={(event) => updateField('protocol', event.target.value)}
            >
              <option value="auto">自动检测</option>
              <option value="chat-completions">Chat Completions</option>
              <option value="responses">Responses</option>
            </select>
          </label>

          <label className="field-row">
            <span className="field-icon" aria-hidden="true">
              <PlugsConnectedIcon size={19} />
            </span>
            <span className="field-copy">
              <span className="field-label">模型</span>
              <span className="field-help">用于断句和翻译的模型名称</span>
            </span>
            <input
              type="text"
              value={settings.model}
              onChange={(event) => updateField('model', event.target.value)}
              placeholder="gemini-3.1-flash-lite"
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
            <button className="primary-action" type="submit" disabled={saveState === 'saving'}>
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
        </form>

        <section className="display-settings" aria-labelledby="display-heading">
          <header className="section-heading">
            <div>
              <p className="section-index">02 / SUBTITLE DISPLAY</p>
              <h2 id="display-heading">调整字幕显示</h2>
              <p>设置会保存在当前浏览器，并立即应用到已打开的 YouTube 页面。</p>
            </div>
            <SubtitlesIcon size={26} weight="regular" aria-hidden="true" />
          </header>

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
                  aria-pressed={subtitle.backgroundEnabled}
                  onClick={() => updateSubtitle('backgroundEnabled', !subtitle.backgroundEnabled)}
                >
                  <span aria-hidden="true" />
                  {subtitle.backgroundEnabled ? '开启' : '关闭'}
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

            <div className="display-actions">
              <p className="display-guidance">
                {subtitle.displayMode === 'translation'
                  ? '仅中文模式下，尚未完成翻译的位置不会显示原文字幕。'
                  : subtitle.displayMode === 'source'
                    ? '仅原文模式不会发起新的模型翻译请求。'
                    : '双语模式会按上方顺序显示翻译与原文。'}
              </p>
              <button
                className="primary-action"
                type="submit"
                disabled={displaySaveState === 'saving'}
              >
                <FloppyDiskIcon size={19} weight="bold" aria-hidden="true" />
                <span>{displaySaveState === 'saving' ? '正在应用' : '保存显示设置'}</span>
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

        <section className="cache-settings" aria-labelledby="cache-heading">
          <header className="section-heading">
            <div>
              <p className="section-index">03 / TRANSLATION CACHE</p>
              <h2 id="cache-heading">管理翻译缓存</h2>
              <p>缓存可减少重复请求；清除后，已看过的位置会在需要时重新翻译。</p>
            </div>
            <DatabaseIcon size={26} weight="regular" aria-hidden="true" />
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
              className="secondary-danger-action"
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
      </section>
    </main>
  );
}
