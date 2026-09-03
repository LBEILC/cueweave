import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProviderRuntime } from '../../src/provider/runtime';
import type { Attempt, RequestSummary } from './types';
import { writeJson } from './io';

export interface RequestBudget {
  used: number;
  limit: number;
  exhausted: boolean;
}

export function responseUsage(payload: unknown): RequestSummary['usage'] {
  if (!payload || typeof payload !== 'object' || !('usage' in payload)) return null;
  const usage = payload.usage as Record<string, unknown> | null;
  if (!usage || typeof usage !== 'object') return null;
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (
    typeof input !== 'number' ||
    typeof output !== 'number' ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  )
    return null;
  return {
    input,
    output,
    total:
      typeof usage.total_tokens === 'number' &&
      Number.isFinite(usage.total_tokens) &&
      usage.total_tokens >= 0
        ? usage.total_tokens
        : input + output,
  };
}

export function createRuntime(
  directory: string,
  attempt: Attempt,
  scope: string,
  secret: string,
  budget: RequestBudget,
  fetcher: typeof fetch = fetch,
): ProviderRuntime {
  return {
    assertPermission: async () => undefined,
    onDiagnostic: (event) => attempt.diagnostics.push(event),
    fetch: async (input, init) => {
      if (budget.used >= budget.limit) {
        budget.exhausted = true;
        throw new Error('已达到本次运行的请求上限；可使用 --resume 继续。');
      }
      budget.used += 1;
      const summary: RequestSummary = {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: null,
        usage: null,
      };
      attempt.requests.push(summary);
      const record = {
        ...summary,
        scope,
        attemptId: attempt.id,
        endpoint: String(input),
        request: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        response: null as unknown,
      };
      const tracePath = path.join(directory, 'requests', `${summary.id}.json`);
      const started = performance.now();
      await writeJson(tracePath, record, secret);
      try {
        const response = await fetcher(input, init);
        summary.status = response.status;
        const text = await response.clone().text();
        try {
          record.response = JSON.parse(text);
        } catch {
          record.response = text;
        }
        summary.usage = responseUsage(record.response);
        return response;
      } catch (error) {
        summary.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        summary.durationMs = Math.round(performance.now() - started);
        await writeJson(tracePath, { ...record, ...summary }, secret);
      }
    },
  };
}
