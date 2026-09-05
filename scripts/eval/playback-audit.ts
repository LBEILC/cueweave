export interface WindowTiming {
  id: string;
  startMs: number;
  endMs: number;
  readyAtMs: number | null;
  complete: boolean;
}

export function auditPlaybackTiming(windows: readonly WindowTiming[]) {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0];
  const startupMs = first?.complete ? first.readyAtMs : null;
  const missing = sorted.filter((w) => !w.complete || w.readyAtMs === null).map((w) => w.id);
  if (startupMs === null || startupMs === undefined || !first)
    return { startupMs: null, unavailable: missing, late: [], minimumLeadMs: null };
  const checks = sorted
    .slice(1)
    .filter((w) => w.complete && w.readyAtMs !== null)
    .map((w) => ({ id: w.id, leadMs: startupMs + w.startMs - first.startMs - w.readyAtMs! }));
  return {
    startupMs,
    unavailable: missing,
    late: checks.filter((w) => w.leadMs < 0),
    minimumLeadMs: checks.length ? Math.min(...checks.map((w) => w.leadMs)) : null,
  };
}

export function maximumRequestConcurrency(
  requests: readonly { startedAt: string; durationMs: number }[],
) {
  const events = requests
    .filter((r) => r.durationMs > 0)
    .flatMap((r) => {
      const start = Date.parse(r.startedAt);
      if (!Number.isFinite(start) || !Number.isFinite(r.durationMs))
        throw new Error('请求耗时记录无效。');
      return [
        { time: start, delta: 1 },
        { time: start + r.durationMs, delta: -1 },
      ];
    })
    .sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0,
    maximum = 0;
  for (const e of events) {
    current += e.delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}
