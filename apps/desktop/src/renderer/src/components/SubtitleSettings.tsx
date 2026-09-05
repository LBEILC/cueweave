import { useState } from 'react';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  type SubtitleAppearance,
} from '../../../shared/subtitle-appearance';
import { SelectControl } from './SelectControl';
import { SubtitleOverlay } from './SubtitleOverlay';

export function SubtitleSettings({
  saved,
  disabled,
  onSave,
  onDirty,
}: {
  saved: SubtitleAppearance;
  disabled: boolean;
  onSave: (value: SubtitleAppearance) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(saved);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  function change(patch: Partial<SubtitleAppearance>) {
    const next = { ...value, ...patch };
    setValue(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(saved));
  }
  return (
    <section className="settings-section" aria-labelledby="subtitle-appearance-title">
      <div className="settings-section-label">
        <h2 id="subtitle-appearance-title">字幕显示</h2>
        <p>调整视频中的字幕，预览下方效果。</p>
      </div>
      <form
        className="subtitle-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(value);
        }}
      >
        <div className="caption-preview" aria-label="字幕样式预览">
          <span className="caption-preview-label">样式预览</span>
          <SubtitleOverlay
            source="Every story begins with a voice."
            translation="每个故事，都始于一个声音。"
            appearance={value}
          />
        </div>
        <fieldset disabled={disabled}>
          <div className="subtitle-setting-pair">
            <label>
              显示内容
              <SelectControl
                aria-label="字幕显示内容"
                value={value.displayMode}
                onChange={(e) =>
                  change({ displayMode: e.target.value as SubtitleAppearance['displayMode'] })
                }
              >
                <option value="bilingual">双语字幕</option>
                <option value="translation">仅译文</option>
                <option value="source">仅原文</option>
              </SelectControl>
            </label>
            <label>
              双语顺序
              <SelectControl
                aria-label="双语顺序"
                value={value.bilingualOrder}
                disabled={value.displayMode !== 'bilingual'}
                onChange={(e) =>
                  change({ bilingualOrder: e.target.value as SubtitleAppearance['bilingualOrder'] })
                }
              >
                <option value="translation-first">译文在上</option>
                <option value="source-first">原文在上</option>
              </SelectControl>
            </label>
          </div>
          {(
            [
              ['sizePercent', '字幕大小', 75, 150, 5],
              ['sourceSizePercent', '双语原文大小', 50, 150, 1],
              ['positionPercent', '距画面底部', 4, 28, 1],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label className="subtitle-slider" key={key}>
              <span>
                {label}
                <output>{value[key]}%</output>
              </span>
              <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={value[key]}
                disabled={key === 'sourceSizePercent' && value.displayMode !== 'bilingual'}
                onChange={(e) => change({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="subtitle-toggle">
            <input
              type="checkbox"
              checked={value.backgroundEnabled}
              onChange={(e) => change({ backgroundEnabled: e.target.checked })}
            />
            字幕底板
          </label>
          <label className="subtitle-slider">
            <span>
              底板不透明度<output>{value.backgroundOpacityPercent}%</output>
            </span>
            <input
              aria-label="底板不透明度"
              type="range"
              min="10"
              max="95"
              step="5"
              value={value.backgroundOpacityPercent}
              disabled={!value.backgroundEnabled}
              onChange={(e) => change({ backgroundOpacityPercent: Number(e.target.value) })}
            />
          </label>
          <label className="subtitle-toggle">
            <input
              type="checkbox"
              checked={value.shadowEnabled}
              onChange={(e) => change({ shadowEnabled: e.target.checked })}
            />
            文字阴影
          </label>
          <label className="subtitle-slider">
            <span>
              阴影强度<output>{value.shadowStrengthPercent}%</output>
            </span>
            <input
              aria-label="阴影强度"
              type="range"
              min="0"
              max="100"
              step="5"
              value={value.shadowStrengthPercent}
              disabled={!value.shadowEnabled}
              onChange={(e) => change({ shadowStrengthPercent: Number(e.target.value) })}
            />
          </label>
        </fieldset>
        <p className="field-help">尚无译文时显示原文。样式只影响观看，不改变导出的字幕文件。</p>
        <div className="settings-actions">
          <button type="submit" className="primary-button" disabled={disabled || !dirty}>
            保存字幕样式
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={disabled}
            onClick={() => change(DEFAULT_SUBTITLE_APPEARANCE)}
          >
            恢复默认
          </button>
        </div>
      </form>
    </section>
  );
}
