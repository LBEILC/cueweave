import { describe, expect, it } from 'vitest';
import type { DisplayCue } from './types';
import { serializeSubtitles, subtitleExportFilename } from './export';

const cues: DisplayCue[] = [
  {
    id: 'cue-1',
    sourceTokenIds: ['token-1'],
    startMs: 1_250,
    endMs: 3_500,
    sourceText: 'ChatGPT is useful.',
    originalText: 'Chat GTT is useful.',
    translation: 'ChatGPT很有用',
    sentenceEnd: true,
    status: 'translated',
  },
];

describe('subtitle export', () => {
  it('serializes corrected bilingual SRT in the selected order', () => {
    expect(serializeSubtitles(cues, 'srt', 'bilingual', 'source-first')).toBe(
      '1\n00:00:01,250 --> 00:00:03,500\nChatGPT is useful.\nChatGPT很有用\n',
    );
  });

  it('serializes original WebVTT with a valid header', () => {
    expect(serializeSubtitles(cues, 'vtt', 'original')).toBe(
      'WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nChat GTT is useful.\n',
    );
  });

  it('rejects empty translations and sanitizes filenames', () => {
    expect(() =>
      serializeSubtitles([{ ...cues[0]!, translation: '' }], 'srt', 'translation'),
    ).toThrow('空内容');
    expect(subtitleExportFilename('A/B: Video?', 'translation', 'srt')).toBe('A B Video.zh-CN.srt');
  });
});
