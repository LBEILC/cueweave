import type { ProviderRuntime } from '@cueweave/core/provider/runtime';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import {
  DEBUG_POLICY,
  DEBUG_STORAGE_KEY,
  isDebugRecord,
  type DebugScope,
  type DebugState,
  type DebugRecord,
} from './types';
import { debugError, redactDebug, redactUrl, providerSecrets } from './redact';
import { DEBUG_BUILD_ID } from './build';

interface DebugStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<unknown>;
}

export interface DebugCapture {
  runtime: ProviderRuntime;
  record(kind: string, data: unknown): Promise<void>;
}

const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const emptyState = (): DebugState => ({
  enabled: false,
  enabledAt: null,
  generation: crypto.randomUUID(),
  records: [],
  evictedRecords: 0,
});

async function responseBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DEBUG_POLICY.maxResponseBytes) {
        void reader.cancel().catch(() => {});
        return { omitted: 'response-size-limit', limitBytes: DEBUG_POLICY.maxResponseBytes };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Background-only single writer. Failed diagnostic writes never fail a translation. */
export class DebugRecorder {
  private state: DebugState | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  lastError: string | null = null;
  constructor(
    private storage: DebugStorage,
    private now: () => number = Date.now,
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.tail.catch(() => {}).then(operation);
    this.tail = work;
    return work;
  }

  private async load(): Promise<DebugState> {
    if (this.state) return this.state;
    const stored = (await this.storage.get([DEBUG_STORAGE_KEY]))[DEBUG_STORAGE_KEY] as
      Partial<DebugState> | undefined;
    this.state =
      stored?.enabled === true && typeof stored.generation === 'string'
        ? {
            enabled: true,
            generation: stored.generation,
            enabledAt: typeof stored.enabledAt === 'number' ? stored.enabledAt : null,
            records: Array.isArray(stored.records) ? stored.records.filter(isDebugRecord) : [],
            evictedRecords: typeof stored.evictedRecords === 'number' ? stored.evictedRecords : 0,
          }
        : emptyState();
    return this.state;
  }

  private bounded(state: DebugState): DebugState {
    const records = state.records.filter((r) => r.updatedAt >= this.now() - DEBUG_POLICY.maxAgeMs);
    let removed = state.records.length - records.length;
    while (
      records.length > DEBUG_POLICY.maxRecords ||
      byteSize({ ...state, records }) > DEBUG_POLICY.maxBytes
    ) {
      if (!records.length) break;
      records.shift();
      removed++;
    }
    return { ...state, records, evictedRecords: state.evictedRecords + removed };
  }

  private async commit(state: DebugState): Promise<void> {
    await this.storage.set({ [DEBUG_STORAGE_KEY]: state });
    this.state = state;
  }

  async read(): Promise<DebugState> {
    return this.serial(async () => {
      const state = await this.load();
      const next = this.bounded(state);
      if (next.records.length !== state.records.length) await this.commit(next);
      return structuredClone(next);
    });
  }

  async setEnabled(enabled: boolean): Promise<DebugState> {
    return this.serial(async () => {
      const state = await this.load();
      if (state.enabled === enabled) return structuredClone(state);
      const next = { ...emptyState(), enabled, enabledAt: enabled ? this.now() : null };
      await this.commit(next);
      this.lastError = null;
      return structuredClone(next);
    });
  }

  private async save(record: DebugRecord, generation: string): Promise<void> {
    try {
      await this.serial(async () => {
        const state = await this.load();
        if (!state.enabled || state.generation !== generation) return;
        const boundedRecord =
          byteSize(record) <= DEBUG_POLICY.maxRecordBytes
            ? record
            : {
                ...record,
                data: { omitted: 'record-size-limit', limitBytes: DEBUG_POLICY.maxRecordBytes },
              };
        const records = state.records.filter((r) => r.id !== record.id);
        records.push(boundedRecord);
        await this.commit(this.bounded({ ...state, records }));
      });
    } catch {
      this.lastError = '部分调试日志未能写入本地存储。';
    }
  }

  async capture(scope: DebugScope, settings?: ProviderSettings): Promise<DebugCapture> {
    const state = await this.read().catch(() => null);
    if (!state?.enabled) return { runtime: {}, record: async () => {} };
    const generation = state.generation;
    const secrets = settings ? providerSecrets(settings.apiKey, settings.baseUrl) : [];
    const safeScope = redactDebug(scope, secrets) as DebugScope;
    const operationId = crypto.randomUUID();
    let stage = scope.operation ?? 'translation';
    const record = async (kind: string, data: unknown) => {
      const time = this.now();
      await this.save(
        {
          id: crypto.randomUUID(),
          buildId: DEBUG_BUILD_ID,
          time,
          updatedAt: time,
          scope: safeScope,
          kind,
          data: redactDebug({ operationId, stage, detail: data }, secrets),
        },
        generation,
      );
    };
    return {
      record,
      runtime: {
        onDiagnostic: (event) => {
          if (event.kind === 'stage') stage = event.message;
          void record('diagnostic', event);
        },
        fetch: async (input, init) => {
          const id = crypto.randomUUID();
          const time = this.now();
          const endpoint =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const protocol = new URL(endpoint).pathname.endsWith('/responses')
            ? 'responses'
            : 'chat-completions';
          let request: unknown = init?.body ?? null;
          if (typeof request === 'string') {
            try {
              request = JSON.parse(request);
            } catch {
              /* Keep non-JSON failures inspectable. */
            }
          }
          const data = redactDebug(
            {
              operationId,
              stage,
              endpoint: redactUrl(endpoint),
              protocol,
              model: settings?.model,
              request,
              status: null,
              response: null,
              state: 'pending',
            },
            secrets,
          ) as Record<string, unknown>;
          const write = (extra: object) =>
            this.save(
              {
                id,
                buildId: DEBUG_BUILD_ID,
                time,
                updatedAt: this.now(),
                scope: safeScope,
                kind: 'request',
                data: { ...data, ...(redactDebug(extra, secrets) as object) },
              },
              generation,
            );
          await write({});
          const started = performance.now();
          try {
            const response = await fetch(input, init);
            let body: unknown;
            try {
              body = await responseBody(response.clone());
            } catch (error) {
              body = { unavailable: true, error: debugError(error) };
            }
            await write({
              status: response.status,
              response: body,
              state: 'completed',
              durationMs: Math.round(performance.now() - started),
            });
            return response;
          } catch (error) {
            await write({
              state: 'failed',
              durationMs: Math.round(performance.now() - started),
              error: debugError(error),
            });
            throw error;
          }
        },
      },
    };
  }
}
