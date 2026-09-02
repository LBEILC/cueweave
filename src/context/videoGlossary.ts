import type { TranslationTerm } from '../domain/subtitle';

const VIDEO_GLOSSARIES_KEY = 'cueweave.video-glossaries-v3';
const MAX_VIDEOS = 80;
const MAX_TERMS_PER_VIDEO = 80;

interface StoredVideoGlossary {
  terms: TranslationTerm[];
  manualTerms: TranslationTerm[];
  updatedAt: number;
}

export interface VideoGlossaryState {
  terms: TranslationTerm[];
  manualTerms: TranslationTerm[];
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
      const manualTerms = Array.isArray(record.manualTerms)
        ? record.manualTerms
            .flatMap((term) => sanitizeTerm(term) ?? [])
            .slice(0, MAX_TERMS_PER_VIDEO)
        : [];
      const updatedAt =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : 0;
      return terms.length > 0 || manualTerms.length > 0
        ? [[videoId, { terms, manualTerms, updatedAt }]]
        : [];
    }),
  );
}

async function readGlossaries(): Promise<StoredVideoGlossaries> {
  const stored = await browser.storage.local.get([VIDEO_GLOSSARIES_KEY]);
  return parseGlossaries(stored[VIDEO_GLOSSARIES_KEY]);
}

export async function readVideoGlossary(videoId: string): Promise<TranslationTerm[]> {
  const state = await readVideoGlossaryState(videoId);
  const termsBySource = new Map(state.terms.map((term) => [term.source.toLocaleLowerCase(), term]));
  for (const term of state.manualTerms) {
    termsBySource.set(term.source.toLocaleLowerCase(), term);
  }
  return [...termsBySource.values()];
}

export async function readVideoGlossaryState(videoId: string): Promise<VideoGlossaryState> {
  if (!videoId) return { terms: [], manualTerms: [] };
  const glossary = (await readGlossaries())[videoId];
  return glossary
    ? { terms: glossary.terms, manualTerms: glossary.manualTerms }
    : { terms: [], manualTerms: [] };
}

export function mergeVideoGlossary(
  videoId: string,
  incomingTerms: readonly TranslationTerm[],
): Promise<void> {
  if (!videoId || incomingTerms.length === 0) return Promise.resolve();
  const operation = writeChain.then(async () => {
    const glossaries = await readGlossaries();
    const manualSources = new Set(
      (glossaries[videoId]?.manualTerms ?? []).map((term) => term.source.toLocaleLowerCase()),
    );
    const termsBySource = new Map(
      (glossaries[videoId]?.terms ?? []).map((term) => [term.source.toLocaleLowerCase(), term]),
    );
    for (const candidate of incomingTerms) {
      const term = sanitizeTerm(candidate);
      if (term && !manualSources.has(term.source.toLocaleLowerCase())) {
        termsBySource.set(term.source.toLocaleLowerCase(), term);
      }
    }
    glossaries[videoId] = {
      terms: [...termsBySource.values()].slice(-MAX_TERMS_PER_VIDEO),
      manualTerms: glossaries[videoId]?.manualTerms ?? [],
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

export function upsertManualVideoGlossaryTerm(
  videoId: string,
  candidate: TranslationTerm,
): Promise<void> {
  const term = sanitizeTerm(candidate);
  if (!videoId || !term) return Promise.reject(new Error('术语内容无效。'));
  const operation = writeChain.then(async () => {
    const glossaries = await readGlossaries();
    const sourceKey = term.source.toLocaleLowerCase();
    const manualTerms = new Map(
      (glossaries[videoId]?.manualTerms ?? []).map((item) => [
        item.source.toLocaleLowerCase(),
        item,
      ]),
    );
    manualTerms.set(sourceKey, term);
    glossaries[videoId] = {
      terms: (glossaries[videoId]?.terms ?? []).filter(
        (item) => item.source.toLocaleLowerCase() !== sourceKey,
      ),
      manualTerms: [...manualTerms.values()].slice(-MAX_TERMS_PER_VIDEO),
      updatedAt: Date.now(),
    };
    await retainAndWriteGlossaries(glossaries);
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}

export function deleteManualVideoGlossaryTerm(videoId: string, source: string): Promise<void> {
  const sourceKey = source.trim().toLocaleLowerCase();
  if (!videoId || !sourceKey) return Promise.reject(new Error('术语内容无效。'));
  const operation = writeChain.then(async () => {
    const glossaries = await readGlossaries();
    const glossary = glossaries[videoId];
    if (!glossary) return;
    glossary.manualTerms = glossary.manualTerms.filter(
      (term) => term.source.toLocaleLowerCase() !== sourceKey,
    );
    glossary.updatedAt = Date.now();
    if (glossary.terms.length === 0 && glossary.manualTerms.length === 0) {
      delete glossaries[videoId];
    }
    await retainAndWriteGlossaries(glossaries);
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}

async function retainAndWriteGlossaries(glossaries: StoredVideoGlossaries): Promise<void> {
  const retained = Object.fromEntries(
    Object.entries(glossaries)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_VIDEOS),
  );
  await browser.storage.local.set({ [VIDEO_GLOSSARIES_KEY]: retained });
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
