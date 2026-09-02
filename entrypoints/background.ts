import {
  isTestProviderMessage,
  isTranslateWindowMessage,
  type TranslateWindowMessage,
  type TranslateWindowResult,
} from '../src/provider/messages';
import { readProviderSettings } from '../src/provider/settings';
import { testProviderConnection, translateTokenWindow } from '../src/provider/chatCompletions';
import { ProviderError } from '../src/provider/types';
import { AI_PROMPT_VERSION, DISPLAY_SEGMENTATION_VERSION } from '../src/domain/subtitle/ai';
import { createTranslationCacheKey, TranslationCache } from '../src/cache/translationCache';
import { TranslationQueue } from '../src/provider/translationQueue';
import {
  GET_CONTENT_SETTINGS_MESSAGE,
  SET_SUBTITLE_PREFERENCES_MESSAGE,
  UPDATE_SUBTITLE_PREFERENCES_MESSAGE,
} from '../src/platform/youtube/types';
import {
  readSubtitlePreferences,
  saveSubtitlePreferences,
  type SubtitlePreferences,
} from '../src/settings/subtitle';

const ENABLED_KEY = 'cueweave.enabled';
const translationCache = new TranslationCache();
const translationQueue = new TranslationQueue(2);

async function broadcastSubtitlePreferences(preferences: SubtitlePreferences): Promise<void> {
  const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            browser.tabs.sendMessage(tab.id, {
              type: SET_SUBTITLE_PREFERENCES_MESSAGE,
              preferences,
            }),
          ],
    ),
  );
}

function validTranslationTokens(tokens: unknown[]): boolean {
  return (
    tokens.length > 0 &&
    tokens.length <= 180 &&
    tokens.every(
      (token) =>
        typeof token === 'object' &&
        token !== null &&
        'id' in token &&
        typeof token.id === 'string' &&
        'cueId' in token &&
        typeof token.cueId === 'string' &&
        'text' in token &&
        typeof token.text === 'string' &&
        token.text.length <= 100 &&
        'startMs' in token &&
        typeof token.startMs === 'number' &&
        'endMs' in token &&
        typeof token.endMs === 'number',
    )
  );
}

function validTranslationContext(message: TranslateWindowMessage): boolean {
  return (
    message.context.videoId.length > 0 &&
    message.context.videoId.length <= 64 &&
    message.context.languageCode.length > 0 &&
    message.context.languageCode.length <= 32 &&
    message.context.windowId.length > 0 &&
    message.context.windowId.length <= 512
  );
}

async function translateWindowMessage(
  message: TranslateWindowMessage,
): Promise<TranslateWindowResult> {
  if (!validTranslationTokens(message.tokens) || !validTranslationContext(message)) {
    return {
      ok: false,
      error: {
        code: 'invalid-response',
        message: '字幕窗口格式无效。CueWeave 已保留原文字幕。',
      },
    };
  }

  try {
    const settings = await readProviderSettings();
    const cacheKey = await createTranslationCacheKey({
      ...message.context,
      baseUrl: settings.baseUrl,
      model: settings.model,
      protocol: settings.protocol,
      promptVersion: AI_PROMPT_VERSION,
      segmentationVersion: DISPLAY_SEGMENTATION_VERSION,
      tokens: message.tokens,
    });

    try {
      const cachedCues = await translationCache.get(cacheKey);
      if (cachedCues) return { ok: true, cues: cachedCues, cacheHit: true };
    } catch {
      // IndexedDB failure must not block live translation.
    }

    return await translationQueue.enqueue(cacheKey, message.priority, async () => {
      try {
        const cachedCues = await translationCache.get(cacheKey);
        if (cachedCues) return { ok: true, cues: cachedCues, cacheHit: true } as const;
      } catch {
        // A second cache read closes the race between identical queued requests.
      }

      const cues = await translateTokenWindow(settings, message.tokens);
      try {
        await translationCache.put(cacheKey, cues);
      } catch {
        // Cache writes are best-effort; the verified translation is still usable.
      }
      return { ok: true, cues, cacheHit: false } as const;
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ProviderError
          ? { code: error.code, message: error.message }
          : {
              code: 'network',
              message: '字幕翻译请求失败。CueWeave 已保留原文字幕。',
            },
    };
  }
}

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  browser.runtime.onInstalled.addListener(async () => {
    const settings = await browser.storage.local.get([ENABLED_KEY]);
    if (settings[ENABLED_KEY] === undefined) {
      await browser.storage.local.set({ [ENABLED_KEY]: true });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === GET_CONTENT_SETTINGS_MESSAGE
    ) {
      return Promise.all([
        browser.storage.local.get([ENABLED_KEY]),
        readSubtitlePreferences(),
      ]).then(([stored, subtitlePreferences]) => ({
        enabled: stored[ENABLED_KEY] !== false,
        subtitlePreferences,
      }));
    }

    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === UPDATE_SUBTITLE_PREFERENCES_MESSAGE &&
      'preferences' in message
    ) {
      return saveSubtitlePreferences(message.preferences).then(async (preferences) => {
        await broadcastSubtitlePreferences(preferences);
        return { ok: true, preferences };
      });
    }

    if (isTestProviderMessage(message)) {
      return readProviderSettings()
        .then(testProviderConnection)
        .catch((error: unknown) => ({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : '模型连接测试失败。请检查 Provider 设置后重试。',
        }));
    }

    if (isTranslateWindowMessage(message)) {
      return translateWindowMessage(message);
    }

    return undefined;
  });
});
