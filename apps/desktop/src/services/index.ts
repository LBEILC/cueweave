import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { ServiceRequest, ServiceResponse } from '../shared/service';
import type { MediaProbe, MediaTrack } from '../shared/bridge';
import type { SubtitleRequest } from '../shared/service';
import { downloadLink, fetchWebsiteSubtitle, inspectLink, LinkError } from './link';
import { ProjectStore, projectErrorMessage, type ProjectServiceRequest } from './projects';
const projects = new ProjectStore();

const parentPort = process.parentPort;
if (!parentPort) throw new Error('CueWeave service requires an Electron parent port');

const generation = Number(process.argv[2]);
const argumentsFromParent = process.argv.slice(3);
if (!Number.isSafeInteger(generation) || argumentsFromParent.some((value) => !value)) {
  throw new Error('CueWeave service arguments are incomplete');
}
const databasePath = argumentsFromParent[0] as string;
const ffmpegPath = argumentsFromParent[1] as string;
const ffprobePath = argumentsFromParent[2] as string;
const ytDlpPath = argumentsFromParent[3] as string;
const denoPath = argumentsFromParent[4] as string;
const downloadsDirectory = argumentsFromParent[5] as string;
const allowPrivateNetwork = argumentsFromParent[6] === 'allow-private-network';
if (!databasePath || !ffmpegPath || !ffprobePath || !ytDlpPath || !denoPath || !downloadsDirectory)
  throw new Error('CueWeave service arguments are incomplete');

const running = new Map<string, ReturnType<typeof spawn>>();
const controllers = new Map<string, AbortController>();

function killTree(child: ReturnType<typeof spawn>): Promise<boolean> {
  if (!child.pid) return Promise.resolve(false);
  if (process.platform !== 'win32') return Promise.resolve(child.kill('SIGKILL'));
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise((resolve) => {
    const killer = spawn(taskkill, ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const fallback = setTimeout(() => resolve(child.kill('SIGKILL')), 500);
    killer.once('error', () => {
      clearTimeout(fallback);
      resolve(child.kill('SIGKILL'));
    });
    killer.once('exit', (code) => {
      clearTimeout(fallback);
      if (code !== 0) child.kill('SIGKILL');
      resolve(true);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string' || value[key].length === 0) {
    throw new Error('Invalid service request');
  }
  return value[key];
}

function optionalCookieFile(value: unknown): string | undefined {
  if (!isRecord(value)) throw new Error('Invalid service request');
  const path = value.cookieFile;
  if (path === undefined) return undefined;
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096 || !isAbsolute(path))
    throw new Error('Invalid service request');
  return path;
}

function runTool(
  id: string,
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    running.set(id, child);
    let output = '';
    let errorOutput = '';
    let settled = false;
    const timer = setTimeout(() => {
      void killTree(child);
      reject(new Error('Media tool timed out'));
    }, timeoutMs);
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (next.length > 2_000_000) {
        void killTree(child);
        throw new Error('Media tool output exceeded the limit');
      }
      return next;
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        output = append(output, chunk);
      } catch (error) {
        reject(error);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      try {
        errorOutput = append(errorOutput, chunk);
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(id);
      if (code === 0) resolve(output);
      else
        reject(
          new Error(
            signal
              ? 'Media tool was cancelled'
              : errorOutput.trim() || `Media tool exited with ${code}`,
          ),
        );
    });
  });
}

function parseProbe(raw: string): MediaProbe {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.streams))
    throw new Error('Invalid ffprobe output');
  const formatRecord = isRecord(parsed.format) ? parsed.format : {};
  const tracks: MediaTrack[] = parsed.streams.filter(isRecord).map((stream) => {
    const codecType = stream.codec_type;
    const type: MediaTrack['type'] =
      codecType === 'video' || codecType === 'audio' || codecType === 'subtitle'
        ? codecType
        : 'other';
    const track: MediaTrack = {
      type,
      codec: typeof stream.codec_name === 'string' ? stream.codec_name : 'unknown',
    };
    if (isRecord(stream.tags) && typeof stream.tags.language === 'string')
      track.language = stream.tags.language;
    if (typeof stream.width === 'number') track.width = stream.width;
    if (typeof stream.height === 'number') track.height = stream.height;
    if (typeof stream.channels === 'number') track.channels = stream.channels;
    const sampleRate = Number(stream.sample_rate);
    if (Number.isFinite(sampleRate) && sampleRate > 0) track.sampleRate = sampleRate;
    if (typeof stream.avg_frame_rate === 'string') track.frameRate = stream.avg_frame_rate;
    if (isRecord(stream.disposition)) track.default = stream.disposition.default === 1;
    const rotationFromTags = isRecord(stream.tags) ? Number(stream.tags.rotate) : Number.NaN;
    const sideData = Array.isArray(stream.side_data_list)
      ? stream.side_data_list.find(isRecord)
      : undefined;
    const rotation = Number.isFinite(rotationFromTags)
      ? rotationFromTags
      : isRecord(sideData)
        ? Number(sideData.rotation)
        : Number.NaN;
    if (Number.isFinite(rotation)) track.rotation = rotation;
    return track;
  });
  const result: MediaProbe = {
    format: typeof formatRecord.format_name === 'string' ? formatRecord.format_name : 'unknown',
    tracks,
  };
  const duration = Number(formatRecord.duration);
  if (Number.isFinite(duration) && duration >= 0) result.durationSeconds = duration;
  const startTime = Number(formatRecord.start_time);
  if (Number.isFinite(startTime)) result.startTimeSeconds = startTime;
  return result;
}

async function storageCheck(): Promise<{ token: string; reopened: boolean }> {
  await mkdir(dirname(databasePath), { recursive: true });
  const token = randomUUID();
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.exec(
    'CREATE TABLE IF NOT EXISTS d0_checks (token TEXT PRIMARY KEY, created_at TEXT NOT NULL)',
  );
  database.transaction(() => {
    database
      .prepare('INSERT INTO d0_checks (token, created_at) VALUES (?, ?)')
      .run(token, new Date().toISOString());
  })();
  database.close();
  const reopened = new Database(databasePath, { readonly: true });
  const row = reopened.prepare('SELECT token FROM d0_checks WHERE token = ?').get(token) as
    { token?: string } | undefined;
  reopened.close();
  return { token, reopened: row?.token === token };
}

async function handle(request: ServiceRequest): Promise<unknown> {
  switch (request.method) {
    case 'project':
      return projects.run(request.payload as ProjectServiceRequest);
    case 'health':
      return { generation, pid: process.pid };
    case 'storageCheck':
      return storageCheck();
    case 'probeMedia': {
      const inputPath = requiredString(request.payload, 'inputPath');
      const output = await runTool(
        request.id,
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
        30_000,
      );
      return parseProbe(output);
    }
    case 'extractAudio': {
      const inputPath = requiredString(request.payload, 'inputPath');
      const outputPath = requiredString(request.payload, 'outputPath');
      await mkdir(dirname(outputPath), { recursive: true });
      try {
        await runTool(
          request.id,
          ffmpegPath,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            inputPath,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            outputPath,
          ],
          120_000,
        );
        return null;
      } catch (error) {
        await rm(outputPath, { force: true });
        throw error;
      }
    }
    case 'inspectLink': {
      const url = requiredString(request.payload, 'url');
      const cookieFile = optionalCookieFile(request.payload);
      return inspectLink(
        request.id,
        url,
        { ytDlpPath, denoPath, ffmpegPath, downloadsDirectory, allowPrivateNetwork },
        (id, child) => {
          if (child) running.set(id, child as ReturnType<typeof spawn>);
          else running.delete(id);
        },
        cookieFile,
      );
    }
    case 'fetchSubtitle': {
      if (!isRecord(request.payload)) throw new Error('Invalid service request');
      const cookieFile = optionalCookieFile(request.payload);
      const subtitle: SubtitleRequest = {
        url: requiredString(request.payload, 'url'),
        language: requiredString(request.payload, 'language'),
        label: requiredString(request.payload, 'label'),
        kind:
          request.payload.kind === 'manual' || request.payload.kind === 'automatic'
            ? request.payload.kind
            : (() => {
                throw new Error('Invalid service request');
              })(),
        ...(cookieFile ? { cookieFile } : {}),
      };
      return fetchWebsiteSubtitle(
        request.id,
        subtitle,
        { ytDlpPath, denoPath, ffmpegPath, downloadsDirectory, allowPrivateNetwork },
        (id, child) => {
          if (child) running.set(id, child as ReturnType<typeof spawn>);
          else running.delete(id);
        },
      );
    }
    case 'downloadLink': {
      const url = requiredString(request.payload, 'url');
      const cookieFile = optionalCookieFile(request.payload);
      const controller = new AbortController();
      controllers.set(request.id, controller);
      try {
        return await downloadLink(
          request.id,
          url,
          { ytDlpPath, denoPath, ffmpegPath, downloadsDirectory, allowPrivateNetwork },
          controller.signal,
          (id, child) => {
            if (child) running.set(id, child as ReturnType<typeof spawn>);
            else running.delete(id);
          },
          (value) =>
            parentPort.postMessage({
              kind: 'event',
              id: request.id,
              generation,
              event: 'downloadProgress',
              value,
            }),
          cookieFile,
        );
      } finally {
        controllers.delete(request.id);
      }
    }
    case 'cancellationCheck': {
      const operation = runTool(
        request.id,
        ffmpegPath,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=880',
          '-t',
          '30',
          '-f',
          'null',
          '-',
        ],
        10_000,
      );
      setTimeout(() => {
        const child = running.get(request.id);
        if (child) void killTree(child);
      }, 250);
      try {
        await operation;
        return { cancelled: false };
      } catch {
        return { cancelled: !running.has(request.id) };
      }
    }
    case 'cancel': {
      const targetId = requiredString(request.payload, 'targetId');
      const controller = controllers.get(targetId);
      controller?.abort();
      const child = running.get(targetId);
      const killed = child ? await killTree(child) : false;
      return { cancelled: Boolean(controller) || killed };
    }
    case 'shutdown':
      for (const controller of controllers.values()) controller.abort();
      await Promise.all([...running.values()].map((child) => killTree(child)));
      return null;
    case 'crashForTest':
      process.exit(71);
  }
}

parentPort.on('message', (event) => {
  const request = event.data as ServiceRequest;
  if (
    !isRecord(request) ||
    request.kind !== 'request' ||
    typeof request.id !== 'string' ||
    request.generation !== generation ||
    typeof request.method !== 'string'
  ) {
    return;
  }
  void handle(request)
    .then((value) => {
      const response: ServiceResponse = {
        kind: 'response',
        id: request.id,
        generation,
        ok: true,
        value,
      };
      parentPort.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: ServiceResponse = {
        kind: 'response',
        id: request.id,
        generation,
        ok: false,
        error:
          request.method === 'project'
            ? projectErrorMessage(error)
            : error instanceof Error
              ? error.message.slice(0, 500)
              : 'Service operation failed',
        ...(request.method === 'project'
          ? { errorCode: 'PROJECT_ERROR' as const }
          : error instanceof LinkError
            ? { errorCode: error.code }
            : {}),
      };
      parentPort.postMessage(response);
    });
});

parentPort.postMessage({ kind: 'ready', generation, pid: process.pid });
