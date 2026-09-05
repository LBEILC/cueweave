import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalRun, RequestSummary } from './types';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function hash(value: string | object): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}

export function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value;
}

export async function writeAtomic(file: string, value: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, file);
}

export async function writeJson(file: string, value: unknown, secret = ''): Promise<void> {
  await writeAtomic(file, `${redact(JSON.stringify(value, null, 2), secret)}\n`);
}

export async function readRun(directory: string): Promise<EvalRun> {
  const value = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')) as EvalRun;
  if (
    value.schema !== 1 ||
    !value.identity ||
    !Array.isArray(value.tokens) ||
    !Array.isArray(value.windows) ||
    !value.results
  ) {
    throw new Error(`评测结果格式无效：${directory}。请使用本工具生成的运行目录。`);
  }
  // Request traces are committed independently; recover calls made after the last window checkpoint.
  const attempts = new Map(
    [
      ...value.entityAttempts,
      ...(value.planningAttempts ?? []),
      ...Object.values(value.results).flat(),
    ].map((attempt) => [attempt.id, attempt]),
  );
  const traceDirectory = path.join(directory, 'requests');
  let files: string[] = [];
  try {
    files = await readdir(traceDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const file of files) {
    if (!/^[a-f\d-]+\.json$/u.test(file)) continue;
    const trace = JSON.parse(
      await readFile(path.join(traceDirectory, file), 'utf8'),
    ) as RequestSummary & { attemptId: string };
    const attempt = attempts.get(trace.attemptId);
    if (!attempt) continue;
    const summary: RequestSummary = {
      id: trace.id,
      startedAt: trace.startedAt,
      durationMs: trace.durationMs,
      status: trace.status,
      usage: trace.usage,
      ...(trace.error ? { error: trace.error } : {}),
    };
    const existing = attempt.requests.findIndex((request) => request.id === trace.id);
    if (existing < 0) attempt.requests.push(summary);
    else attempt.requests[existing] = summary;
  }
  for (const attempt of attempts.values())
    attempt.requests.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return value;
}

export async function pipelineHash(): Promise<string> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(path.join(PROJECT_ROOT, directory), {
      withFileTypes: true,
    })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (/\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)) files.push(relative);
    }
  }
  await visit('packages/core/src');
  await visit('apps/extension/src/provider');
  files.push(
    'apps/extension/src/platform/youtube/captions.ts',
    'scripts/eval/runner.ts',
    'scripts/eval/trace.ts',
    'scripts/eval/io.ts',
    'scripts/eval/types.ts',
    'package-lock.json',
  );
  return hash(
    await Promise.all(
      files
        .sort()
        .map(async (file) => [file, await readFile(path.join(PROJECT_ROOT, file), 'utf8')]),
    ),
  );
}

export async function acquireLock(directory: string): Promise<() => Promise<void>> {
  const lock = path.join(directory, 'run.lock');
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lock, 'utf8')) as { pid: number };
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw new Error(`锁文件无效：${lock}`);
    try {
      process.kill(previous.pid, 0);
      throw new Error(`评测进程 ${previous.pid} 仍在运行，不能同时写入：${directory}`);
    } catch (checkError) {
      if ((checkError as NodeJS.ErrnoException).code !== 'ESRCH') throw checkError;
    }
    await unlink(lock);
    handle = await open(lock, 'wx');
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid }));
  await handle.close();
  return async () => {
    await unlink(lock);
  };
}

export async function copyReportFonts(directory: string): Promise<void> {
  const target = path.join(directory, 'assets');
  await mkdir(target, { recursive: true });
  for (const filename of ['MiSans-Regular.woff2', 'MiSans-Semibold.woff2', 'MiSans-LICENSE.pdf']) {
    await copyFile(
      path.join(PROJECT_ROOT, 'apps/extension/public/fonts', filename),
      path.join(target, filename),
    );
  }
}
