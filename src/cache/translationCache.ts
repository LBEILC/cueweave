import type { DisplayCue, SourceToken, TranslationTerm } from '../domain/subtitle';
import type { ProviderProtocol } from '../provider/types';

const DEFAULT_DATABASE_NAME = 'cueweave-cache';
const DATABASE_VERSION = 1;
const TRANSLATION_STORE = 'translations';
const DEFAULT_MAX_ENTRIES = 1_200;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

export const TRANSLATION_CACHE_VERSION = 'translation-v1';

export interface TranslationCacheIdentity {
  videoId: string;
  languageCode: string;
  windowId: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  promptVersion: string;
  segmentationVersion: string;
  tokens: readonly SourceToken[];
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  transcriptEvidence?: readonly string[];
  manualTerminology?: readonly TranslationTerm[];
  correctionEnabled?: boolean;
}

interface TranslationCacheRecord {
  key: string;
  cues: DisplayCue[];
  videoId?: string;
  createdAt: number;
  lastAccessedAt: number;
  byteSize: number;
}

export interface TranslationCacheStats {
  entryCount: number;
  cueCount: number;
  byteSize: number;
}

interface TranslationCacheOptions {
  databaseName?: string;
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
  indexedDb?: IDBFactory;
}

interface LruCandidate {
  key: string;
  lastAccessedAt: number;
  byteSize: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTranscriptCorrection(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const correction = value as Record<string, unknown>;
  return (
    typeof correction.id === 'string' &&
    isFiniteNumber(correction.startIndex) &&
    isFiniteNumber(correction.endIndex) &&
    Array.isArray(correction.sourceTokenIds) &&
    correction.sourceTokenIds.every((tokenId) => typeof tokenId === 'string') &&
    isFiniteNumber(correction.startMs) &&
    isFiniteNumber(correction.endMs) &&
    typeof correction.originalText === 'string' &&
    typeof correction.correctedText === 'string' &&
    isFiniteNumber(correction.confidence) &&
    correction.confidence >= 0 &&
    correction.confidence <= 1 &&
    typeof correction.category === 'string' &&
    ['proper-noun', 'asr-error', 'formatting', 'other'].includes(correction.category) &&
    typeof correction.applied === 'boolean'
  );
}

function isTranslationTerm(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const term = value as Record<string, unknown>;
  return typeof term.source === 'string' && typeof term.translation === 'string';
}

function isDisplayCue(value: unknown): value is DisplayCue {
  if (typeof value !== 'object' || value === null) return false;
  const cue = value as Record<string, unknown>;
  return (
    typeof cue.id === 'string' &&
    Array.isArray(cue.sourceTokenIds) &&
    cue.sourceTokenIds.every((tokenId) => typeof tokenId === 'string') &&
    isFiniteNumber(cue.startMs) &&
    isFiniteNumber(cue.endMs) &&
    cue.endMs >= cue.startMs &&
    typeof cue.sourceText === 'string' &&
    (cue.originalText === undefined || typeof cue.originalText === 'string') &&
    (cue.corrections === undefined ||
      (Array.isArray(cue.corrections) && cue.corrections.every(isTranscriptCorrection))) &&
    (cue.terminology === undefined ||
      (Array.isArray(cue.terminology) && cue.terminology.every(isTranslationTerm))) &&
    typeof cue.translation === 'string' &&
    typeof cue.sentenceEnd === 'boolean' &&
    cue.status === 'translated'
  );
}

export function isDisplayCueArray(value: unknown): value is DisplayCue[] {
  return Array.isArray(value) && value.length > 0 && value.every(isDisplayCue);
}

function isTranslationCacheRecord(value: unknown): value is TranslationCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === 'string' &&
    (record.videoId === undefined || typeof record.videoId === 'string') &&
    isDisplayCueArray(record.cues) &&
    isFiniteNumber(record.createdAt) &&
    isFiniteNumber(record.lastAccessedAt) &&
    isFiniteNumber(record.byteSize) &&
    record.byteSize > 0
  );
}

function canonicalCacheInput(identity: TranslationCacheIdentity): string {
  return JSON.stringify({
    version: TRANSLATION_CACHE_VERSION,
    videoId: identity.videoId,
    languageCode: identity.languageCode,
    windowId: identity.windowId,
    baseUrl: identity.baseUrl,
    model: identity.model,
    protocol: identity.protocol,
    promptVersion: identity.promptVersion,
    segmentationVersion: identity.segmentationVersion,
    videoTitle: identity.videoTitle ?? '',
    channelName: identity.channelName ?? '',
    videoDescription: identity.videoDescription ?? '',
    transcriptEvidence: identity.transcriptEvidence ?? [],
    manualTerminology: identity.manualTerminology ?? [],
    correctionEnabled: identity.correctionEnabled !== false,
    tokens: identity.tokens.map((token) => ({
      id: token.id,
      cueId: token.cueId,
      text: token.text,
      startMs: token.startMs,
      endMs: token.endMs,
    })),
  });
}

export async function createTranslationCacheKey(
  identity: TranslationCacheIdentity,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCacheInput(identity));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${TRANSLATION_CACHE_VERSION}:${hash}`;
}

export function selectLruEvictionKeys(
  candidates: readonly LruCandidate[],
  maxEntries: number,
  maxBytes: number,
): string[] {
  const oldestFirst = [...candidates].sort(
    (left, right) => left.lastAccessedAt - right.lastAccessedAt,
  );
  let remainingEntries = oldestFirst.length;
  let remainingBytes = oldestFirst.reduce((total, candidate) => total + candidate.byteSize, 0);
  const keys: string[] = [];

  for (const candidate of oldestFirst) {
    if (remainingEntries <= maxEntries && remainingBytes <= maxBytes) break;
    keys.push(candidate.key);
    remainingEntries -= 1;
    remainingBytes -= candidate.byteSize;
  }

  return keys;
}

export class TranslationCache {
  private readonly databaseName: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly indexedDb: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: TranslationCacheOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? Date.now;
    this.indexedDb = options.indexedDb ?? indexedDB;
  }

  async get(key: string, videoId?: string): Promise<DisplayCue[] | undefined> {
    const database = await this.open();
    const transaction = database.transaction(TRANSLATION_STORE, 'readonly');
    const record = await requestResult(
      transaction.objectStore(TRANSLATION_STORE).get(key) as IDBRequest<unknown>,
    );
    await transactionComplete(transaction);

    if (!isTranslationCacheRecord(record)) {
      if (record !== undefined) await this.delete(key);
      return undefined;
    }

    const writeTransaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    writeTransaction.objectStore(TRANSLATION_STORE).put({
      ...record,
      ...(!record.videoId && videoId ? { videoId } : {}),
      lastAccessedAt: this.now(),
    });
    await transactionComplete(writeTransaction);
    return record.cues;
  }

  async put(key: string, cues: readonly DisplayCue[], videoId?: string): Promise<void> {
    if (!isDisplayCueArray(cues)) return;
    const database = await this.open();
    const timestamp = this.now();
    const storedCues = structuredClone(cues) as DisplayCue[];
    const record: TranslationCacheRecord = {
      key,
      cues: storedCues,
      ...(videoId ? { videoId } : {}),
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      byteSize: new TextEncoder().encode(JSON.stringify(storedCues)).byteLength,
    };
    const transaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    transaction.objectStore(TRANSLATION_STORE).put(record);
    await transactionComplete(transaction);
    await this.prune();
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    transaction.objectStore(TRANSLATION_STORE).clear();
    await transactionComplete(transaction);
  }

  async clearVideo(videoId: string): Promise<number> {
    if (!videoId) return 0;
    const database = await this.open();
    const readTransaction = database.transaction(TRANSLATION_STORE, 'readonly');
    const records = await requestResult(
      readTransaction.objectStore(TRANSLATION_STORE).getAll() as IDBRequest<unknown[]>,
    );
    await transactionComplete(readTransaction);
    const keys = records.flatMap((record) =>
      isTranslationCacheRecord(record) && record.videoId === videoId ? [record.key] : [],
    );
    if (keys.length === 0) return 0;

    const writeTransaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    const store = writeTransaction.objectStore(TRANSLATION_STORE);
    keys.forEach((key) => store.delete(key));
    await transactionComplete(writeTransaction);
    return keys.length;
  }

  async getStats(videoId?: string): Promise<TranslationCacheStats> {
    const database = await this.open();
    const transaction = database.transaction(TRANSLATION_STORE, 'readonly');
    const records = await requestResult(
      transaction.objectStore(TRANSLATION_STORE).getAll() as IDBRequest<unknown[]>,
    );
    await transactionComplete(transaction);
    const matchingRecords = records.filter(
      (record): record is TranslationCacheRecord =>
        isTranslationCacheRecord(record) && (!videoId || record.videoId === videoId),
    );
    return {
      entryCount: matchingRecords.length,
      cueCount: matchingRecords.reduce((total, record) => total + record.cues.length, 0),
      byteSize: matchingRecords.reduce((total, record) => total + record.byteSize, 0),
    };
  }

  close(): void {
    if (!this.databasePromise) return;
    void this.databasePromise.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private async delete(key: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    transaction.objectStore(TRANSLATION_STORE).delete(key);
    await transactionComplete(transaction);
  }

  private async prune(): Promise<void> {
    const database = await this.open();
    const readTransaction = database.transaction(TRANSLATION_STORE, 'readonly');
    const records = await requestResult(
      readTransaction.objectStore(TRANSLATION_STORE).getAll() as IDBRequest<unknown[]>,
    );
    await transactionComplete(readTransaction);
    const candidates = records.flatMap((record) =>
      isTranslationCacheRecord(record)
        ? [
            {
              key: record.key,
              lastAccessedAt: record.lastAccessedAt,
              byteSize: record.byteSize,
            },
          ]
        : [],
    );
    const keys = selectLruEvictionKeys(candidates, this.maxEntries, this.maxBytes);
    if (keys.length === 0) return;

    const writeTransaction = database.transaction(TRANSLATION_STORE, 'readwrite');
    const store = writeTransaction.objectStore(TRANSLATION_STORE);
    keys.forEach((key) => store.delete(key));
    await transactionComplete(writeTransaction);
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener(
        'upgradeneeded',
        () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(TRANSLATION_STORE)) {
            database.createObjectStore(TRANSLATION_STORE, { keyPath: 'key' });
          }
        },
        { once: true },
      );
      request.addEventListener(
        'success',
        () => {
          request.result.addEventListener('versionchange', () => request.result.close());
          resolve(request.result);
        },
        { once: true },
      );
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    return this.databasePromise;
  }
}
