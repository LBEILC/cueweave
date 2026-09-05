import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import type {
  DisplayCue,
  SourceToken,
  TokenWindow,
  TranslationTerm,
} from '@cueweave/core/subtitle';
import type { ProviderDiagnostic } from '@cueweave/core/provider/runtime';
import type { ProviderProtocol } from '@cueweave/core/provider/types';

export interface RequestSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  status: number | null;
  usage: { input: number; output: number; total: number } | null;
  error?: string;
}

export interface Attempt {
  id: string;
  contextHash: string;
  status: 'running' | 'success' | 'partial' | 'failed' | 'interrupted';
  startedAt: string;
  durationMs: number;
  stages: string[];
  diagnostics: ProviderDiagnostic[];
  requests: RequestSummary[];
  cues: DisplayCue[];
  error?: string;
}

export interface EvalCase {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  required?: string[];
  forbidden?: string[];
  review: string;
}

export interface EvalIdentity {
  inputHash: string;
  pipelineHash: string;
  model: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  mode: 'pipeline' | 'translation';
  context: AiSubtitleContext;
  windowIds: string[];
  promptVersion: string;
  segmentationVersion: string;
  entityVersion: string;
}

export interface EvalRun {
  schema: 1;
  id: string;
  name: string;
  videoId: string;
  languageCode: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'paused' | 'completed' | 'completed-with-errors';
  fingerprint: string;
  identity: EvalIdentity;
  gitRevision: string;
  tokens: SourceToken[];
  windows: TokenWindow[];
  entityAttempts: Attempt[];
  planningAttempts?: Attempt[];
  aliases: TranslationTerm[] | null;
  results: Record<string, Attempt[]>;
  cases: EvalCase[];
}

export function currentAttempt(run: EvalRun, windowId: string): Attempt | undefined {
  return run.results[windowId]?.at(-1);
}

export function successfulCues(run: EvalRun): DisplayCue[] {
  return run.windows.flatMap((window) => {
    const attempt = currentAttempt(run, window.id);
    return attempt?.status === 'success' || attempt?.status === 'partial' ? attempt.cues : [];
  });
}
