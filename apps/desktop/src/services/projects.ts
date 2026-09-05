import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { serializeSubtitles } from '@cueweave/core';
import type { MediaProbe } from '../shared/bridge';
import type { ProjectCommand, ProjectCue, ProjectSnapshot } from '../shared/project';
import { parseImportedSubtitles } from './subtitle-import';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import {
  TRANSLATION_SCHEMA,
  TranslationStore,
  type TranslationStoreCommand,
} from './translation-store';

interface StoredProject {
  translationId?: string;
  id: string;
  name: string;
  revision: number;
  durationMs: number;
  positionMs: number;
  mediaPath: string;
  relativePath: string;
  hash: string;
  size: number;
  probe: MediaProbe;
  trackName: string;
  activeTrack: string;
  warnings: string[];
  cursor: number;
}
export interface ProjectServiceRequest {
  directory: string;
  command: ProjectCommand | TranslationStoreCommand;
  provider?: ProviderSettings;
  mediaPath?: string;
  subtitlePath?: string;
  outputPath?: string;
  probe?: MediaProbe;
}
export interface ProjectServiceReply {
  project: ProjectSnapshot;
  mediaPath: string | null;
  probe: MediaProbe;
  exported?: string;
}
export function projectErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'EEXIST') return '项目目录已存在，请选择一个新的项目名称。';
  if (code === 'ENOENT') return '项目或媒体文件已移动，请重新选择文件。';
  if (/FULL|ENOSPC/.test(code)) return '磁盘空间不足，修改未保存。请释放空间后重试。';
  if (/READONLY|EACCES|EPERM/.test(code)) return '项目或导出位置不可写，请检查文件权限。';
  if (
    !code &&
    error instanceof Error &&
    /^(项目|媒体|字幕|磁盘|所选|请|没有|第)/.test(error.message)
  )
    return error.message.slice(0, 300);
  return '项目操作未完成，请检查文件位置、目录权限和磁盘空间。';
}

async function fingerprint(path: string) {
  const before = await stat(path);
  if (!before.isFile()) throw new Error('媒体文件不可用。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error('媒体正在被修改，请稍后重试。');
  return { hash: hash.digest('hex'), size: after.size };
}

export class ProjectStore {
  private readonly recoveredDirectories = new Set<string>();
  private readonly verifiedMedia = new Map<
    string,
    { path: string; size: number; mtimeMs: number } | null
  >();
  // One queue owns all database writes, including asynchronous import/export steps.
  private tail: Promise<unknown> = Promise.resolve();
  run(request: ProjectServiceRequest): Promise<ProjectServiceReply> {
    const result = this.tail.then(() => this.execute(request));
    this.tail = result.catch(() => {});
    return result;
  }

  private async execute(request: ProjectServiceRequest): Promise<ProjectServiceReply> {
    const { command } = request;
    const creating = command.action === 'create';
    let directory = resolve(request.directory);
    if (creating) await mkdir(directory); // Never replace an existing project.
    directory = await realpath(directory);
    const dbPath = join(directory, 'project.sqlite');
    if (!creating && (await lstat(dbPath)).isSymbolicLink())
      throw new Error('项目数据库不能是符号链接。');
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { fileMustExist: !creating });
      const version = Number(db.pragma('user_version', { simple: true }));
      if (!creating && version !== 1 && version !== 2)
        throw new Error(
          version > 2 ? '项目来自更新版本，请升级句织后打开。' : '项目版本不受支持。',
        );
      if (!creating && version === 1) {
        await db.backup(join(directory, `project-schema-1-${randomUUID()}.sqlite`));
        db.transaction(() => {
          db!.exec(TRANSLATION_SCHEMA);
          db!.pragma('user_version = 2');
        })();
      }
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      db.pragma('busy_timeout = 5000');
      if (creating) {
        if (!request.mediaPath || !request.probe?.durationSeconds)
          throw new Error('请先打开一个时长可读取的本地视频。');
        const identity = await fingerprint(request.mediaPath);
        const data: StoredProject = {
          id: randomUUID(),
          name: basename(directory).replace(/\.cueweave$/i, ''),
          revision: 0,
          durationMs: Math.round(request.probe.durationSeconds * 1000),
          positionMs: 0,
          mediaPath: await realpath(request.mediaPath),
          relativePath: relative(directory, request.mediaPath),
          ...identity,
          probe: request.probe,
          trackName: '',
          activeTrack: '',
          warnings: [],
          cursor: 0,
        };
        db.transaction(() => {
          db!.exec(
            'CREATE TABLE project (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); CREATE TABLE tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, original BLOB NOT NULL, cues TEXT NOT NULL); CREATE TABLE cues (id TEXT PRIMARY KEY, startMs INTEGER NOT NULL, endMs INTEGER NOT NULL, text TEXT NOT NULL); CREATE TABLE edits (seq INTEGER PRIMARY KEY, baseRevision INTEGER NOT NULL, cueId TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL); CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, checkpoint TEXT NOT NULL); PRAGMA user_version = 1;',
          );
          db!.prepare('INSERT INTO project VALUES (1, ?)').run(JSON.stringify(data));
          db!.exec(
            "CREATE TABLE track_state (id TEXT PRIMARY KEY, cues TEXT NOT NULL, edits TEXT NOT NULL, cursor INTEGER NOT NULL, warnings TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'und', precision TEXT NOT NULL DEFAULT 'cue')",
          );
          db!.exec(TRANSLATION_SCHEMA);
          db!.pragma('user_version = 2');
        })();
      }
      if (!this.recoveredDirectories.has(directory)) {
        db.prepare(
          "UPDATE translation_runs SET state='interrupted', error='翻译因应用或后台服务退出而中断，已保存部分可继续。' WHERE state='running'",
        ).run();
        this.recoveredDirectories.add(directory);
      }
      const read = () =>
        JSON.parse(
          (db!.prepare('SELECT data FROM project WHERE id=1').get() as { data: string }).data,
        ) as StoredProject;
      const save = (p: StoredProject) =>
        db!.prepare('UPDATE project SET data=? WHERE id=1').run(JSON.stringify(p));
      let p = read();
      if ('projectId' in command && p.id !== command.projectId)
        throw new Error('项目已切换，请重新打开项目。');
      if (command.action === 'open' || command.action === 'recent')
        db.prepare("UPDATE jobs SET state='interrupted' WHERE state='running'").run();
      const verifyRevision = () => {
        p = read();
        if ('baseRevision' in command && p.revision !== command.baseRevision)
          throw new Error('项目已有更新，当前修改未写入。请重新打开项目后重试。');
      };
      if ('baseRevision' in command && !['refresh', 'cancel-translation'].includes(command.action))
        verifyRevision();
      const cues = () =>
        db!
          .prepare('SELECT id, startMs, endMs, text FROM cues ORDER BY startMs, endMs, id')
          .all() as ProjectCue[];
      const writeCue = (cue: ProjectCue) =>
        db!.prepare('INSERT OR REPLACE INTO cues VALUES (@id, @startMs, @endMs, @text)').run(cue);
      const translations = () => new TranslationStore(db!, p.activeTrack, cues());
      const archiveActive = () => {
        if (p.activeTrack)
          db!
            .prepare(
              'INSERT OR REPLACE INTO track_state (id,cues,edits,cursor,warnings) VALUES (?, ?, ?, ?, ?)',
            )
            .run(
              p.activeTrack,
              JSON.stringify(cues()),
              JSON.stringify(db!.prepare('SELECT * FROM edits ORDER BY seq').all()),
              p.cursor,
              JSON.stringify(p.warnings),
            );
      };
      if (command.action === 'translation-begin') {
        db.transaction(() => {
          verifyRevision();
          p.translationId = translations().begin(command);
          p.revision++;
          save(p);
        })();
      } else if (command.action === 'translation-commit') {
        db.transaction(() => {
          translations().commit(command);
          save(p);
        })();
      } else if (command.action === 'translation-finish') {
        db.transaction(() => translations().finish(command))();
      } else if (
        command.action === 'edit-translation' ||
        command.action === 'undo-translation' ||
        command.action === 'redo-translation'
      ) {
        db.transaction(() => {
          verifyRevision();
          if (command.action === 'edit-translation')
            translations().edit(command.translationId, command.cueId, command.text);
          else translations().history(command.translationId, command.action === 'redo-translation');
          p.revision++;
          save(p);
        })();
      } else if (command.action === 'import') {
        if (!request.subtitlePath) throw new Error('请选择字幕文件。');
        if ((await stat(request.subtitlePath)).size > 10_000_000)
          throw new Error('字幕文件超过 10 MB。');
        const bytes = await readFile(request.subtitlePath);
        const parsed = parseImportedSubtitles(bytes, p.durationMs);
        const trackId = randomUUID();
        db.transaction(() => {
          verifyRevision();
          archiveActive();
          db!
            .prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)')
            .run(trackId, basename(request.subtitlePath!), bytes, JSON.stringify(parsed.cues));
          db!.exec('DELETE FROM cues; DELETE FROM edits;');
          parsed.cues.forEach(writeCue);
          p.activeTrack = trackId;
          p.trackName = basename(request.subtitlePath!);
          p.warnings = parsed.warnings;
          p.cursor = 0;
          p.revision++;
          archiveActive();
          save(p);
          db!
            .prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)')
            .run(
              randomUUID(),
              'import',
              p.revision,
              'completed',
              JSON.stringify({ trackId, cues: parsed.cues.length }),
            );
        })();
      } else if (command.action === 'track') {
        db.transaction(() => {
          verifyRevision();
          archiveActive();
          const track = db!
            .prepare(
              'SELECT tracks.name, track_state.* FROM tracks JOIN track_state ON tracks.id=track_state.id WHERE tracks.id=?',
            )
            .get(command.trackId) as
            | { name: string; cues: string; edits: string; cursor: number; warnings: string }
            | undefined;
          if (!track) throw new Error('所选字幕轨不属于当前项目。');
          db!.exec('DELETE FROM cues; DELETE FROM edits;');
          (JSON.parse(track.cues) as ProjectCue[]).forEach(writeCue);
          for (const edit of JSON.parse(track.edits) as Array<Record<string, string | number>>)
            db!
              .prepare('INSERT INTO edits VALUES (@seq, @baseRevision, @cueId, @before, @after)')
              .run(edit);
          p.activeTrack = command.trackId;
          p.trackName = track.name;
          p.cursor = track.cursor;
          p.warnings = JSON.parse(track.warnings) as string[];
          p.revision++;
          save(p);
        })();
      } else if (
        command.action === 'edit' ||
        command.action === 'undo' ||
        command.action === 'redo'
      ) {
        db.transaction(() => {
          verifyRevision();
          if (command.action === 'edit') {
            if (command.cue.endMs > p.durationMs) throw new Error('字幕结束时间不能超出视频时长。');
            const before = db!
              .prepare('SELECT id, startMs, endMs, text FROM cues WHERE id=?')
              .get(command.cue.id) as ProjectCue | undefined;
            if (!before) throw new Error('字幕已变更，请重新打开项目。');
            db!.prepare('DELETE FROM edits WHERE seq>?').run(p.cursor);
            db!
              .prepare('INSERT INTO edits VALUES (?, ?, ?, ?, ?)')
              .run(
                ++p.cursor,
                p.revision,
                command.cue.id,
                JSON.stringify(before),
                JSON.stringify(command.cue),
              );
            writeCue(command.cue);
          } else {
            const seq = command.action === 'undo' ? p.cursor : p.cursor + 1;
            const edit = db!.prepare('SELECT before, after FROM edits WHERE seq=?').get(seq) as
              { before: string; after: string } | undefined;
            if (!edit) throw new Error('没有可撤销或重做的修改。');
            writeCue(
              JSON.parse(command.action === 'undo' ? edit.before : edit.after) as ProjectCue,
            );
            p.cursor += command.action === 'undo' ? -1 : 1;
          }
          p.revision++;
          archiveActive();
          save(p);
        })();
      } else if (command.action === 'position') {
        db.transaction(() => {
          verifyRevision();
          p.positionMs = Math.min(command.positionMs, p.durationMs);
          save(p);
        })();
      } else if (command.action === 'relink') {
        if (!request.mediaPath) throw new Error('请选择原视频。');
        const identity = await fingerprint(request.mediaPath);
        if (identity.hash !== p.hash || identity.size !== p.size)
          throw new Error('所选视频与原视频内容不同，未替换媒体或字幕。请选择原视频。');
        db.transaction(() => {
          verifyRevision();
          p.mediaPath = request.mediaPath!;
          p.relativePath = relative(directory, p.mediaPath);
          p.revision++;
          save(p);
        })();
      }
      let exported: string | undefined;
      if (command.action === 'export') {
        if (!request.outputPath) throw new Error('请选择导出位置。');
        const target = resolve(request.outputPath);
        const targetParent = await realpath(dirname(target));
        if (
          targetParent === directory ||
          targetParent.startsWith(directory + '\\') ||
          targetParent.startsWith(directory + '/')
        )
          throw new Error('请将导出字幕保存到项目目录以外。');
        let snapshot = command.original
          ? (JSON.parse(
              (
                db.prepare('SELECT cues FROM tracks WHERE id=?').get(p.activeTrack) as
                  { cues: string } | undefined
              )?.cues ?? '[]',
            ) as ProjectCue[])
          : cues();
        if (command.mode) {
          const translation = translations().snapshot(p.translationId);
          if (!translation) throw new Error('字幕尚未翻译。');
          if (translation.completed !== translation.total && !command.partial)
            throw new Error('字幕翻译尚未完成，请先补齐缺失内容，或明确选择部分导出。');
          snapshot = snapshot
            .filter((cue) => Boolean(translation.cues[cue.id]))
            .map((cue) => ({
              ...cue,
              text:
                command.mode === 'bilingual'
                  ? `${cue.text}\n${translation.cues[cue.id]}`
                  : translation.cues[cue.id]!,
            }));
          if (!snapshot.length) throw new Error('没有可导出的译文。');
        }
        snapshot.sort((a, b) => a.startMs - b.startMs);
        const content = serializeSubtitles(
          snapshot.map((c) => ({
            id: c.id,
            startMs: c.startMs,
            endMs: c.endMs,
            sourceTokenIds: [],
            sourceText: c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            translation: '',
            sentenceEnd: false,
            status: 'pending' as const,
          })),
          command.format,
          'corrected',
        );
        const job = randomUUID();
        db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(
          job,
          'export',
          p.revision,
          'running',
          JSON.stringify({ target, revision: p.revision }),
        );
        const temp = join(targetParent, `.cueweave-${job}.tmp`);
        try {
          const file = await open(temp, 'wx');
          try {
            await file.writeFile(content, 'utf8');
            await file.sync();
          } finally {
            await file.close();
          }
          const bytes = await readFile(temp);
          if (bytes.toString('utf8') !== content) throw new Error('字幕回读校验失败。');
          const parsed = parseImportedSubtitles(bytes, p.durationMs);
          if (parsed.cues.length !== snapshot.length) throw new Error('字幕回读条数不一致。');
          if (
            parsed.cues.some(
              (cue, index) =>
                cue.startMs !== snapshot[index]!.startMs ||
                cue.endMs !== snapshot[index]!.endMs ||
                cue.text !== snapshot[index]!.text.trim(),
            )
          )
            throw new Error('字幕回读内容或时间不一致。');
          await rename(temp, target);
          db.prepare("UPDATE jobs SET state='completed' WHERE id=?").run(job);
          exported = basename(target);
        } catch (error) {
          db.prepare("UPDATE jobs SET state='failed' WHERE id=?").run(job);
          throw error;
        } finally {
          await rm(temp, { force: true }).catch(() => {});
        }
      }
      let mediaPath: string | null = null;
      const cached = this.verifiedMedia.get(p.id);
      let recheck =
        creating || ['open', 'recent', 'relink'].includes(command.action) || cached === undefined;
      if (!recheck && cached) {
        try {
          const current = await stat(cached.path);
          if (current.size === cached.size && current.mtimeMs === cached.mtimeMs)
            mediaPath = cached.path;
          else recheck = true;
        } catch {
          this.verifiedMedia.set(p.id, null);
        }
      }
      if (recheck)
        for (const candidate of new Set([resolve(directory, p.relativePath), p.mediaPath])) {
          try {
            const identity = await fingerprint(candidate);
            if (identity.hash !== p.hash || identity.size !== p.size) continue;
            const current = await stat(candidate);
            this.verifiedMedia.set(p.id, {
              path: candidate,
              size: current.size,
              mtimeMs: current.mtimeMs,
            });
            mediaPath = candidate;
            break;
          } catch {
            /* Missing/mismatched media stays editable and can be relinked. */
          }
        }
      if (!mediaPath) this.verifiedMedia.set(p.id, null);
      const project: ProjectSnapshot = {
        translation: translations().snapshot(p.translationId),
        id: p.id,
        name: p.name,
        revision: p.revision,
        durationMs: p.durationMs,
        positionMs: p.positionMs,
        trackName: p.trackName,
        activeTrackId: p.activeTrack,
        tracks: db.prepare('SELECT id, name FROM tracks ORDER BY rowid').all() as Array<{
          id: string;
          name: string;
        }>,
        cues: cues(),
        warnings: p.warnings,
        canUndo: p.cursor > 0,
        canRedo: Boolean(db.prepare('SELECT seq FROM edits WHERE seq=?').get(p.cursor + 1)),
        mediaMissing: mediaPath === null,
      };
      return { project, mediaPath, probe: p.probe, ...(exported ? { exported } : {}) };
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (/FULL|ENOSPC/.test(code)) throw new Error('磁盘空间不足，修改未保存。请释放空间后重试。');
      if (/READONLY|EACCES|EPERM/.test(code))
        throw new Error('项目或导出位置不可写，请检查文件权限。');
      if (/SQLITE/.test(code)) throw new Error('项目数据库无法读取或写入，已保留原文件。');
      if (code || !(error instanceof Error))
        throw new Error('项目文件无法访问，请检查文件位置、目录权限和磁盘空间。');
      throw error;
    } finally {
      db?.close();
    }
  }
}
