import type { SourceToken } from '@cueweave/core/subtitle';
import {
  PlaybackPlan,
  PLAYBACK_PLAN_VERSION,
  type PlanSnapshot,
} from '@cueweave/core/provider/playbackPlan';
import type { ProviderSettings } from '@cueweave/core/provider/types';

import {
  TRANSLATION_POLICY_VERSION,
  type TranslationMode,
} from '@cueweave/core/provider/translationPolicy';

const PREFIX = 'cueweave.playback-plan.';
interface StoredPlan {
  videoId: string;
  updatedAt: number;
  snapshot: PlanSnapshot;
}
interface PlanStorage {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<unknown>;
  remove(keys: string[]): Promise<unknown>;
}

export class PlaybackPlans {
  private entries = new Map<string, { videoId: string; plan: PlaybackPlan }>();
  private generation = 0;
  constructor(private storage: PlanStorage) {}

  async open(
    videoId: string,
    languageCode: string,
    tokens: SourceToken[],
    settings: ProviderSettings,
    mode: TranslationMode = 'balanced',
  ) {
    const identity = JSON.stringify({
      version: PLAYBACK_PLAN_VERSION,
      policy: TRANSLATION_POLICY_VERSION,
      mode,
      videoId,
      languageCode,
      baseUrl: settings.baseUrl,
      model: settings.model,
      protocol: settings.protocol,
      tokens,
    });
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const key =
      PREFIX + [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
    let entry = this.entries.get(key);
    if (!entry) {
      const stored = await this.storage.get([key]).catch(() => ({}) as Record<string, unknown>);
      // Another open may have completed while storage was read; retain its live locks.
      entry = this.entries.get(key);
      if (!entry) {
        const record = stored[key] as StoredPlan | undefined;
        entry = { videoId, plan: new PlaybackPlan(tokens, record?.snapshot, mode) };
        this.entries.set(key, entry);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const [oldKey, oldEntry] of this.entries) {
      if (this.entries.size <= 8) break;
      if (oldKey !== key && !oldEntry.plan.busy) this.entries.delete(oldKey);
    }
    return { key, snapshot: entry.plan.snapshot() };
  }
  get(key: string) {
    return this.entries.get(key)?.plan;
  }
  videoId(key: string): string | undefined {
    return this.entries.get(key)?.videoId;
  }
  saver(key: string): (snapshot: PlanSnapshot) => Promise<void> {
    const generation = this.generation;
    return async (snapshot) => {
      const entry = this.entries.get(key);
      if (!entry || generation !== this.generation) return;
      await this.storage.set({
        [key]: { videoId: entry.videoId, snapshot, updatedAt: Date.now() },
      });
      const all = await this.storage.get(null);
      const keys = Object.keys(all)
        .filter((k) => k.startsWith(PREFIX))
        .sort(
          (a, b) =>
            ((all[b] as StoredPlan)?.updatedAt ?? 0) - ((all[a] as StoredPlan)?.updatedAt ?? 0),
        );
      if (keys.length > 32) await this.storage.remove(keys.slice(32));
    };
  }
  async clear(videoId?: string): Promise<void> {
    this.generation++;
    for (const [key, entry] of this.entries)
      if (!videoId || entry.videoId === videoId) this.entries.delete(key);
    const all = await this.storage.get(null);
    const keys = Object.keys(all).filter(
      (k) => k.startsWith(PREFIX) && (!videoId || (all[k] as StoredPlan)?.videoId === videoId),
    );
    if (keys.length) await this.storage.remove(keys);
  }
}
