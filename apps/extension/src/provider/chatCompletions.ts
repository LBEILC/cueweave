import * as provider from '@cueweave/core/provider/chatCompletions';
import type { ProviderRuntime } from '@cueweave/core/provider/runtime';
import { ProviderError, type ProviderSettings } from '@cueweave/core/provider/types';
import { providerOriginPattern } from './settings';

export const PartialTranslationError = provider.PartialTranslationError;

async function assertProviderPermission(settings: ProviderSettings): Promise<void> {
  const origin = providerOriginPattern(settings.baseUrl);
  const allowed = await browser.permissions.contains({ origins: [origin] });
  if (!allowed) {
    throw new ProviderError(
      'permission-missing',
      '尚未授权访问模型服务。请在 CueWeave 设置中重新保存 Provider。',
    );
  }
}

function extensionRuntime(runtime?: ProviderRuntime): ProviderRuntime {
  return { ...runtime, assertPermission: runtime?.assertPermission ?? assertProviderPermission };
}

export const createSubtitleJsonRequest: typeof provider.createSubtitleJsonRequest = (
  settings,
  signal,
  onProgress,
  runtime,
  mode,
) =>
  provider.createSubtitleJsonRequest(settings, signal, onProgress, extensionRuntime(runtime), mode);

export const translatePlaybackWindow: typeof provider.translatePlaybackWindow = (
  settings,
  tokens,
  onProgress,
  signal,
  context,
  neighbors,
  runtime,
) =>
  provider.translatePlaybackWindow(
    settings,
    tokens,
    onProgress,
    signal,
    context,
    neighbors,
    extensionRuntime(runtime),
  );

export const translateTokenWindow: typeof provider.translateTokenWindow = (
  settings,
  tokens,
  onProgress,
  signal,
  context,
  runtime,
) =>
  provider.translateTokenWindow(
    settings,
    tokens,
    onProgress,
    signal,
    context,
    extensionRuntime(runtime),
  );

export const resolveVideoEntityAliases: typeof provider.resolveVideoEntityAliases = (
  settings,
  candidates,
  context,
  signal,
  runtime,
) =>
  provider.resolveVideoEntityAliases(
    settings,
    candidates,
    context,
    signal,
    extensionRuntime(runtime),
  );

export const testProviderConnection: typeof provider.testProviderConnection = (settings, runtime) =>
  provider.testProviderConnection(settings, extensionRuntime(runtime));
