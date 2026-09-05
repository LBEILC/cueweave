import type { TranslationTerm } from '@cueweave/core/subtitle';

const VIDEO_ENTITY_ALIASES_KEY = 'cueweave.video-entity-aliases-v1';
const MAX_VIDEOS = 80;
const MAX_ALIASES_PER_VIDEO = 80;

interface StoredVideoEntityAliases {
  fingerprint: string;
  aliases: TranslationTerm[];
  updatedAt: number;
}

type StoredEntityAliases = Record<string, StoredVideoEntityAliases>;

let writeChain: Promise<void> = Promise.resolve();

function sanitizeAlias(value: unknown): TranslationTerm | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.source !== 'string' || typeof record.translation !== 'string') return undefined;
  const source = record.source.trim().replace(/\s+/gu, ' ').slice(0, 96);
  const translation = record.translation.trim().replace(/\s+/gu, ' ').slice(0, 96);
  return source && translation && source.toLocaleLowerCase() !== translation.toLocaleLowerCase()
    ? { source, translation }
    : undefined;
}

function parseStoredAliases(value: unknown): StoredEntityAliases {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([videoId, candidate]) => {
      if (!videoId || typeof candidate !== 'object' || candidate === null) return [];
      const record = candidate as Record<string, unknown>;
      if (typeof record.fingerprint !== 'string' || !record.fingerprint) return [];
      const aliases = Array.isArray(record.aliases)
        ? record.aliases
            .flatMap((alias) => sanitizeAlias(alias) ?? [])
            .slice(0, MAX_ALIASES_PER_VIDEO)
        : [];
      const updatedAt =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : 0;
      return [[videoId, { fingerprint: record.fingerprint, aliases, updatedAt }]];
    }),
  );
}

async function readAll(): Promise<StoredEntityAliases> {
  const stored = await browser.storage.local.get([VIDEO_ENTITY_ALIASES_KEY]);
  return parseStoredAliases(stored[VIDEO_ENTITY_ALIASES_KEY]);
}

export async function createEntityAliasFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readVideoEntityAliases(
  videoId: string,
  fingerprint: string,
): Promise<TranslationTerm[] | undefined> {
  if (!videoId || !fingerprint) return undefined;
  const record = (await readAll())[videoId];
  return record?.fingerprint === fingerprint ? record.aliases : undefined;
}

export function writeVideoEntityAliases(
  videoId: string,
  fingerprint: string,
  aliases: readonly TranslationTerm[],
): Promise<void> {
  if (!videoId || !fingerprint) return Promise.resolve();
  const operation = writeChain.then(async () => {
    const stored = await readAll();
    stored[videoId] = {
      fingerprint,
      aliases: aliases
        .flatMap((alias) => sanitizeAlias(alias) ?? [])
        .slice(0, MAX_ALIASES_PER_VIDEO),
      updatedAt: Date.now(),
    };
    const retained = Object.fromEntries(
      Object.entries(stored)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_VIDEOS),
    );
    await browser.storage.local.set({ [VIDEO_ENTITY_ALIASES_KEY]: retained });
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}

export function clearVideoEntityAliases(videoId?: string): Promise<void> {
  const operation = writeChain.then(async () => {
    if (!videoId) {
      await browser.storage.local.remove(VIDEO_ENTITY_ALIASES_KEY);
      return;
    }
    const stored = await readAll();
    delete stored[videoId];
    await browser.storage.local.set({ [VIDEO_ENTITY_ALIASES_KEY]: stored });
  });
  writeChain = operation.catch(() => undefined);
  return operation;
}
