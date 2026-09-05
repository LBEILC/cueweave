import { readFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PlaybackPlan, sourceNeighbors } from '@cueweave/core/provider/playbackPlan';
import {
  createSubtitleJsonRequest,
  translatePlaybackWindow,
} from '@cueweave/core/provider/chatCompletions';
import { readRun, writeJson } from './eval/io';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import { extractTranscriptEvidenceTerms, type DisplayCue } from '@cueweave/core/subtitle';

const { values } = parseArgs({
  options: { from: { type: 'string' }, out: { type: 'string' }, 'token-file': { type: 'string' } },
});
async function main() {
  if (!values.from || !values.out || !values['token-file'])
    throw new Error('需要 --from、--out 和 --token-file。');
  const run = await readRun(values.from);
  const settings: ProviderSettings = {
    baseUrl: 'https://api.gpt.ge/v1',
    model: 'gemini-3.5-flash-lite',
    protocol: 'chat-completions',
    apiKey: (await readFile(values['token-file'], 'utf8')).trim(),
  };
  await mkdir(values.out); // Do not overwrite an earlier smoke run.
  const plan = new PlaybackPlan(run.tokens);
  let calls = 0;
  const runtime = {
    assertPermission: async () => {},
    fetch: (async (...args: Parameters<typeof fetch>) => {
      if (++calls > 16) throw new Error('Smoke request budget exhausted');
      return fetch(...args);
    }) as typeof fetch,
  };
  const results: Array<{
    index: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    cues: DisplayCue[];
  }> = [];
  for (const index of [0, 4, 5, 53]) {
    const start = performance.now();
    const window = await plan.prepare(
      index,
      createSubtitleJsonRequest(settings, undefined, undefined, runtime),
      undefined,
      undefined,
      (message) => console.info(message),
    );
    const cues = await translatePlaybackWindow(
      settings,
      window.tokens,
      undefined,
      undefined,
      {
        ...run.identity.context,
        entityAliases: run.aliases ?? [],
        transcriptEvidence: extractTranscriptEvidenceTerms(run.tokens),
        previousCues:
          results
            .at(-1)
            ?.cues.slice(-6)
            .map((c) => ({ sourceText: c.sourceText, translation: c.translation })) ?? [],
      },
      sourceNeighbors(run.tokens, window.tokens),
      runtime,
    );
    if (
      JSON.stringify(cues.flatMap((c) => c.sourceTokenIds)) !==
      JSON.stringify(window.tokens.map((t) => t.id))
    )
      throw new Error('Coverage mismatch');
    results.push({
      index,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: Math.round(performance.now() - start),
      cues,
    });
    await writeJson(`${values.out}/result.json`, {
      model: settings.model,
      calls,
      snapshot: plan.snapshot(),
      results,
    });
    console.info(
      JSON.stringify({
        index,
        startMs: window.startMs,
        endMs: window.endMs,
        cueCount: cues.length,
        calls,
      }),
    );
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Playback smoke failed');
  process.exitCode = 1;
});
