import {
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  FloppyDiskIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { ProjectCommand, ProjectSnapshot } from '../../../shared/project';
import { SelectControl } from './SelectControl';

export function ProjectHeader({
  canCreate,
  hasProject,
  busy,
  run,
}: {
  canCreate: boolean;
  hasProject: boolean;
  busy: boolean;
  run: (action: 'create' | 'open') => void;
}) {
  return (
    <>
      <button className="quiet-button" disabled={busy} onClick={() => run('open')}>
        <FolderOpenIcon size={18} aria-hidden="true" />
        打开项目
      </button>
      {canCreate && !hasProject && (
        <button className="quiet-button" disabled={busy} onClick={() => run('create')}>
          <FloppyDiskIcon size={18} aria-hidden="true" />
          创建项目
        </button>
      )}
    </>
  );
}

export function ProjectTools({
  project,
  busy,
  run,
}: {
  project: ProjectSnapshot;
  busy: boolean;
  run: (command: ProjectCommand) => Promise<boolean>;
}) {
  const [format, setFormat] = useState<'srt' | 'vtt'>('srt');
  const [original, setOriginal] = useState(false);
  const base = { projectId: project.id, baseRevision: project.revision };
  return (
    <div className="project-tools">
      {project.tracks.length > 1 && (
        <label className="project-track-selector">
          字幕轨
          <SelectControl
            aria-label="项目字幕轨"
            value={project.activeTrackId}
            disabled={busy}
            onChange={(event) =>
              void run({ action: 'track', ...base, trackId: event.target.value })
            }
          >
            {project.tracks.map((track) => (
              <option value={track.id} key={track.id}>
                {track.name}
              </option>
            ))}
          </SelectControl>
        </label>
      )}
      <div className="project-edit-actions">
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => void run({ action: 'import', ...base })}
        >
          导入字幕
        </button>
        <button
          className="quiet-button"
          aria-label="撤销字幕修改"
          title="撤销字幕修改"
          disabled={busy || !project.canUndo}
          onClick={() => void run({ action: 'undo', ...base })}
        >
          <ArrowCounterClockwiseIcon size={18} aria-hidden="true" />
        </button>
        <button
          className="quiet-button"
          aria-label="重做字幕修改"
          title="重做字幕修改"
          disabled={busy || !project.canRedo}
          onClick={() => void run({ action: 'redo', ...base })}
        >
          <ArrowClockwiseIcon size={18} aria-hidden="true" />
        </button>
      </div>
      <details className="project-export">
        <summary>导出字幕</summary>
        <div className="project-export-options">
          <label>
            内容
            <SelectControl
              aria-label="导出内容"
              value={original ? 'original' : 'edited'}
              onChange={(e) => setOriginal(e.target.value === 'original')}
            >
              <option value="edited">编辑后字幕</option>
              <option value="original">原始字幕</option>
            </SelectControl>
          </label>
          <label>
            格式
            <SelectControl
              aria-label="导出格式"
              value={format}
              onChange={(e) => setFormat(e.target.value as 'srt' | 'vtt')}
            >
              <option value="srt">SRT</option>
              <option value="vtt">WebVTT</option>
            </SelectControl>
          </label>
          <button
            className="quiet-button"
            disabled={busy || !project.cues.length}
            onClick={() => void run({ action: 'export', ...base, format, original })}
          >
            <DownloadSimpleIcon size={17} aria-hidden="true" />
            导出文件
          </button>
        </div>
      </details>
      {project.warnings.map((warning) => (
        <p className="project-warning" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}
