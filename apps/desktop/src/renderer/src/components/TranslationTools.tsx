import { useRef, useState } from 'react';
import { TARGET_LANGUAGES, type TargetLanguage } from '../../../shared/translation';
import type { ProjectCommand, ProjectSnapshot } from '../../../shared/project';
import { SelectControl } from './SelectControl';
import type { ProviderConfig } from '../../../shared/settings';

export function TranslationTools({
  provider,
  project,
  busy,
  run,
  onSeekMissing,
}: {
  provider: ProviderConfig | null;
  project: ProjectSnapshot;
  busy: boolean;
  run: (command: ProjectCommand) => Promise<boolean>;
  onSeekMissing: (cueId: string) => void;
}) {
  const translation = project.translation;
  const details = useRef<HTMLDetailsElement>(null);
  const [language, setLanguage] = useState<TargetLanguage>(translation?.targetLanguage ?? 'zh-CN');
  const base = { projectId: project.id, baseRevision: project.revision };
  const running = translation?.state === 'running';
  const missing = project.cues.find((cue) => !translation?.cues[cue.id]);
  return (
    <div className="translation-tools">
      <details ref={details}>
        <summary>翻译字幕</summary>
        <p className="translation-provider">
          {provider?.baseUrl && provider.model
            ? `${new URL(provider.baseUrl).host} · ${provider.model}`
            : '请先在设置中配置 AI 服务。'}
        </p>
        <div className="translation-start">
          <label>
            目标语言
            <SelectControl
              aria-label="翻译目标语言"
              value={language}
              disabled={busy || running}
              onChange={(e) => setLanguage(e.target.value as TargetLanguage)}
            >
              {Object.entries(TARGET_LANGUAGES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectControl>
          </label>
          <button
            className="primary-button"
            disabled={busy || running || !project.cues.length}
            onClick={() =>
              void run({ action: 'translate', ...base, language }).then((started) => {
                if (started && details.current) {
                  details.current.open = false;
                  const tools = details.current.closest('.project-tools');
                  if (tools) tools.scrollTop = 0;
                }
              })
            }
          >
            翻译当前字幕
          </button>
        </div>
        <p className="field-help">
          使用已保存的 AI 服务发送字幕及邻近上下文，可能产生 API 费用。原文时间保持不变。
        </p>
      </details>
      {translation && (
        <div className="translation-progress">
          <div className="translation-progress-label">
            <span>
              {
                (
                  {
                    running: '正在翻译',
                    cancelled: '翻译已取消',
                    interrupted: '翻译已中断',
                    failed: '翻译未完成',
                    completed: '翻译已完成',
                  } as const
                )[translation.state]
              }{' '}
              · {TARGET_LANGUAGES[translation.targetLanguage]}
            </span>
            <span>
              {translation.completed} / {translation.total}
            </span>
          </div>
          <progress
            aria-label="字幕翻译进度"
            value={translation.completed}
            max={translation.total}
          />
          {translation.error && (
            <p className="inline-error" role="alert">
              {translation.error}
            </p>
          )}
          <div className="translation-actions">
            {running ? (
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() =>
                  void run({ action: 'cancel-translation', ...base, translationId: translation.id })
                }
              >
                取消翻译
              </button>
            ) : (
              translation.completed < translation.total && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: 'resume-translation',
                      ...base,
                      translationId: translation.id,
                    })
                  }
                >
                  继续剩余字幕
                </button>
              )
            )}
            {missing && (
              <button className="text-button" onClick={() => onSeekMissing(missing.id)}>
                定位未完成字幕
              </button>
            )}
          </div>
          {(translation.canUndo || translation.canRedo) && (
            <div className="translation-actions">
              <button
                className="text-button"
                disabled={busy || !translation.canUndo}
                onClick={() =>
                  void run({ action: 'undo-translation', ...base, translationId: translation.id })
                }
              >
                撤销译文修改
              </button>
              <button
                className="text-button"
                disabled={busy || !translation.canRedo}
                onClick={() =>
                  void run({ action: 'redo-translation', ...base, translationId: translation.id })
                }
              >
                重做译文修改
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
