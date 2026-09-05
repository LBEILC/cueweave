import { TranslateIcon } from '@phosphor-icons/react';
import { SelectControl } from './SelectControl';
import { TARGET_LANGUAGES, type TargetLanguage } from '../../../shared/translation';
import type { useOnlineTranslation } from '../use-online-translation';

export function OnlineTranslationTools({
  translation,
  available,
  loading,
  openSettings,
}: {
  translation: ReturnType<typeof useOnlineTranslation>;
  available: boolean;
  loading: boolean;
  openSettings: () => void;
}) {
  const { snapshot, busy, running, language, setLanguage, toggle, error } = translation;
  const failure = error || snapshot?.error;
  return (
    <section className="online-translation-tools" aria-label="边看边译">
      <div className="online-translation-heading">
        <strong>
          <TranslateIcon size={17} aria-hidden="true" />
          边看边译
        </strong>
        <button
          type="button"
          className="quiet-button"
          disabled={!available || loading || busy}
          onClick={() => void toggle()}
        >
          {busy ? '正在连接…' : running ? '暂停翻译' : snapshot ? '继续翻译' : '开启翻译'}
        </button>
      </div>
      <label className="online-translation-language">
        译为
        <SelectControl
          aria-label="在线翻译目标语言"
          value={language}
          disabled={running || busy}
          onChange={(event) => setLanguage(event.target.value as TargetLanguage)}
        >
          {Object.entries(TARGET_LANGUAGES).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </SelectControl>
      </label>
      <p className="online-translation-status" role="status">
        {loading
          ? '正在读取原文字幕…'
          : !available
            ? '暂无可用在线字幕。'
            : snapshot
              ? `${snapshot.state === 'translating' ? '正在翻译当前位置及后续字幕' : snapshot.state === 'ready' ? '当前位置已就绪，随播放继续翻译' : snapshot.state === 'paused' ? '翻译已暂停，已有译文仍可观看' : '翻译已停止'} · ${snapshot.completed} / ${snapshot.total} 条`
              : '优先翻译当前位置，向后预取。译文会自动缓存。'}
      </p>
      {failure ? (
        <p className="inline-error" role="alert">
          {failure}
        </p>
      ) : null}
      <p className="online-translation-help">
        {snapshot
          ? '回看优先复用已缓存译文。'
          : '开启后会将字幕发送到已配置的 AI 服务，可能产生 API 费用。'}{' '}
        <button type="button" className="quiet-button" onClick={openSettings}>
          AI 设置
        </button>
      </p>
    </section>
  );
}
