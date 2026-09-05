import { ProviderError, type ProviderSettings } from '@cueweave/core/provider/types';
import { translateCueWindow as translateCoreCueWindow } from '@cueweave/core/provider/cueTranslation';
import type { ProjectCue } from '../shared/project';
import type { TargetLanguage } from '../shared/translation';
export {
  CUE_TRANSLATION_SCHEMA,
  translationWindows,
  parseCueTranslation,
} from '@cueweave/core/provider/cueTranslation';

export function boundedProviderFetch(baseUrl: string, signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin !== new URL(baseUrl).origin)
      throw new ProviderError('network', 'Unexpected origin', false);
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024 * 1024)
            throw new ProviderError('invalid-response', 'Response too large', false);
          chunks.push(value);
        }
    } finally {
      await reader?.cancel().catch(() => {});
    }
    return new Response(bytes ? Buffer.concat(chunks) : null, {
      status: response.status,
      headers: response.headers,
    });
  };
}
export function translateCueWindow(
  provider: ProviderSettings,
  source: readonly ProjectCue[],
  window: readonly ProjectCue[],
  language: TargetLanguage,
  signal: AbortSignal,
) {
  return translateCoreCueWindow(provider, source, window, language, signal, {
    fetch: boundedProviderFetch(provider.baseUrl, signal),
  });
}
export function translationError(error: unknown) {
  if (error instanceof ProviderError)
    return (
      (
        {
          authentication: '认证失败，请在设置中检查 API Key 后继续。',
          'model-not-found': '模型或接口不可用，请检查配置后继续。',
          'rate-limited': '服务限流或额度不足，已完成译文已保存，请稍后继续。',
          timeout: '模型响应超时，已完成译文已保存，请重试剩余字幕。',
          'invalid-response': '模型返回的字幕未通过完整性检查，已保留此前结果，请重试剩余字幕。',
        } as Record<string, string>
      )[error.code] ?? '模型请求未完成，请检查网络和服务配置后继续。'
    );
  if (error instanceof Error && /^(字幕|项目|磁盘|所选)/u.test(error.message))
    return error.message.slice(0, 300);
  return '翻译未完成，请检查网络、服务配置和磁盘空间后继续。';
}
