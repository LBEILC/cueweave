import { useState } from 'react';
import type { ProjectCue } from '../../../shared/project';

export function CueEditor({
  cue,
  durationMs,
  busy,
  onSave,
  onClose,
  onDirty,
}: {
  cue: ProjectCue;
  durationMs: number;
  busy: boolean;
  onSave: (cue: ProjectCue) => Promise<boolean>;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(cue.text);
  const [start, setStart] = useState(String(cue.startMs / 1000));
  const [end, setEnd] = useState(String(cue.endMs / 1000));
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  const valid =
    text.trim().length > 0 &&
    !/\n\s*\n/.test(text) &&
    start !== '' &&
    end !== '' &&
    Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    startMs >= 0 &&
    endMs > startMs &&
    endMs <= durationMs;
  const changed = text !== cue.text || startMs !== cue.startMs || endMs !== cue.endMs;
  return (
    <form
      className="cue-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid)
          void onSave({ ...cue, startMs, endMs, text: text.trim() }).then((saved) => {
            if (saved) {
              onDirty(false);
              onClose();
            }
          });
      }}
    >
      <div className="cue-editor-heading">
        <strong>编辑字幕</strong>
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
      <label>
        字幕文本
        <textarea
          aria-label="字幕文本"
          rows={3}
          maxLength={20000}
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            onDirty(true);
          }}
        />
      </label>
      {!valid && (
        <p className="inline-error" role="alert">
          请填写非空字幕，避免空行；时间须在视频范围内，结束晚于开始。
        </p>
      )}
      <button className="primary-button" type="submit" disabled={busy || !valid || !changed}>
        {busy ? '正在保存…' : '保存修改'}
      </button>
    </form>
  );
}
