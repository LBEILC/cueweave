import { mkdir, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createSubtitleJsonRequest } from '@cueweave/core/provider/chatCompletions';
import { buildRevisionPrompt } from '../packages/core/src/provider/subtitlePrompt';
import { applySubtitleReview, REVISION_SCHEMA } from '../packages/core/src/provider/subtitleReview';
import { DEFAULT_PROVIDER_SETTINGS } from '@cueweave/core/provider/settings';
import { hash, pipelineHash, PROJECT_ROOT, redact, writeJson } from './eval/io';
import { createRuntime } from './eval/trace';
import type { Attempt } from './eval/types';
import { revisionGroups, type RevisionUnit } from './eval/revision-groups';

const { values } = parseArgs({
  options: {
    run: { type: 'string' },
    requests: { type: 'string' },
    out: { type: 'string' },
    'token-file': { type: 'string' },
    repeats: { type: 'string', default: '2' },
    'max-requests': { type: 'string', default: '60' },
  },
});
let secret = '';
async function main() {
  if (!values.run || !values.requests || !values.out || !values['token-file'])
    throw new Error('Required: --run --requests <comma-separated trace IDs> --out --token-file');
  const out = path.resolve(values.out);
  if (!path.relative(PROJECT_ROOT, out).replaceAll('\\', '/').startsWith('.eval/'))
    throw new Error('Output must be a fresh .eval directory');
  const repeats = Number(values.repeats),
    limit = Number(values['max-requests']);
  if (
    !Number.isSafeInteger(repeats) ||
    repeats < 1 ||
    repeats > 5 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new Error('Invalid repeat count or request budget');
  const ids = values.requests.split(',');
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-f\d-]{36}$/u.test(id)))
    throw new Error('Trace IDs must be unique UUID filenames');
  const run = JSON.parse(await readFile(path.join(values.run, 'result.json'), 'utf8'));
  const fixtures = [];
  for (const id of ids) {
    const raw = await readFile(path.join(values.run, 'requests', `${id}.json`), 'utf8');
    const trace = JSON.parse(raw);
    const prompt = trace.request?.messages?.find(
      (m: { role: string }) => m.role === 'user',
    )?.content;
    if (typeof prompt !== 'string' || !prompt.startsWith('对照每个 unit.source'))
      throw new Error(`Not a frozen revision request: ${id}`);
    const data = JSON.parse(prompt.split('\n').at(-1)!);
    const units = data.units as RevisionUnit[];
    if (
      !Array.isArray(units) ||
      !units.length ||
      units.some(
        (u) =>
          !Number.isSafeInteger(u.id) ||
          typeof u.source !== 'string' ||
          typeof u.translation !== 'string',
      )
    )
      throw new Error(`Invalid frozen units: ${id}`);
    revisionGroups(units, data.neighbors, 3);
    fixtures.push({ id, traceSha256: hash(raw), data: { ...data, units } });
  }
  const planned =
    repeats * fixtures.reduce((n, f) => n + 1 + Math.ceil(f.data.units.length / 3), 0);
  if (planned > limit) throw new Error(`Need at least ${planned} requests; budget is ${limit}`);
  await mkdir(out, { recursive: false });
  await mkdir(path.join(out, 'requests'));
  for (const file of ['subtitlePrompt.ts', 'subtitleReview.ts'])
    await copyFile(
      path.join(PROJECT_ROOT, 'packages/core/src/provider', file),
      path.join(out, file),
    );
  await copyFile(new URL(import.meta.url), path.join(out, 'runner.ts'));
  await copyFile(
    new URL('./eval/revision-groups.ts', import.meta.url),
    path.join(out, 'revision-groups.ts'),
  );
  secret = (await readFile(values['token-file'], 'utf8')).trim();
  if (!secret) throw new Error('Empty credential');
  const settings = {
    ...DEFAULT_PROVIDER_SETTINGS,
    model: run.identity.model,
    baseUrl: run.identity.baseUrl,
    protocol: run.identity.protocol,
    apiKey: secret,
  };
  const identity = {
    sourceFingerprint: run.fingerprint,
    pipelineHash: await pipelineHash(),
    model: settings.model,
    repeats,
    planned,
    groupSize: 3,
    fixtures,
    note: 'Fixed drafts; no-review baseline is each input translation. Structural validation only; semantic judgments pending.',
  };
  await writeJson(path.join(out, 'input.json'), identity, secret);
  const budget = { used: 0, limit, exhausted: false };
  const results: object[] = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const [index, fixture] of fixtures.entries()) {
      // Alternate scheduling to reduce systematic service-time confounding.
      const scopes = (repeat + index) % 2 ? ['local', 'whole'] : ['whole', 'local'];
      for (const scope of scopes) {
        const data = fixture.data;
        const groups = revisionGroups(
          data.units,
          data.neighbors,
          scope === 'whole' ? data.units.length : 3,
        );
        const translations = new Map<number, string>(
          data.units.map((u: RevisionUnit) => [u.id, u.translation]),
        );
        const attempts: Attempt[] = [];
        const outputs = [];
        for (const group of groups) {
          const attempt: Attempt = {
            id: randomUUID(),
            contextHash: hash(group),
            status: 'running',
            startedAt: new Date().toISOString(),
            durationMs: 0,
            stages: [],
            diagnostics: [],
            requests: [],
            cues: [],
          };
          const runtime = createRuntime(
            out,
            attempt,
            `${fixture.id}/${repeat}/${scope}`,
            secret,
            budget,
          );
          const request = createSubtitleJsonRequest(
            settings,
            undefined,
            undefined,
            runtime,
            'quality',
          );
          const start = performance.now();
          try {
            const raw = await request(
              'quality-revision',
              buildRevisionPrompt(data.context, group.neighbors, group.units, data.riskHints ?? []),
              REVISION_SCHEMA,
            );
            const output = JSON.parse(raw);
            const revised = applySubtitleReview(output, group.units);
            for (const [id, text] of revised) translations.set(id, text);
            outputs.push({ ids: group.units.map((u) => u.id), output });
            attempt.status = 'success';
          } catch (error) {
            attempt.status = 'failed';
            attempt.error = redact(String(error), secret);
          }
          attempt.durationMs = performance.now() - start;
          attempts.push(attempt);
        }
        results.push({
          fixture: fixture.id,
          repeat,
          scope,
          attempts,
          outputs,
          translations: [...translations].map(([id, translation]) => ({ id, translation })),
        });
        await writeJson(path.join(out, 'result.json'), { identity, budget, results }, secret);
        console.log(
          `${repeat + 1}/${repeats} ${fixture.id} ${scope}: ${attempts.filter((a) => a.status === 'success').length}/${attempts.length} calls accepted`,
        );
      }
    }
  }
}
main().catch((error: unknown) => {
  console.error(redact(String(error), secret));
  process.exitCode = 1;
});
