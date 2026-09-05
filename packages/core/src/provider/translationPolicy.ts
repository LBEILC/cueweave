/** Strategies share parsing and grounding; neither requires a second model review. */
export type TranslationMode = 'speed' | 'balanced';
export const TRANSLATION_POLICY_VERSION = 'playback-policy-v2';
export function translationPolicy(mode: TranslationMode = 'balanced') {
  return mode === 'speed'
    ? { mode, modelSeams: false, recoveryCalls: 1, transientRetries: 0 }
    : { mode, modelSeams: true, recoveryCalls: 2, transientRetries: 1 };
}
