import { useState } from 'react';
import type { ProjectCue } from '../../../shared/project';

export function CueEditor({
  cue,
  durationMs,
  busy,
  onSave,
  onClose,
  onDirty,
  translation,
  onSaveTranslation,
}: {
  cue: ProjectCue;
  durationMs: number;
  busy: boolean;
  onSave: (cue: ProjectCue) => Promise<boolean>;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  translation?: string | undefined;
  onSaveTranslation?: ((text: string) => Promise<boolean>) | undefined;
}) {
  const [mode, setMode] = useState<'source' | 'translation'>('source');
  const [translatedText, setTranslatedText] = useState(translation ?? '');
  const [text, setText] = useState(cue.text);
  const [start, setStart] = useState(String(cue.startMs / 1000));
  const [end, setEnd] = useState(String(cue.endMs / 1000));
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  const sourceValid =
    text.trim().length > 0 &&
    !/\n\s*\n/.test(text) &&
    start !== '' &&
    end !== '' &&
    Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    startMs >= 0 &&
    endMs > startMs &&
    endMs <= durationMs;
  const changed =
    mode === 'translation'
      ? translatedText !== translation
      : text !== cue.text || startMs !== cue.startMs || endMs !== cue.endMs;
  const valid =
    mode === 'translation'
      ? translatedText.trim().length > 0 && !/\n\s*\n/.test(translatedText)
      : sourceValid;
  return (
    <form
      className="cue-editor"
      aria-label="编辑字幕"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid)
          void (
            mode === 'translation' && onSaveTranslation
              ? onSaveTranslation(translatedText.trim())
              : onSave({ ...cue, startMs, endMs, text: text.trim() })
          ).then((saved) => {
            if (saved) {
              onDirty(false);
              onClose();
            }
          });
      }}
    >
      <div className="cue-editor-heading">
        {translation !== undefined ? (
          <div className="cue-editor-modes" role="group" aria-label="编辑内容">
            <button
              type="button"
              className="quiet-button"
              aria-pressed={mode === 'source'}
              disabled={busy || changed}
              onClick={() => setMode('source')}
            >
              原文与时间
            </button>
            <button
              type="button"
              className="quiet-button"
              aria-pressed={mode === 'translation'}
              disabled={busy || changed}
              onClick={() => setMode('translation')}
            >
              译文
            </button>
          </div>
        ) : (
          <strong>编辑字幕</strong>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            onDirty(false);
            onClose();
          }}
        >
          取消
        </button>
      </div>
      <div className="cue-editor-body">
        {mode === 'translation' && <p className="translation-source-context">{cue.text}</p>}
        {mode === 'source' && (
          <div className="cue-time-fields">
            <label>
              开始（秒）
              <input
                autoFocus
                type="number"
                aria-label="字幕开始时间"
                min="0"
                max={durationMs / 1000}
                step="0.001"
                value={start}
                disabled={busy}
                onChange={(e) => {
                  setStart(e.target.value);
                  onDirty(true);
                }}
              />
            </label>
            <label>
              结束（秒）
              <input
                type="number"
                aria-label="字幕结束时间"
                min="0"
                max={durationMs / 1000}
                step="0.001"
                value={end}
                disabled={busy}
                onChange={(e) => {
                  setEnd(e.target.value);
                  onDirty(true);
                }}
              />
            </label>
          </div>
        )}
        <label>
          {mode === 'translation' ? '译文文本' : '字幕文本'}
          <textarea
            aria-label={mode === 'translation' ? '译文文本' : '字幕文本'}
            rows={3}
            maxLength={20000}
            value={mode === 'translation' ? translatedText : text}
            disabled={busy}
            onChange={(e) => {
              if (mode === 'translation') setTranslatedText(e.target.value);
              else setText(e.target.value);
              onDirty(true);
            }}
          />
        </label>
        {!valid && (
          <p className="inline-error" role="alert">
            请填写非空字幕，避免空行；时间须在视频范围内，结束晚于开始。
          </p>
        )}
        {translation !== undefined && mode === 'source' && (
          <p className="field-help">修改原文或时间后，需基于新版本重新翻译。</p>
        )}
      </div>
      <button className="primary-button" type="submit" disabled={busy || !valid || !changed}>
        {busy ? '正在保存…' : '保存修改'}
      </button>
    </form>
  );
}
