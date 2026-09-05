import { describe, expect, it } from 'vitest';
import { parseImportedSubtitles, parseOnlineSubtitles } from './subtitle-import';
import { isProjectCommand } from '../shared/project';

const parse = (text: string, duration = 10000) =>
  parseImportedSubtitles(new TextEncoder().encode(text), duration);
describe('online platform WebVTT', () => {
  it('accepts whitespace payload rows and timed clear-screen cues without losing spoken text', () => {
    const text =
      'WEBVTT\r\nKind: captions\r\nLanguage: en\r\n\r\n00:00:00.400 --> 00:00:02.550 align:start\r\n \r\nHello,<00:00:00.880><c> everyone.</c>\r\n\r\n00:00:02.550 --> 00:00:02.560\r\nHello, everyone.\r\n \r\n\r\n00:00:02.560 --> 00:00:05.110\r\nHello, everyone.\r\n&gt;&gt; Welcome<00:00:03.000><c> back.</c>\r\n\r\n00:00:05.110 --> 00:00:06.000\r\n \r\n';
    const cues = parseOnlineSubtitles(text);
    expect(cues).toEqual([
      { id: '1', startMs: 400, endMs: 2550, text: 'Hello, everyone.' },
      { id: '2', startMs: 2550, endMs: 2560, text: 'Hello, everyone.' },
      { id: '3', startMs: 2560, endMs: 5110, text: 'Hello, everyone.\n>> Welcome back.' },
    ]);
    // Strict project imports retain their existing validation semantics.
    expect(() => parse(text)).toThrow('字幕为空或过长');
  });
  it('still rejects invalid timestamps, empty tracks and non-VTT input', () => {
    for (const content of [
      'WEBVTT\n\n00:00:02.000 --> 00:00:01.000\n ',
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n ',
      'WEBVTT\n\n00:00:99.000 --> 00:02:00.000\ntext',
      'not a subtitle',
    ])
      expect(() => parseOnlineSubtitles(content)).toThrow();
  });
});
describe('project subtitle import', () => {
  it('preserves millisecond times, intentional overlaps, repetitions, and UTF-8 BOM', () => {
    const result = parse(
      '\uFEFF1\r\n00:00:00,123 --> 00:00:02,456\r\n你好\r\n第二行\r\n\r\n2\r\n00:00:01,500 --> 00:00:03,000\r\n你好',
    );
    expect(result.cues).toEqual([
      { id: '1', startMs: 123, endMs: 2456, text: '你好\n第二行' },
      { id: '2', startMs: 1500, endMs: 3000, text: '你好' },
    ]);
  });
  it('reports lossy VTT metadata and safely decodes text once', () => {
    const result = parse(
      'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\nSTYLE\n::cue { color: red }\n\nidentifier\n00:00.100 --> 00:02.000 align:start\n<v Alice><b>Hello</b> &amp;lt; &lt;world&gt;',
    );
    expect(result.cues[0]?.text).toBe('Hello &lt; <world>');
    expect(result.warnings).toHaveLength(4);
  });
  it.each([
    '',
    'not a subtitle',
    '1\n00:00:03,000 --> 00:00:01,000\nText',
    '1\n00:61:00,000 --> 00:62:00,000\nText',
    '1\n00:00:00,000 --> 00:00:01,000\n',
    '1\n00:00:00,000 --> 00:00:11,000\nText',
  ])('rejects invalid or out-of-media subtitle input: %s', (text) => {
    expect(() => parse(text)).toThrow();
  });
  it('rejects malformed UTF-8 rather than silently substituting characters', () => {
    expect(() => parseImportedSubtitles(new Uint8Array([0xff, 0xfe, 0x42]), 1000)).toThrow('UTF-8');
  });
});
describe('project IPC schema', () => {
  const edit = {
    action: 'edit',
    projectId: 'p',
    baseRevision: 1,
    cue: { id: '1', startMs: 0, endMs: 1000, text: 'Hello' },
  };
  it('requires fixed fields, finite millisecond times, and a base revision', () => {
    expect(isProjectCommand(edit)).toBe(true);
    for (const value of [
      { ...edit, path: 'C:/secret' },
      { ...edit, baseRevision: -1 },
      { ...edit, cue: { ...edit.cue, endMs: Infinity } },
      { ...edit, cue: { ...edit.cue, text: 'a\n\nb' } },
      { action: 'read', path: 'x' },
    ])
      expect(isProjectCommand(value)).toBe(false);
  });
});
