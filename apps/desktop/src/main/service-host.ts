import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ServiceHealth,
  InspectedLink,
  ServiceEvent,
  ServiceMethod,
  ServiceReady,
  ServiceRequest,
  ServiceResponse,
  StorageCheck,
} from '../shared/service';
import type { DesktopErrorCode, LinkImportProgress, MediaProbe } from '../shared/bridge';
import type { DownloadedMedia, SubtitleRequest } from '../shared/service';
import type { ProjectServiceRequest, ProjectServiceReply } from '../services/projects';

interface PendingRequest {
  generation: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  onEvent?: ((value: Omit<LinkImportProgress, 'jobId'>) => void) | undefined;
}

export class ServiceHostError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function developmentToolPath(packageName: string): string {
  const require = createRequire(import.meta.url);
  const value = require(packageName) as unknown;
  if (typeof value !== 'string') throw new Error(`Invalid ${packageName} executable path`);
  return value;
}

export class DesktopServiceHost {
  private process: UtilityProcess | null = null;
  private generation = 0;
  private stopping = false;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly options: {
      servicePath: string;
      databasePath: string;
      packaged: boolean;
      toolsDirectory: string;
      downloadsDirectory: string;
      allowPrivateNetwork?: boolean;
    },
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.ensureReady();
  }

  async health(): Promise<ServiceHealth> {
    return (await this.request('health', {})) as ServiceHealth;
  }

  async storageCheck(): Promise<StorageCheck> {
    return (await this.request('storageCheck', {})) as StorageCheck;
  }
  async project(request: ProjectServiceRequest): Promise<ProjectServiceReply> {
    return (await this.request('project', request, 30 * 60_000)) as ProjectServiceReply;
  }

  async probeMedia(inputPath: string): Promise<MediaProbe> {
    return (await this.request('probeMedia', { inputPath }, 35_000)) as MediaProbe;
  }

  async inspectLink(url: string, cookieFile?: string): Promise<InspectedLink> {
    return (await this.request('inspectLink', { url, cookieFile }, 90_000)) as InspectedLink;
  }

  async fetchSubtitle(request: SubtitleRequest): Promise<{ name: string; content: string }> {
    return (await this.request('fetchSubtitle', request, 90_000)) as {
      name: string;
      content: string;
    };
  }

  async downloadLink(
    url: string,
    onProgress: (value: Omit<LinkImportProgress, 'jobId'>) => void,
    signal?: AbortSignal,
    cookieFile?: string,
  ): Promise<DownloadedMedia> {
    const id = randomUUID();
    const operation = this.request(
      'downloadLink',
      { url, cookieFile },
      30 * 60_000,
      id,
      onProgress,
    );
    const cancel = () => void this.request('cancel', { targetId: id }, 5_000).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      return (await operation) as DownloadedMedia;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  async extractAudio(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    const id = randomUUID();
    const operation = this.request('extractAudio', { inputPath, outputPath }, 125_000, id);
    const cancel = () => void this.request('cancel', { targetId: id }, 5_000).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await operation;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  async cancellationCheck(): Promise<{ cancelled: boolean }> {
    return (await this.request('cancellationCheck', {}, 15_000)) as { cancelled: boolean };
  }

  async crashAndReconnectForTest(): Promise<ServiceHealth> {
    const previous = this.generation;
    void this.request('crashForTest', {}, 5_000).catch(() => {});
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        const current = await this.health();
        if (current.generation > previous) return current;
      } catch {
        // The replacement process has not reached ready yet.
      }
    }
    throw new Error('Desktop service did not reconnect');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.process;
    if (child) await this.request('shutdown', {}, 5_000).catch(() => {});
    this.process = null;
    this.ready = null;
    this.rejectPending(new Error('Desktop service stopped'));
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  private async request(
    method: ServiceMethod,
    payload: unknown,
    timeoutMs = 15_000,
    requestId = randomUUID(),
    onEvent?: (value: Omit<LinkImportProgress, 'jobId'>) => void,
  ): Promise<unknown> {
    await this.ensureReady();
    const child = this.process;
    if (!child) throw new Error('Desktop service is unavailable');
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Desktop service request timed out'));
      }, timeoutMs);
      this.pending.set(requestId, { generation, resolve, reject, timer, onEvent });
      const request: ServiceRequest = {
        kind: 'request',
        id: requestId,
        generation,
        method,
        payload,
      };
      child.postMessage(request);
    });
  }

  private ensureReady(): Promise<void> {
    if (this.process && this.ready) return this.ready;
    if (this.stopping) return Promise.reject(new Error('Desktop service is stopping'));
    this.generation += 1;
    const generation = this.generation;
    const ffmpegPath = this.options.packaged
      ? join(this.options.toolsDirectory, 'ffmpeg.exe')
      : developmentToolPath('ffmpeg-static');
    const ffprobePath = this.options.packaged
      ? join(this.options.toolsDirectory, 'ffprobe.exe')
      : developmentToolPath('@derhuerst/ffprobe-static');
    const ytDlpPath = join(this.options.toolsDirectory, 'yt-dlp.exe');
    const denoPath = join(this.options.toolsDirectory, 'deno.exe');
    const child = utilityProcess.fork(
      this.options.servicePath,
      [
        String(generation),
        this.options.databasePath,
        ffmpegPath,
        ffprobePath,
        ytDlpPath,
        denoPath,
        this.options.downloadsDirectory,
        ...(this.options.allowPrivateNetwork ? ['allow-private-network'] : []),
      ],
      { serviceName: 'CueWeave Background Service', stdio: 'pipe', execArgv: [] },
    );
    this.process = child;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Desktop service did not start'));
      }, 15_000);
      const onMessage = (message: ServiceReady | ServiceResponse | ServiceEvent) => {
        if (message.generation !== generation) return;
        if (message.kind === 'ready') {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.kind === 'response') this.onResponse(message);
        if (message.kind === 'event') this.onEvent(message);
      };
      child.on('message', onMessage);
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (this.process === child) {
          this.process = null;
          this.ready = null;
        }
        this.rejectGeneration(generation, new Error(`Desktop service exited with ${code}`));
        if (!this.stopping) setTimeout(() => void this.ensureReady().catch(() => {}), 100);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (!this.options.packaged)
          process.stderr.write(`[CueWeave service] ${chunk.toString('utf8')}`);
      });
    });
    return this.ready;
  }

  private onResponse(message: ServiceResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending || pending.generation !== message.generation) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else
      pending.reject(
        new ServiceHostError(
          message.errorCode ?? 'UNAVAILABLE',
          message.error ?? 'Desktop service operation failed',
        ),
      );
  }

  private onEvent(message: ServiceEvent): void {
    const pending = this.pending.get(message.id);
    if (!pending || pending.generation !== message.generation) return;
    pending.onEvent?.(message.value);
  }

  private rejectGeneration(generation: number, error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.generation !== generation) continue;
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
