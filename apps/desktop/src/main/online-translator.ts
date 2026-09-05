import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import { CUE_TRANSLATION_VERSION } from '@cueweave/core/provider/cueTypes';
import {
  validTranslationText,
  type TranslationCue,
  type TargetLanguage,
} from '@cueweave/core/provider/cueTranslation';
import { translateCueWindow, translationError } from '../services/cue-translation';
import type { OnlineTranslationSnapshot } from '../shared/online-translation';

const CACHE_VERSION = `online-${CUE_TRANSLATION_VERSION}-rollup-v1`;
type Translate = typeof translateCueWindow;
interface Session {
  sourceId: string;
  source: TranslationCue[];
  positionMs: number;
  snapshot: OnlineTranslationSnapshot;
  controller: AbortController;
  request?: { controller: AbortController; start: number; end: number };
  provider: ProviderSettings;
  path: string;
  busy: boolean;
}

/** Playback scheduling and disk cache belong to the desktop host. No prompts live here. */
export class OnlineTranslator {
  private session: Session | undefined;
  private writes: Promise<void> = Promise.resolve();
  constructor(
    private directory: string,
    private translate: Translate = translateCueWindow,
  ) {}

  async start(
    sourceId: string,
    source: TranslationCue[],
    provider: ProviderSettings,
    language: TargetLanguage,
    positionMs: number,
  ) {
    this.dispose();
    const identity = createHash('sha256')
      .update(
        JSON.stringify({
          version: CACHE_VERSION,
          source,
          language,
          provider: {
            baseUrl: provider.baseUrl,
            model: provider.model,
            protocol: provider.protocol,
          },
        }),
      )
      .digest('hex');
    const session: Session = {
      sourceId,
      source,
      positionMs,
      provider,
      path: join(this.directory, `${identity}.json`),
      snapshot: {
        sourceId,
        state: 'idle',
        targetLanguage: language,
        completed: 0,
        total: source.length,
        translations: {},
        error: '',
      },
      controller: new AbortController(),
      busy: false,
    };
    this.session = session;
    try {
      await this.writes;
      const size = (await stat(session.path)).size;
      if (size > 8 * 1024 * 1024) throw new Error('oversized');
      const cached: unknown = JSON.parse(await readFile(session.path, 'utf8'));
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
        for (const cue of source) {
          const text = (cached as Record<string, unknown>)[cue.id];
          if (validTranslationText(text)) session.snapshot.translations[cue.id] = text;
        }
      }
    } catch {
      /* A missing or invalid cache is a miss, never a source of truth. */
    }
    if (this.session !== session || session.controller.signal.aborted) return this.copy(session);
    session.snapshot.completed = Object.keys(session.snapshot.translations).length;
    void this.pump(session);
    return this.copy(session);
  }

  tick(sourceId: string, positionMs: number) {
    const s = this.session;
    if (!s || s.sourceId !== sourceId) throw new Error('字幕会话已变化，请重新开启翻译。');
    s.positionMs = positionMs;
    // A seek outside the working interval gives the new position priority immediately.
    if (s.request && (positionMs > s.request.end + 5000 || positionMs + 90000 < s.request.start))
      s.request.controller.abort();
    if (!s.controller.signal.aborted && s.snapshot.state !== 'failed') void this.pump(s);
    return this.copy(s);
  }

  stop(sourceId: string) {
    const s = this.session;
    if (!s || s.sourceId !== sourceId) throw new Error('字幕会话已变化，请重新开启翻译。');
    s.controller.abort();
    s.request?.controller.abort();
    s.snapshot.state = 'paused';
    return this.copy(s);
  }
  dispose() {
    this.session?.controller.abort();
    this.session?.request?.controller.abort();
    this.session = undefined;
  }
  private copy(s: Session): OnlineTranslationSnapshot {
    return { ...s.snapshot, translations: { ...s.snapshot.translations } };
  }
  private async save(s: Session) {
    const content = JSON.stringify(s.snapshot.translations);
    if (Buffer.byteLength(content) > 8 * 1024 * 1024)
      throw new Error('字幕缓存超过容量限制，已停止翻译。此前保存的结果仍可复用。');
    const operation = this.writes.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = `${s.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, s.path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      // Bounded cache: only owned hash-named files; never follow a supplied path.
      const files = await readdir(this.directory);
      const entries = await Promise.all(
        files
          .filter((f) => /^[a-f\d]{64}\.json$/.test(f))
          .map(async (name) => ({ name, time: (await stat(join(this.directory, name))).mtimeMs })),
      );
      for (const entry of entries.sort((a, b) => b.time - a.time).slice(20))
        await unlink(join(this.directory, entry.name));
    });
    this.writes = operation.catch(() => {});
    await operation;
  }
  private async pump(s: Session): Promise<void> {
    if (
      s.busy ||
      s.controller.signal.aborted ||
      this.session !== s ||
      s.snapshot.state === 'failed'
    )
      return;
    const first = s.source.findIndex(
      (cue) => cue.endMs > s.positionMs && !s.snapshot.translations[cue.id],
    );
    if (first < 0 || s.source[first]!.startMs > s.positionMs + 90000) {
      s.snapshot.state = 'ready';
      return;
    }
    const window: TranslationCue[] = [];
    let chars = 0;
    for (const cue of s.source.slice(first, first + 8)) {
      if (
        cue.startMs > s.positionMs + 90000 ||
        (window.length &&
          (chars + cue.text.length > 4000 || cue.startMs - window[0]!.startMs > 30000))
      )
        break;
      if (s.snapshot.translations[cue.id]) break;
      chars += cue.text.length;
      window.push(cue);
    }
    if (!window.length) return;
    s.busy = true;
    s.snapshot.state = 'translating';
    const request = {
      controller: new AbortController(),
      start: window[0]!.startMs,
      end: window.at(-1)!.endMs,
    };
    s.request = request;
    const signal = AbortSignal.any([s.controller.signal, request.controller.signal]);
    try {
      const result = await this.translate(
        s.provider,
        s.source,
        window,
        s.snapshot.targetLanguage,
        signal,
      );
      if (signal.aborted || this.session !== s) return;
      for (const cue of result) s.snapshot.translations[cue.id] = cue.translation;
      s.snapshot.completed = Object.keys(s.snapshot.translations).length;
      await this.save(s);
    } catch (error) {
      if (!signal.aborted && this.session === s) {
        s.snapshot.state = 'failed';
        s.snapshot.error = translationError(error);
      }
    } finally {
      s.busy = false;
      delete s.request;
      if (!s.controller.signal.aborted && this.session === s && s.snapshot.state !== 'failed')
        void this.pump(s);
    }
  }
}
