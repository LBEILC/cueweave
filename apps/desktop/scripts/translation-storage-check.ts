import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ProjectStore } from '../src/services/projects';
import { parseImportedSubtitles } from '../src/services/subtitle-import';

async function check() {
  const root = await mkdtemp(join(tmpdir(), 'cueweave-d2-storage-'));
  const mediaPath = join(root, '视频.mp4');
  const subtitlePath = join(root, '来源.srt');
  const directory = join(root, '翻译.cueweave');
  await writeFile(mediaPath, 'isolated-d2-media');
  await writeFile(
    subtitlePath,
    '1\n00:00:00,125 --> 00:00:01,500\nFirst &amp; second.\n\n2\n00:00:01,000 --> 00:00:03,000\nAgain, again.\n',
  );
  let store = new ProjectStore();
  let p = (
    await store.run({
      directory,
      mediaPath,
      probe: { durationSeconds: 4, format: 'mp4', tracks: [] },
      command: { action: 'create', mediaId: 'test-media' },
    })
  ).project;
  const dbPath = join(directory, 'project.sqlite');
  // Reconstruct the published D1 schema to exercise real online backup and migration.
  let db = new Database(dbPath);
  db.exec(
    'DROP TABLE translation_edits; DROP TABLE translation_cues; DROP TABLE translation_runs; PRAGMA user_version = 1;',
  );
  db.close();
  store = new ProjectStore();
  p = (
    await store.run({
      directory,
      subtitlePath,
      command: { action: 'import', projectId: p.id, baseRevision: p.revision },
    })
  ).project;
  const backups = (await readdir(directory)).filter((name) => name.startsWith('project-schema-1-'));
  assert.equal(backups.length, 1);
  db = new Database(join(directory, backups[0]!), { readonly: true });
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  db.close();
  const source = structuredClone(p.cues);
  const provider = {
    baseUrl: 'https://fixture.test/v1',
    model: 'test-model',
    protocol: 'chat-completions' as const,
  };
  const start = async (generation: string, resumeId?: string) => {
    p = (
      await store.run({
        directory,
        command: {
          action: 'translation-begin',
          projectId: p.id,
          baseRevision: p.revision,
          provider,
          language: 'zh-CN',
          generation,
          ...(resumeId ? { resumeId } : {}),
        },
      })
    ).project;
    return p.translation!.id;
  };
  const id = await start('g1');
  const commit = async (generation: string, units: Array<{ id: string; translation: string }>) => {
    p = (
      await store.run({
        directory,
        command: {
          action: 'translation-commit',
          projectId: p.id,
          translationId: id,
          generation,
          units,
        },
      })
    ).project;
  };
  await commit('g1', [{ id: source[0]!.id, translation: '第一句 & <第二句>。' }]);
  assert.equal(p.translation!.completed, 1);
  assert.deepEqual(p.cues, source);
  await assert.rejects(
    store.run({
      directory,
      outputPath: join(root, 'incomplete.srt'),
      command: {
        action: 'export',
        projectId: p.id,
        baseRevision: p.revision,
        original: false,
        format: 'srt',
        mode: 'translation',
      },
    }),
    /尚未完成/,
  );
  const partialPath = join(root, '部分.srt');
  await store.run({
    directory,
    outputPath: partialPath,
    command: {
      action: 'export',
      projectId: p.id,
      baseRevision: p.revision,
      original: false,
      format: 'srt',
      mode: 'translation',
      partial: true,
    },
  });
  assert.equal(parseImportedSubtitles(await readFile(partialPath), 4000).cues.length, 1);
  store = new ProjectStore();
  p = (await store.run({ directory, command: { action: 'open' } })).project;
  assert.equal(p.translation!.state, 'interrupted');
  assert.equal(p.translation!.completed, 1);
  await assert.rejects(commit('g1', [{ id: source[1]!.id, translation: '过期输出' }]), /已停止/);
  assert.equal(await start('g2', id), id);
  p = (
    await store.run({
      directory,
      command: {
        action: 'edit-translation',
        projectId: p.id,
        baseRevision: p.revision,
        translationId: id,
        cueId: source[0]!.id,
        text: '人工校对 & <保留>',
      },
    })
  ).project;
  const manualRevision = p.revision;
  await commit(
    'g2',
    source.map((cue) => ({ id: cue.id, translation: '机器返回' })),
  );
  assert.equal(p.translation!.cues[source[0]!.id], '人工校对 & <保留>');
  assert.equal(p.translation!.completed, 2);
  p = (
    await store.run({
      directory,
      command: {
        action: 'undo-translation',
        projectId: p.id,
        baseRevision: p.revision,
        translationId: id,
      },
    })
  ).project;
  assert.equal(p.translation!.cues[source[0]!.id], '第一句 & <第二句>。');
  await commit('g2', [{ id: source[0]!.id, translation: '不能覆盖撤销' }]);
  assert.equal(p.translation!.cues[source[0]!.id], '第一句 & <第二句>。');
  p = (
    await store.run({
      directory,
      command: {
        action: 'redo-translation',
        projectId: p.id,
        baseRevision: p.revision,
        translationId: id,
      },
    })
  ).project;
  assert.equal(p.translation!.cues[source[0]!.id], '人工校对 & <保留>');
  await assert.rejects(
    store.run({
      directory,
      command: {
        action: 'edit-translation',
        projectId: p.id,
        baseRevision: manualRevision,
        translationId: id,
        cueId: source[0]!.id,
        text: 'stale edit',
      },
    }),
    /已有更新/,
  );
  // Roll back a partial window when the transaction cannot commit.
  const prepare = Database.prototype.prepare;
  Database.prototype.prepare = function (sql: string) {
    if (sql === 'UPDATE project SET data=? WHERE id=1')
      throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
    return prepare.call(this, sql);
  } as typeof prepare;
  try {
    await assert.rejects(
      commit('g2', [{ id: source[1]!.id, translation: 'must roll back' }]),
      /磁盘空间不足/,
    );
  } finally {
    Database.prototype.prepare = prepare;
  }
  p = (
    await store.run({
      directory,
      command: { action: 'refresh', projectId: p.id, baseRevision: p.revision },
    })
  ).project;
  assert.equal(p.translation!.cues[source[1]!.id], '机器返回');
  p = (
    await store.run({
      directory,
      command: {
        action: 'translation-finish',
        projectId: p.id,
        translationId: id,
        generation: 'g2',
        state: 'completed',
        error: '',
      },
    })
  ).project;
  assert.equal(p.translation!.state, 'completed');
  const cachedRevision = p.revision;
  assert.equal(await start('g3'), id);
  assert.equal(p.translation!.state, 'completed');
  assert.equal(p.revision, cachedRevision + 1);
  for (const format of ['srt', 'vtt'] as const) {
    const outputPath = join(root, `双语.${format}`);
    await store.run({
      directory,
      outputPath,
      command: {
        action: 'export',
        projectId: p.id,
        baseRevision: p.revision,
        original: false,
        format,
        mode: 'bilingual',
      },
    });
    const parsed = parseImportedSubtitles(await readFile(outputPath), 4000).cues;
    assert.deepEqual(
      parsed.map(({ startMs, endMs }) => ({ startMs, endMs })),
      source.map(({ startMs, endMs }) => ({ startMs, endMs })),
    );
    assert.equal(parsed[0]!.text, `${source[0]!.text}\n人工校对 & <保留>`);
  }
  // Input changes hide stale translations, retain their database revision, and reject late commits.
  p = (
    await store.run({
      directory,
      command: {
        action: 'edit',
        projectId: p.id,
        baseRevision: p.revision,
        cue: { ...source[0]!, text: 'Changed source.' },
      },
    })
  ).project;
  assert.equal(p.translation, null);
  await assert.rejects(
    commit('g3', [{ id: source[1]!.id, translation: 'late source' }]),
    /重新翻译/,
  );
  const nextId = await start('g4');
  assert.notEqual(nextId, id);
  db = new Database(dbPath);
  assert.equal(
    (db.prepare('SELECT count(*) AS n FROM translation_runs').get() as { n: number }).n,
    2,
  );
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM translation_runs').all()).includes('apiKey'),
    false,
  );
  db.pragma('user_version = 999');
  db.close();
  await assert.rejects(store.run({ directory, command: { action: 'open' } }), /更新版本/);
  console.log(
    'D2 storage passed: D1 migration + backup, cue identity, persisted checkpoints, interrupted recovery, stale generation, manual edit protection + undo/redo, disk-full rollback, exact export/readback, cache identity and source invalidation.',
  );
}
void check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
