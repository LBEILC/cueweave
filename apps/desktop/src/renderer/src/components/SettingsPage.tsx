import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  MoonIcon,
  SunIcon,
  DesktopIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';
import { SelectControl } from './SelectControl';
import {
  normalizeProvider,
  type SettingsSnapshot,
  type SettingsCommand,
  type ProviderConfig,
  type ThemePreference,
} from '../../../shared/settings';

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [provider, setProvider] = useState<ProviderConfig>({
    baseUrl: '',
    model: '',
    protocol: 'auto',
  });
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [leaving, setLeaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const continueEditing = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const dirty = Boolean(
    settings &&
    (JSON.stringify(provider) !== JSON.stringify(settings.provider) || key || removeKey),
  );
  useEffect(() => {
    void window.cueweave.settingsCommand({ action: 'draft', dirty });
  }, [dirty]);
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    void read();
    return () => {
      mounted.current = false;
      void window.cueweave.settingsCommand({ action: 'draft', dirty: false });
      void window.cueweave.settingsCommand({ action: 'cancel-test' });
    };
  }, []);
  async function read() {
    setBusy('read');
    const result = await window.cueweave.settingsCommand({ action: 'read' });
    if (!mounted.current) return;
    if (result.ok) {
      setSettings(result.value.settings);
      setProvider(result.value.settings.provider);
      setError('');
    } else setError(result.error.message);
    setBusy('');
  }
  async function run(command: SettingsCommand) {
    if (command.action === 'save' && command.key) setKey('');
    setBusy(command.action);
    setError('');
    setMessage('');
    const result = await window.cueweave.settingsCommand(command);
    if (!mounted.current) return;
    setBusy('');
    if (!result.ok) {
      setError(
        result.error.message +
          (command.action === 'save' && command.key ? ' 请重新输入 API Key 后保存。' : ''),
      );
      return;
    }
    setSettings(result.value.settings);
    if (command.action === 'save') {
      setProvider(result.value.settings.provider);
      setKey('');
      setRemoveKey(false);
      setMessage(
        result.value.settings.keyStatus === 'session'
          ? '配置已保存；密钥仅在本次运行期间可用。'
          : 'AI 配置已保存。',
      );
    } else if (command.action === 'theme') setMessage('外观已保存。');
    else setMessage(result.value.message ?? '');
  }
  function close() {
    if (dirty) {
      setLeaving(true);
      requestAnimationFrame(() => continueEditing.current?.focus());
    } else onClose();
  }
  const changedAddress = Boolean(
    settings && provider.baseUrl.trim().replace(/\/+$/u, '') !== settings.provider.baseUrl,
  );
  const keyState = removeKey || changedAddress ? 'missing' : settings?.keyStatus;
  return (
    <section
      className="settings-page"
      aria-labelledby="settings-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!busy) close();
        }
      }}
    >
      <div className="settings-heading">
        <button type="button" className="quiet-button" disabled={Boolean(busy)} onClick={close}>
          <ArrowLeftIcon size={18} aria-hidden="true" />
          返回工作台
        </button>
        <h1 id="settings-title" ref={heading} tabIndex={-1}>
          设置
        </h1>
      </div>
      <div className="settings-scroll">
        <div className="settings-content">
          {leaving && (
            <div className="settings-leave" role="alert">
              <p>AI 配置尚未保存，要放弃这次修改吗？</p>
              <div className="settings-actions">
                <button
                  ref={continueEditing}
                  type="button"
                  className="secondary-button"
                  onClick={() => setLeaving(false)}
                >
                  继续编辑
                </button>
                <button type="button" className="quiet-button" onClick={onClose}>
                  放弃修改并返回
                </button>
              </div>
            </div>
          )}
          {!settings ? (
            <div role="status">
              <p>{error || '正在读取设置…'}</p>
              {!busy && (
                <button className="secondary-button" onClick={() => void read()}>
                  重新读取
                </button>
              )}
            </div>
          ) : (
            <>
              <section className="settings-section" aria-labelledby="appearance-title">
                <div className="settings-section-label">
                  <h2 id="appearance-title">外观</h2>
                  <p>选择适合当前环境的主题。</p>
                </div>
                <div>
                  <div className="theme-options" role="group" aria-label="主题">
                    {(
                      [
                        ['system', '跟随系统', DesktopIcon],
                        ['light', '浅色', SunIcon],
                        ['dark', '深色', MoonIcon],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={settings.theme === value}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run({ action: 'theme', theme: value as ThemePreference })
                        }
                      >
                        <Icon size={20} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="field-help">切换后立即生效，重启后保持。</p>
                </div>
              </section>
              <section className="settings-section" aria-labelledby="provider-title">
                <div className="settings-section-label">
                  <h2 id="provider-title">AI 服务</h2>
                  <p>连接用于字幕翻译的模型服务。</p>
                </div>
                <form
                  className="provider-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      const normalized = normalizeProvider(provider);
                      void run({
                        action: 'save',
                        provider: normalized,
                        ...(key ? { key } : {}),
                        ...(removeKey ? { removeKey: true } : {}),
                      });
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '请检查配置。');
                    }
                  }}
                >
                  <fieldset disabled={Boolean(busy)}>
                    <label>
                      服务地址
                      <input
                        type="url"
                        value={provider.baseUrl}
                        maxLength={2048}
                        spellCheck={false}
                        autoComplete="off"
                        aria-describedby="base-help"
                        onChange={(event) => {
                          setProvider({ ...provider, baseUrl: event.target.value });
                          setMessage('');
                          setError('');
                        }}
                      />
                    </label>
                    <p className="field-help" id="base-help">
                      填写服务商提供的 API 基础地址，保留其要求的路径（如 /v1）。远程地址使用
                      HTTPS。
                    </p>
                    <div className="provider-model-row">
                      <label>
                        模型名称
                        <input
                          value={provider.model}
                          maxLength={200}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(event) => {
                            setProvider({ ...provider, model: event.target.value });
                            setMessage('');
                          }}
                        />
                      </label>
                      <label>
                        接口协议
                        <SelectControl
                          aria-label="接口协议"
                          value={provider.protocol}
                          onChange={(event) => {
                            setProvider({
                              ...provider,
                              protocol: event.target.value as ProviderConfig['protocol'],
                            });
                            setMessage('');
                          }}
                        >
                          <option value="auto">自动选择</option>
                          <option value="chat-completions">Chat Completions</option>
                          <option value="responses">Responses</option>
                        </SelectControl>
                      </label>
                    </div>
                    <label>
                      API Key
                      <input
                        type="password"
                        value={key}
                        maxLength={8192}
                        autoComplete="new-password"
                        spellCheck={false}
                        aria-describedby="key-help"
                        placeholder={
                          keyState === 'saved' || keyState === 'session'
                            ? '留空以保留已保存的密钥'
                            : '输入 API Key'
                        }
                        onChange={(event) => {
                          setKey(event.target.value);
                          setRemoveKey(false);
                          setMessage('');
                        }}
                      />
                    </label>
                    <div className="key-status">
                      <span>
                        {removeKey
                          ? '保存后移除密钥'
                          : keyState === 'saved'
                            ? '密钥已加密保存'
                            : keyState === 'session'
                              ? '密钥仅供本次运行使用'
                              : keyState === 'unavailable'
                                ? '已保存的密钥无法解锁，请重新输入'
                                : '尚未保存密钥'}
                      </span>
                      {settings.keyStatus !== 'missing' && !removeKey && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setRemoveKey(true);
                            setKey('');
                            setMessage('');
                          }}
                        >
                          移除密钥
                        </button>
                      )}
                      {removeKey && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setRemoveKey(false)}
                        >
                          撤销移除
                        </button>
                      )}
                    </div>
                    <p id="key-help" className="field-help">
                      {!settings.encryptionAvailable
                        ? '系统加密当前不可用，密钥只在本次运行中保留，退出后需重新输入。'
                        : changedAddress
                          ? '服务地址已修改，请重新输入新服务的密钥。'
                          : '密钥保存在本机，不随字幕项目或导出文件共享。'}
                    </p>
                  </fieldset>
                  <div className="settings-actions">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={Boolean(busy) || !dirty}
                    >
                      {busy === 'save' ? '正在保存…' : '保存配置'}
                    </button>
                    {busy === 'test' ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          void window.cueweave.settingsCommand({ action: 'cancel-test' })
                        }
                      >
                        <SpinnerGapIcon size={16} className="spin" aria-hidden="true" />
                        取消测试
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={
                          Boolean(busy) ||
                          dirty ||
                          !settings.provider.baseUrl ||
                          !settings.provider.model ||
                          !['saved', 'session'].includes(settings.keyStatus)
                        }
                        onClick={() => void run({ action: 'test' })}
                      >
                        测试连接
                      </button>
                    )}
                  </div>
                  <p className="field-help">
                    {dirty
                      ? '保存配置后可测试连接。'
                      : '测试会发送一条短请求，可能产生少量 API 费用；不会发送视频或字幕。'}
                  </p>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
      {settings && (
        <div className="settings-feedback" aria-live="polite">
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : (
            <p>
              {busy === 'test'
                ? '正在等待模型响应…'
                : message || (dirty ? '有未保存的 AI 配置' : '设置已保存')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
