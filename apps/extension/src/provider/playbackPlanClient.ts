import type { SourceToken, TokenWindow } from '@cueweave/core/subtitle';
import {
  OPEN_PLAYBACK_PLAN_MESSAGE,
  PREPARE_PLAYBACK_WINDOW_MESSAGE,
  type PlaybackPlanResult,
  type TranslationPriority,
} from './messages';
import {
  PlaybackPlan,
  validPlanSnapshot,
  windowsFromSnapshot,
  type PlanSnapshot,
} from '@cueweave/core/provider/playbackPlan';
import { ProviderError } from '@cueweave/core/provider/types';

import type { TranslationMode } from '@cueweave/core/provider/translationPolicy';

export class PlaybackPlanClient {
  private opening: Promise<string> | undefined;
  private key = '';
  private snapshot: PlanSnapshot;
  constructor(
    private tokens: SourceToken[],
    private videoId: string,
    private languageCode: string,
    private send: (message: object) => Promise<PlaybackPlanResult>,
    private mode: TranslationMode = 'balanced',
  ) {
    this.snapshot = new PlaybackPlan(tokens, undefined, mode).snapshot();
  }
  windows(): TokenWindow[] {
    return windowsFromSnapshot(this.tokens, this.snapshot);
  }
  private accept(result: PlaybackPlanResult): string {
    if (!result.ok) throw new ProviderError(result.error.code, result.error.message);
    if (!validPlanSnapshot(result.snapshot, this.tokens, this.snapshot.ends.length))
      throw new ProviderError('invalid-response', '字幕规划范围无效，请重试此处。');
    if (this.key !== result.key || result.snapshot.revision >= this.snapshot.revision) {
      this.key = result.key;
      this.snapshot = result.snapshot;
    }
    return result.key;
  }
  private open(): Promise<string> {
    this.opening ??= this.send({
      type: OPEN_PLAYBACK_PLAN_MESSAGE,
      videoId: this.videoId,
      languageCode: this.languageCode,
      tokens: this.tokens,
      translationMode: this.mode,
    })
      .then((r) => this.accept(r))
      .catch((error) => {
        this.opening = undefined;
        throw error;
      });
    return this.opening;
  }
  async prepare(
    index: number,
    sessionId: string,
    priority: TranslationPriority,
    isActive: () => boolean = () => true,
  ): Promise<TokenWindow> {
    for (let attempt = 0; ; attempt++) {
      const key = await this.open();
      if (!isActive()) throw new ProviderError('cancelled', '字幕规划已取消。');
      const result = await this.send({
        type: PREPARE_PLAYBACK_WINDOW_MESSAGE,
        key,
        index,
        sessionId,
        priority,
      });
      if (!result.ok && result.expired && attempt === 0) {
        this.opening = undefined;
        continue;
      }
      this.accept(result);
      const window = this.windows()[index];
      if (!window) throw new ProviderError('invalid-response', '字幕窗口不存在。');
      return window;
    }
  }
}
