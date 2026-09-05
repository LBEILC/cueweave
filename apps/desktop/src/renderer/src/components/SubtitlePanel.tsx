import {
  CrosshairIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SubtitlesIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  translation?: string | undefined;
  manual?: boolean | undefined;
}

function timestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Shared subtitle navigation, with project editing attached alongside playback. */
export function SubtitlePanel({
  cues,
  position,
  name,
  onSeek,
  onClose,
  children,
  onEdit,
  editor,
  tools,
  locked = false,
}: {
  cues: SubtitleCue[];
  position: number;
  name: string | undefined;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  children: ReactNode;
  onEdit?: ((index: number) => void) | undefined;
  editor?: ReactNode;
  tools?: ReactNode;
  locked?: boolean;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = cues.findIndex((cue) => position >= cue.start && position < cue.end);
  const search = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      cues
        .map((cue, index) => ({ cue, index }))
        .filter(({ cue }) =>
          `${cue.text}\n${cue.translation ?? ''}`.toLocaleLowerCase().includes(search),
        ),
    [cues, search],
  );
  return (
    <aside className="subtitle-panel" id="subtitle-panel" aria-label="字幕面板">
      <div className="panel-heading">
        <h2>
          <SubtitlesIcon size={19} aria-hidden="true" />
          字幕 <span>{cues.length || ''}</span>
        </h2>
        <button
          type="button"
          className="quiet-button"
          aria-label="收起字幕面板"
          onClick={onClose}
          disabled={locked}
        >
          <XIcon size={18} aria-hidden="true" />
        </button>
      </div>
      {tools}
      <details className="subtitle-source-options" open={cues.length === 0}>
        <summary title={name}>{name ?? '字幕来源'}</summary>
        <div className="subtitle-source">{children}</div>
      </details>
      {cues.length > 0 ? (
        <>
          <div className="subtitle-search">
            <MagnifyingGlassIcon size={17} aria-hidden="true" />
            <input
              aria-label="搜索字幕"
              placeholder="搜索字幕"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="quiet-button"
              type="button"
              aria-label="定位当前句"
              disabled={activeIndex < 0}
              onClick={() => {
                setQuery('');
                requestAnimationFrame(() =>
                  listRef.current
                    ?.querySelector(`[data-cue-index="${activeIndex}"]`)
                    ?.scrollIntoView({ block: 'center' }),
                );
              }}
            >
              <CrosshairIcon size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="subtitle-list" ref={listRef}>
            {matches.map(({ cue, index }) => (
              <div className="subtitle-row-container" key={index}>
                <button
                  key={index}
                  type="button"
                  className={`subtitle-row${index === activeIndex ? ' is-current' : ''}`}
                  data-cue-index={index}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  onClick={() => onSeek(cue.start)}
                >
                  <span className="cue-time">
                    {timestamp(cue.start)}{' '}
                    <span>
                      {index === activeIndex ? '当前' : String(index + 1).padStart(2, '0')}
                    </span>
                  </span>
                  <span className="cue-text">
                    <span>{cue.text}</span>
                    {cue.translation && (
                      <span className="cue-translation">
                        {cue.translation}
                        {cue.manual && <small>已校对</small>}
                      </span>
                    )}
                  </span>
                </button>
                {onEdit && (
                  <button
                    type="button"
                    className="cue-edit-button quiet-button"
                    aria-label={`编辑第 ${index + 1} 条字幕`}
                    disabled={locked}
                    onClick={() => onEdit(index)}
                  >
                    <PencilSimpleIcon size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {matches.length === 0 && (
              <p className="panel-empty">没有匹配的字幕。试试其他关键词。</p>
            )}
          </div>
          {editor}
          <div className="panel-footer">
            {search ? `${matches.length} 条匹配` : '点击字幕定位播放'}
          </div>
        </>
      ) : (
        <div className="panel-empty">
          <SubtitlesIcon size={32} aria-hidden="true" />
          <h3>添加字幕，边看边对照</h3>
          <p>加载 SRT / WebVTT 文件后，可在这里查看字幕并定位播放。</p>
        </div>
      )}
    </aside>
  );
}
