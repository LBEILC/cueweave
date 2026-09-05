/** All modes share output validation; review effort is explicit and bounded. */
export type TranslationMode = 'speed' | 'balanced' | 'quality';
export const TRANSLATION_POLICY_VERSION = 'playback-policy-v5';
export function translationPolicy(mode: TranslationMode = 'balanced') {
  const common = { mode, recoveryCalls: 2, transientRetries: 1, revisionTimeoutMs: 12000 };
  if (mode === 'speed')
    return {
      ...common,
      modelSeams: false,
      recoveryCalls: 1,
      transientRetries: 0,
      review: 'none' as const,
      historyCues: 2,
      windows: { targetTokens: 90, maxTokens: 140, maxDurationMs: 30000 },
    };
  if (mode === 'quality')
    return {
      ...common,
      modelSeams: true,
      review: 'always' as const,
      historyCues: 8,
      revisionTimeoutMs: 25000,
      windows: { targetTokens: 110, maxTokens: 180, maxDurationMs: 36000 },
    };
  return {
    ...common,
    modelSeams: true,
    review: 'risk' as const,
    historyCues: 4,
    windows: { targetTokens: 90, maxTokens: 140, maxDurationMs: 30000 },
  };
}
