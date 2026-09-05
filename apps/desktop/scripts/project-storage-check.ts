import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ProjectStore } from '../src/services/projects';
import { parseImportedSubtitles } from '../src/services/subtitle-import';

async function check() {
  const root = await mkdtemp(join(tmpdir(), 'cueweave-project-storage-'));
  const mediaPath = join(root, '原视频.mp4');
  await writeFile(mediaPath, 'deterministic media identity');
  const directory = join(root, '测试项目.cueweave');
  const store = new ProjectStore();
  const created = await store.run({
    directory,
    command: { action: 'create', mediaId: 'm' },
    mediaPath,
    probe: { durationSeconds: 10, format: 'mp4', tracks: [] },
  });
  const id = created.project.id;
  const subtitlePath = join(root, '原字幕.vtt');
  const original =
    'WEBVTT\n\n00:00.123 --> 00:02.456\nFirst &amp;lt; &lt;字幕&gt;\n\n00:01.500 --> 00:03.000\n自然重叠\n';
  await writeFile(subtitlePath, original);
  const imported = await store.run({
    directory,
    command: { action: 'import', projectId: id, baseRevision: 0 },
    subtitlePath,
  });
  const base = imported.project;
  assert.equal(base.revision, 1);
  const editedCue = { ...base.cues[0]!, startMs: 250, text: '手工修改 & <比较>\n第二行' };
  const edited = await store.run({
    directory,
    command: { action: 'edit', projectId: id, baseRevision: 1, cue: editedCue },
  });
  assert.equal(edited.project.revision, 2);
  await assert.rejects(
    store.run({
      directory,
      command: {
        action: 'edit',
        projectId: id,
        baseRevision: 1,
        cue: { ...editedCue, text: 'stale must never win' },
      },
    }),
    /已有更新/,
  );
  const undone = await store.run({
    directory,
    command: { action: 'undo', projectId: id, baseRevision: 2 },
  });
  assert.equal(undone.project.cues[0]!.text, base.cues[0]!.text);
  const redone = await store.run({
    directory,
    command: { action: 'redo', projectId: id, baseRevision: 3 },
  });
  assert.equal(redone.project.cues[0]!.text, editedCue.text);
  await store.run({
    directory,
    command: { action: 'position', projectId: id, baseRevision: 4, positionMs: 1700 },
  });
  const reopened = await new ProjectStore().run({ directory, command: { action: 'open' } });
  assert.equal(reopened.project.positionMs, 1700);
  assert.equal(reopened.project.revision, 4);
  assert.equal(reopened.project.canUndo, true);

  // Inject a native disk-full failure after cue writes but before transaction commit.
  const prepare = Database.prototype.prepare;
  Database.prototype.prepare = function (sql: string) {
    if (sql === 'UPDATE project SET data=? WHERE id=1')
      throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    return prepare.call(this, sql);
  } as typeof prepare;
  try {
    await assert.rejects(
      store.run({
        directory,
        command: {
          action: 'edit',
          projectId: id,
          baseRevision: 4,
          cue: { ...editedCue, text: 'must roll back' },
        },
      }),
      /磁盘空间不足/,
    );
  } finally {
    Database.prototype.prepare = prepare;
  }
  const afterFull = await store.run({ directory, command: { action: 'open' } });
  assert.equal(afterFull.project.revision, 4);
  assert.equal(afterFull.project.cues[0]!.text, editedCue.text);
  const exported = join(root, '编辑字幕.srt');
  await store.run({
    directory,
    command: { action: 'export', projectId: id, baseRevision: 4, format: 'srt', original: false },
    outputPath: exported,
  });
  assert.match(
    await readFile(exported, 'utf8'),
    /00:00:00,250 --> 00:00:02,456\n手工修改 &amp; &lt;比较&gt;/,
  );
  const originalOutput = join(root, '原始字幕.vtt');
  await store.run({
    directory,
    command: { action: 'export', projectId: id, baseRevision: 4, format: 'vtt', original: true },
    outputPath: originalOutput,
  });
  assert.deepEqual(
    parseImportedSubtitles(await readFile(originalOutput), 10000).cues,
    parseImportedSubtitles(new TextEncoder().encode(original), 10000).cues,
  );
  await assert.rejects(
    store.run({
      directory,
      command: { action: 'export', projectId: id, baseRevision: 4, format: 'srt', original: false },
      outputPath: join(directory, 'project.sqlite'),
    }),
    /目录以外/,
  );
  await writeFile(subtitlePath, '1\n00:00:09,000 --> 00:00:11,000\nInvalid');
  await assert.rejects(
    store.run({
      directory,
      command: { action: 'import', projectId: id, baseRevision: 4 },
      subtitlePath,
    }),
    /超出视频范围/,
  );
  const moved = join(root, '移动后.mp4');
  await rename(mediaPath, moved);
  const missing = await store.run({ directory, command: { action: 'open' } });
  assert.equal(missing.project.mediaMissing, true);
  await writeFile(mediaPath, 'different media');
  await assert.rejects(
    store.run({
      directory,
      command: { action: 'relink', projectId: id, baseRevision: 4 },
      mediaPath,
    }),
    /内容不同/,
  );
  const relinked = await store.run({
    directory,
    command: { action: 'relink', projectId: id, baseRevision: 4 },
    mediaPath: moved,
  });
  assert.equal(relinked.project.mediaMissing, false);
  const concurrent = await Promise.allSettled(
    ['first writer', 'stale writer'].map((text) =>
      store.run({
        directory,
        command: { action: 'edit', projectId: id, baseRevision: 5, cue: { ...editedCue, text } },
      }),
    ),
  );
  assert.equal(concurrent[0]!.status, 'fulfilled');
  assert.equal(concurrent[1]!.status, 'rejected');
  await writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:01,000\n第二条独立字幕轨');
  const secondTrack = await store.run({
    directory,
    command: { action: 'import', projectId: id, baseRevision: 6 },
    subtitlePath,
  });
  assert.equal(secondTrack.project.tracks.length, 2);
  const firstTrackAgain = await store.run({
    directory,
    command: { action: 'track', projectId: id, baseRevision: 7, trackId: base.activeTrackId },
  });
  assert.equal(firstTrackAgain.project.cues[0]!.text, 'first writer');
  assert.equal(firstTrackAgain.project.canUndo, true);
  const firstTrackUndo = await store.run({
    directory,
    command: { action: 'undo', projectId: id, baseRevision: 8 },
  });
  assert.equal(firstTrackUndo.project.cues[0]!.text, editedCue.text);
  const db = new Database(join(directory, 'project.sqlite'));
  assert.equal(
    (db.prepare('SELECT original FROM tracks').get() as { original: Buffer }).original.toString(
      'utf8',
    ),
    original,
  );
  db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run(
    'interrupted-fixture',
    'export',
    6,
    'running',
    '{}',
  );
  db.close();
  await store.run({ directory, command: { action: 'open' } });
  const recovered = new Database(join(directory, 'project.sqlite'));
  assert.equal(
    (
      recovered.prepare('SELECT state FROM jobs WHERE id=?').get('interrupted-fixture') as {
        state: string;
      }
    ).state,
    'interrupted',
  );
  recovered.pragma('user_version = 999');
  recovered.close();
  await assert.rejects(store.run({ directory, command: { action: 'open' } }), /更新版本/);
  console.log(
    'Project storage passed: original preservation, edit/undo/redo, stale and concurrent writes, disk-full rollback, reopen, atomic export/readback, relink identity, interrupted jobs, and future schema rejection.',
  );
}
void check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
