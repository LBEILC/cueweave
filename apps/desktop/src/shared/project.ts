import type { MediaAsset, MediaProbe } from './bridge';

export interface ProjectCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
export interface ProjectSnapshot {
  id: string;
  name: string;
  revision: number;
  durationMs: number;
  positionMs: number;
  trackName: string;
  activeTrackId: string;
  tracks: Array<{ id: string; name: string }>;
  cues: ProjectCue[];
  warnings: string[];
  canUndo: boolean;
  canRedo: boolean;
  mediaMissing: boolean;
}
export interface ProjectOpened {
  project: ProjectSnapshot;
  asset: MediaAsset | null;
  probe: MediaProbe | null;
}
export type ProjectCommand =
  | { action: 'create'; mediaId: string }
  | { action: 'open' | 'recent' }
  | { action: 'import' | 'undo' | 'redo' | 'relink'; projectId: string; baseRevision: number }
  | { action: 'edit'; projectId: string; baseRevision: number; cue: ProjectCue }
  | { action: 'track'; projectId: string; baseRevision: number; trackId: string }
  | { action: 'position'; projectId: string; baseRevision: number; positionMs: number }
  | {
      action: 'export';
      projectId: string;
      baseRevision: number;
      format: 'srt' | 'vtt';
      original: boolean;
    };
export type ProjectReply = {
  opened?: ProjectOpened;
  project?: ProjectSnapshot;
  exported?: string;
} | null;

export function isProjectCommand(value: unknown): value is ProjectCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const exact = (keys: string[]) =>
    Object.keys(r).length === keys.length && keys.every((k) => k in r);
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
  if (r.action === 'open' || r.action === 'recent') return exact(['action']);
  if (r.action === 'create') return exact(['action', 'mediaId']) && id(r.mediaId);
  if (!id(r.projectId) || !Number.isSafeInteger(r.baseRevision) || Number(r.baseRevision) < 0)
    return false;
  const base = ['action', 'projectId', 'baseRevision'];
  if (r.action === 'track') return exact([...base, 'trackId']) && id(r.trackId);
  if (['import', 'undo', 'redo', 'relink'].includes(String(r.action))) return exact(base);
  if (r.action === 'position')
    return (
      exact([...base, 'positionMs']) &&
      Number.isSafeInteger(r.positionMs) &&
      Number(r.positionMs) >= 0
    );
  if (r.action === 'export')
    return (
      exact([...base, 'format', 'original']) &&
      ['srt', 'vtt'].includes(String(r.format)) &&
      typeof r.original === 'boolean'
    );
  if (r.action === 'edit' && exact([...base, 'cue']) && r.cue && typeof r.cue === 'object') {
    const c = r.cue as Record<string, unknown>;
    return (
      Object.keys(c).length === 4 &&
      id(c.id) &&
      Number.isSafeInteger(c.startMs) &&
      Number.isSafeInteger(c.endMs) &&
      Number(c.startMs) >= 0 &&
      Number(c.endMs) > Number(c.startMs) &&
      typeof c.text === 'string' &&
      c.text.trim().length > 0 &&
      c.text.length <= 20000 &&
      !c.text.includes('\u0000') &&
      !/\n\s*\n/.test(c.text)
    );
  }
  return false;
}
