import type { TranslationTerm } from '../domain/subtitle';

const VIDEO_GLOSSARIES_KEY = 'cueweave.video-glossaries';
const MAX_VIDEOS = 80;
const MAX_TERMS_PER_VIDEO = 80;

interface StoredVideoGlossary {
  terms: TranslationTerm[];
  updatedAt: number;
}

type StoredVideoGlossaries = Record<string, StoredVideoGlossary>;

let writeChain: Promise<void> = Promise.resolve();

function sanitizeTerm(value: unknown): TranslationTerm | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.source !== 'string' || typeof record.translation !== 'string') return undefined;
  const source = record.source.trim().replace(/\s+/gu, ' ').slice(0, 96);
  const translation = record.translation.trim().replace(/\s+/gu, ' ').slice(0, 96);
  return source && translation ? { source, translation } : undefined;
}

function parseGlossaries(value: unknown): StoredVideoGlossaries {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([videoId, candidate]) => {
      if (typeof candidate !== 'object' || candidate === null || !videoId) return [];
      const record = candidate as Record<string, unknown>;
      const terms = Array.isArray(record.terms)
        ? record.terms.flatMap((term) => sanitizeTerm(term) ?? []).slice(0, MAX_TERMS_PER_VIDEO)
        : [];
      const updatedAt =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : 0;
      return terms.length > 0 ? [[videoId, { terms, updatedAt }]] : [];
    }),
  );
}

async function readGlossaries(): Promise<StoredVideoGlossaries> {
  const stored = await browser.storage.local.get([VIDEO_GLOSSARIES_KEY]);
  return parseGlossaries(stored[VIDEO_GLOSSARIES_KEY]);
}

export async function readVideoGlossary(videoId: string): Promise<TranslationTerm[]> {
  if (!videoId) return [];
  return (await readGlossaries())[videoId]?.terms ?? [];
}

export function mergeVideoGlossary(
  videoId: string,
  incomingTerms: readonly TranslationTerm[],
): Promise<void> {
  if (!videoId || incomingTerms.length === 0) return Promise.resolve();
  const operation = writeChain.then(async () => {
    const glossaries = await readGlossaries();
    const termsBySource = new Map(
      (glossaries[videoId]?.terms ?? []).map((term) => [term.source.toLocaleLowerCase(), term]),
    );
    for (const candidate of incomingTerms) {
      const term = sanitizeTerm(candidate);
      if (term) termsBySource.set(term.source.toLocaleLowerCase(), term);
    }
    glossaries[videoId] = {
      terms: [...termsBySource.values()].slice(-MAX_TERMS_PER_VIDEO),
      updatedAt: Date.now(),
    };

    const retained = Object.fromEntries(
      Object.entries(glossaries)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_VIDEOS),
    );
    await browser.storage.local.set({ [VIDEO_GLOSSARIES_KEY]: retained });
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}

export function clearVideoGlossary(videoId?: string): Promise<void> {
  const operation = writeChain.then(async () => {
    if (!videoId) {
      await browser.storage.local.remove(VIDEO_GLOSSARIES_KEY);
      return;
    }
    const glossaries = await readGlossaries();
    delete glossaries[videoId];
    await browser.storage.local.set({ [VIDEO_GLOSSARIES_KEY]: glossaries });
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}
