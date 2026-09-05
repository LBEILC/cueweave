import type { DisplayCue } from '@cueweave/core/subtitle';
import { currentAttempt, successfulCues } from './types';
import type { EvalRun } from './types';

export function cueWarnings(cue: DisplayCue): string[] {
  const warnings: string[] = [];
  const length = Array.from(cue.translation.replace(/\s/gu, '')).length;
  const seconds = (cue.endMs - cue.startMs) / 1000;
  if (length > 30) warnings.push(`译文较长 ${length} 字符`);
  if (seconds > 0 && length / seconds > 11)
    warnings.push(`阅读速度 ${(length / seconds).toFixed(1)} 字符/秒`);
  if (seconds < 0.8) warnings.push('展示时长不足 0.8 秒');
  const decimals = cue.sourceText.match(/\d+\.\d+(?:\.\d+)*/gu) ?? [];
  if (decimals.some((number) => !cue.translation.includes(number)))
    warnings.push('数字含点写法变化 待核对');
  return warnings;
}

export function summarize(run: EvalRun) {
  const cues = successfulCues(run);
  const attempts = [
    ...run.entityAttempts,
    ...(run.planningAttempts ?? []),
    ...Object.values(run.results).flat(),
  ];
  const requests = attempts.flatMap((attempt) => attempt.requests);
  const expected = new Set(run.windows.flatMap((window) => window.tokens.map((token) => token.id)));
  const counts = new Map<string, number>();
  for (const cue of cues)
    for (const id of cue.sourceTokenIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const latest = run.windows.map((window) => currentAttempt(run, window.id));
  const knownUsage = requests.flatMap((request) => (request.usage ? [request.usage] : []));
  const caseChecks = run.cases.map((item) => {
    const relevant = run.tokens.filter(
      (token) => token.endMs > item.startMs && token.startMs < item.endMs,
    );
    const covered =
      relevant.length > 0 && relevant.every((token) => (counts.get(token.id) ?? 0) > 0);
    const text = cues
      .filter((cue) => cue.endMs > item.startMs && cue.startMs < item.endMs)
      .map((cue) => cue.translation)
      .join(' ');
    const missing = (item.required ?? []).filter((word) => !text.includes(word));
    const forbidden = (item.forbidden ?? []).filter((word) => text.includes(word));
    return {
      ...item,
      status: !covered
        ? '未完整覆盖'
        : missing.length || forbidden.length
          ? '词面检查有差异'
          : '待人工评审',
      missingRequired: missing,
      matchedForbidden: forbidden,
    };
  });
  return {
    status: run.status,
    windows: run.windows.length,
    successfulWindows: latest.filter((attempt) => attempt?.status === 'success').length,
    failedWindows: latest.filter((attempt) => attempt?.status === 'failed').length,
    partialWindows: latest.filter((attempt) => attempt?.status === 'partial').length,
    pendingWindows: latest.filter(
      (attempt) => !attempt || ['running', 'interrupted'].includes(attempt.status),
    ).length,
    firstPassWindows: run.windows.filter((window) => {
      const first = run.results[window.id]?.[0];
      return (
        first?.status === 'success' && first.requests.length === 1 && first.diagnostics.length === 0
      );
    }).length,
    cues: cues.length,
    expectedTokens: expected.size,
    missingTokens: [...expected].filter((id) => !counts.has(id)).length,
    duplicatedTokens: [...counts].filter(([, count]) => count > 1).length,
    unexpectedTokens: [...counts.keys()].filter((id) => !expected.has(id)).length,
    softWarningCues: cues.filter((cue) => cueWarnings(cue).length > 0).length,
    validationErrors: attempts
      .flatMap((attempt) => attempt.diagnostics)
      .filter((event) => event.kind === 'validation-error').length,
    fallbackEvents: attempts
      .flatMap((attempt) => attempt.diagnostics)
      .filter((event) => event.kind === 'fallback').length,
    entityFailures: run.entityAttempts.filter((attempt) => attempt.status === 'failed').length,
    requestCount: requests.length,
    requestDurationMs: requests.reduce((sum, request) => sum + request.durationMs, 0),
    usageReportedRequests: knownUsage.length,
    usageMissingRequests: requests.length - knownUsage.length,
    reportedUsage: knownUsage.length
      ? knownUsage.reduce(
          (sum, usage) => ({
            input: sum.input + usage.input,
            output: sum.output + usage.output,
            total: sum.total + usage.total,
          }),
          { input: 0, output: 0, total: 0 },
        )
      : null,
    caseChecks,
  };
}

export interface AlignedGroup {
  id: string;
  startMs: number;
  endMs: number;
  source: string;
  left: DisplayCue[];
  right: DisplayCue[];
  leftMissing: boolean;
  rightMissing: boolean;
  different: boolean;
}

export function alignRuns(left: EvalRun, right?: EvalRun): AlignedGroup[] {
  if (
    right &&
    (left.identity.inputHash !== right.identity.inputHash ||
      JSON.stringify(left.tokens) !== JSON.stringify(right.tokens))
  )
    throw new Error('无法对齐：两个运行必须使用同一份原始字幕和相同词元。');
  const index = new Map(left.tokens.map((token, position) => [token.id, position]));
  const leftCues = successfulCues(left);
  const rightCues = right ? successfulCues(right) : [];
  const intervals: Array<{ start: number; end: number }> = [];
  for (const cue of [...leftCues, ...rightCues]) {
    const positions = cue.sourceTokenIds
      .map((id) => index.get(id))
      .filter((id): id is number => id !== undefined);
    if (positions.length)
      intervals.push({ start: Math.min(...positions), end: Math.max(...positions) });
  }
  // A missing window occupies its source span so failed/pending output stays visible.
  for (const run of [left, ...(right ? [right] : [])]) {
    for (const window of run.windows) {
      if (currentAttempt(run, window.id)?.status === 'success') continue;
      const positions = window.tokens
        .map((token) => index.get(token.id))
        .filter((id): id is number => id !== undefined);
      if (positions.length)
        intervals.push({ start: Math.min(...positions), end: Math.max(...positions) });
    }
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof intervals = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map(({ start, end }) => {
    const tokens = left.tokens.slice(start, end + 1);
    const ids = new Set(tokens.map((token) => token.id));
    const a = leftCues.filter((cue) => cue.sourceTokenIds.some((id) => ids.has(id)));
    const b = rightCues.filter((cue) => cue.sourceTokenIds.some((id) => ids.has(id)));
    const covered = (cues: DisplayCue[]) => {
      const outputIds = new Set(cues.flatMap((cue) => cue.sourceTokenIds));
      return tokens.every((token) => outputIds.has(token.id));
    };
    const comparable = (cues: DisplayCue[]) =>
      cues.map((cue) => [
        cue.sourceTokenIds,
        cue.sourceText,
        cue.translation,
        cue.startMs,
        cue.endMs,
      ]);
    return {
      id: `span-${start}-${end}`,
      startMs: tokens[0]!.startMs,
      endMs: tokens.at(-1)!.endMs,
      source: tokens.map((token) => token.text).join(' '),
      left: a,
      right: b,
      leftMissing: !covered(a),
      rightMissing: !!right && !covered(b),
      different: !!right && JSON.stringify(comparable(a)) !== JSON.stringify(comparable(b)),
    };
  });
}
