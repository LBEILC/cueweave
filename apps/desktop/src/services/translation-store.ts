import type Database from 'better-sqlite3';
import { CUE_TRANSLATION_VERSION } from '@cueweave/core/provider/cueTypes';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectCue } from '../shared/project';
import type { ProviderConfig } from '../shared/settings';
import {
  validTranslationText,
  type TargetLanguage,
  type TranslationSnapshot,
  type TranslationState,
} from '../shared/translation';

export const TRANSLATION_PIPELINE = CUE_TRANSLATION_VERSION;
export function sourceIdentity(cues: readonly ProjectCue[]) {
  return createHash('sha256').update(JSON.stringify(cues)).digest('hex');
}
export function translationIdentity(
  inputHash: string,
  language: TargetLanguage,
  provider: ProviderConfig,
) {
  return createHash('sha256')
    .update(JSON.stringify({ inputHash, language, provider, pipeline: TRANSLATION_PIPELINE }))
    .digest('hex');
}
export type TranslationStoreCommand =
  | {
      action: 'translation-begin';
      projectId: string;
      baseRevision: number;
      language: TargetLanguage;
      provider: ProviderConfig;
      generation: string;
      resumeId?: string;
    }
  | {
      action: 'translation-commit';
      projectId: string;
      translationId: string;
      generation: string;
      units: Array<{ id: string; translation: string }>;
    }
  | {
      action: 'translation-finish';
      projectId: string;
      translationId: string;
      generation: string;
      state: Exclude<TranslationState, 'running'>;
      error: string;
    };
interface RunRow {
  id: string;
  trackId: string;
  inputHash: string;
  identity: string;
  language: TargetLanguage;
  generation: string;
  state: TranslationState;
  error: string;
  total: number;
  cursor: number;
}
export const TRANSLATION_SCHEMA = `
CREATE TABLE translation_runs (id TEXT PRIMARY KEY, trackId TEXT NOT NULL, inputHash TEXT NOT NULL, identity TEXT NOT NULL, language TEXT NOT NULL, configuration TEXT NOT NULL, generation TEXT NOT NULL, state TEXT NOT NULL, error TEXT NOT NULL, total INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
CREATE TABLE translation_cues (runId TEXT NOT NULL, cueId TEXT NOT NULL, machineText TEXT NOT NULL, text TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(runId,cueId));
CREATE TABLE translation_edits (runId TEXT NOT NULL, seq INTEGER NOT NULL, cueId TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, PRIMARY KEY(runId,seq));
CREATE INDEX translation_identity ON translation_runs(trackId, identity);
`;

export class TranslationStore {
  readonly inputHash: string;
  constructor(
    private db: Database.Database,
    private trackId: string,
    private source: ProjectCue[],
  ) {
    this.inputHash = sourceIdentity(source);
  }
  private row(id: string) {
    return this.db.prepare('SELECT * FROM translation_runs WHERE id=?').get(id) as
      RunRow | undefined;
  }
  private current(id: string) {
    const row = this.row(id);
    if (!row || row.trackId !== this.trackId || row.inputHash !== this.inputHash)
      throw new Error('字幕原文或时间已修改，请基于当前字幕重新翻译。');
    return row;
  }
  snapshot(selected?: string): TranslationSnapshot | null {
    let row = selected ? this.row(selected) : undefined;
    if (!row || row.trackId !== this.trackId || row.inputHash !== this.inputHash)
      row = this.db
        .prepare(
          'SELECT * FROM translation_runs WHERE trackId=? AND inputHash=? ORDER BY rowid DESC LIMIT 1',
        )
        .get(this.trackId, this.inputHash) as RunRow | undefined;
    if (!row) return null;
    const units = this.db
      .prepare('SELECT cueId, text, manual FROM translation_cues WHERE runId=?')
      .all(row.id) as Array<{ cueId: string; text: string; manual: number }>;
    return {
      id: row.id,
      targetLanguage: row.language,
      state: row.state,
      error: row.error,
      total: row.total,
      completed: units.length,
      cues: Object.fromEntries(units.map((unit) => [unit.cueId, unit.text])),
      manualCueIds: units.filter((u) => u.manual).map((u) => u.cueId),
      canUndo: row.cursor > 0,
      canRedo: Boolean(
        this.db
          .prepare('SELECT seq FROM translation_edits WHERE runId=? AND seq=?')
          .get(row.id, row.cursor + 1),
      ),
    };
  }
  begin(command: Extract<TranslationStoreCommand, { action: 'translation-begin' }>) {
    if (!this.trackId || !this.source.length) throw new Error('请先导入字幕。');
    const identity = translationIdentity(this.inputHash, command.language, command.provider);
    let row = command.resumeId
      ? this.current(command.resumeId)
      : (this.db
          .prepare(
            'SELECT * FROM translation_runs WHERE trackId=? AND identity=? ORDER BY rowid DESC LIMIT 1',
          )
          .get(this.trackId, identity) as RunRow | undefined);
    if (row && row.identity !== identity)
      throw new Error('所选模型或服务配置已改变，请开始新的翻译；旧结果仍保留。');
    if (!row) {
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO translation_runs (id,trackId,inputHash,identity,language,configuration,generation,state,error,total) VALUES (?,?,?,?,?,?,?,'running','',?)",
        )
        .run(
          id,
          this.trackId,
          this.inputHash,
          identity,
          command.language,
          JSON.stringify(command.provider),
          command.generation,
          this.source.length,
        );
      row = this.row(id)!;
    } else {
      const complete = this.snapshot(row.id)!.completed === row.total;
      this.db
        .prepare("UPDATE translation_runs SET generation=?, state=?, error='' WHERE id=?")
        .run(command.generation, complete ? 'completed' : 'running', row.id);
    }
    return row.id;
  }
  commit(command: Extract<TranslationStoreCommand, { action: 'translation-commit' }>) {
    const row = this.current(command.translationId);
    if (row.generation !== command.generation || row.state !== 'running')
      throw new Error('字幕翻译任务已停止，过期结果未写入。');
    const sourceIds = new Set(this.source.map((cue) => cue.id));
    const seen = new Set<string>();
    for (const unit of command.units) {
      if (!sourceIds.has(unit.id) || seen.has(unit.id) || !validTranslationText(unit.translation))
        throw new Error('字幕译文校验失败，未写入本次结果。');
      seen.add(unit.id);
      this.db
        .prepare(
          'INSERT INTO translation_cues(runId,cueId,machineText,text,manual) VALUES (?,?,?,?,0) ON CONFLICT(runId,cueId) DO UPDATE SET machineText=excluded.machineText,text=excluded.text WHERE translation_cues.manual=0',
        )
        .run(row.id, unit.id, unit.translation.trim(), unit.translation.trim());
    }
  }
  finish(command: Extract<TranslationStoreCommand, { action: 'translation-finish' }>) {
    const row = this.row(command.translationId);
    if (!row || row.generation !== command.generation || row.state !== 'running') return;
    const count = (
      this.db.prepare('SELECT count(*) AS n FROM translation_cues WHERE runId=?').get(row.id) as {
        n: number;
      }
    ).n;
    if (command.state === 'completed' && count !== row.total)
      throw new Error('字幕译文覆盖不完整，不能标记为完成。');
    this.db
      .prepare('UPDATE translation_runs SET state=?, error=? WHERE id=?')
      .run(command.state, command.error, row.id);
  }
  edit(id: string, cueId: string, text: string) {
    const row = this.current(id);
    const before = this.db
      .prepare('SELECT text,manual FROM translation_cues WHERE runId=? AND cueId=?')
      .get(id, cueId) as { text: string; manual: number } | undefined;
    if (!before || !validTranslationText(text)) throw new Error('字幕尚无可编辑的译文。');
    const after = { text: text.trim(), manual: 1 };
    this.db.prepare('DELETE FROM translation_edits WHERE runId=? AND seq>?').run(id, row.cursor);
    this.db
      .prepare('INSERT INTO translation_edits VALUES (?,?,?,?,?)')
      .run(id, row.cursor + 1, cueId, JSON.stringify(before), JSON.stringify(after));
    this.db
      .prepare('UPDATE translation_cues SET text=?,manual=1 WHERE runId=? AND cueId=?')
      .run(after.text, id, cueId);
    this.db.prepare('UPDATE translation_runs SET cursor=cursor+1 WHERE id=?').run(id);
  }
  history(id: string, redo: boolean) {
    const row = this.current(id);
    const edit = this.db
      .prepare('SELECT cueId,before,after FROM translation_edits WHERE runId=? AND seq=?')
      .get(id, row.cursor + (redo ? 1 : 0)) as
      { cueId: string; before: string; after: string } | undefined;
    if (!edit) throw new Error('没有可撤销或重做的译文修改。');
    const value = JSON.parse(redo ? edit.after : edit.before) as { text: string; manual: number };
    // Undo is also an explicit human decision; late model output must not overwrite it.
    this.db
      .prepare('UPDATE translation_cues SET text=?,manual=1 WHERE runId=? AND cueId=?')
      .run(value.text, id, edit.cueId);
    this.db
      .prepare('UPDATE translation_runs SET cursor=cursor+? WHERE id=?')
      .run(redo ? 1 : -1, id);
  }
}
