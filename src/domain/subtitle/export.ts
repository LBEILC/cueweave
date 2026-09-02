import type { BilingualOrder } from '../../settings/subtitle';
import type { DisplayCue } from './types';

export type SubtitleExportFormat = 'srt' | 'vtt';
export type SubtitleExportMode = 'original' | 'corrected' | 'translation' | 'bilingual';

function timestamp(timeMs: number, separator: ',' | '.'): string {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  const hours = Math.floor(safeTimeMs / 3_600_000);
  const minutes = Math.floor((safeTimeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeTimeMs % 60_000) / 1_000);
  const milliseconds = safeTimeMs % 1_000;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
    .concat(separator, String(milliseconds).padStart(3, '0'));
}

function cueText(
  cue: DisplayCue,
  mode: SubtitleExportMode,
  bilingualOrder: BilingualOrder,
): string {
  const original = (cue.originalText ?? cue.sourceText).trim();
  const corrected = cue.sourceText.trim();
  const translation = cue.translation.trim();
  switch (mode) {
    case 'original':
      return original;
    case 'corrected':
      return corrected;
    case 'translation':
      return translation;
    case 'bilingual':
      return bilingualOrder === 'source-first'
        ? [corrected, translation].filter(Boolean).join('\n')
        : [translation, corrected].filter(Boolean).join('\n');
  }
}

function validatedCues(
  cues: readonly DisplayCue[],
  mode: SubtitleExportMode,
  bilingualOrder: BilingualOrder,
): Array<{ startMs: number; endMs: number; text: string }> {
  let previousStartMs = -1;
  return cues.map((cue) => {
    const text = cueText(cue, mode, bilingualOrder);
    if (!text) throw new Error('导出字幕包含空内容。');
    if (cue.startMs < 0 || cue.endMs <= cue.startMs || cue.startMs < previousStartMs) {
      throw new Error('导出字幕的时间轴无效或顺序错误。');
    }
    previousStartMs = cue.startMs;
    return { startMs: cue.startMs, endMs: cue.endMs, text };
  });
}

export function serializeSubtitles(
  cues: readonly DisplayCue[],
  format: SubtitleExportFormat,
  mode: SubtitleExportMode,
  bilingualOrder: BilingualOrder = 'translation-first',
): string {
  if (cues.length === 0) throw new Error('当前没有可导出的字幕。');
  const values = validatedCues(cues, mode, bilingualOrder);
  const blocks = values.map((cue, index) => {
    const range =
      format === 'srt'
        ? `${timestamp(cue.startMs, ',')} --> ${timestamp(cue.endMs, ',')}`
        : `${timestamp(cue.startMs, '.')} --> ${timestamp(cue.endMs, '.')}`;
    return format === 'srt' ? `${index + 1}\n${range}\n${cue.text}` : `${range}\n${cue.text}`;
  });
  return format === 'vtt' ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : `${blocks.join('\n\n')}\n`;
}

export function subtitleExportFilename(
  videoTitle: string,
  mode: SubtitleExportMode,
  format: SubtitleExportFormat,
): string {
  const withoutControlCharacters = Array.from(videoTitle, (character) =>
    character.charCodeAt(0) < 32 ? ' ' : character,
  ).join('');
  const safeTitle =
    withoutControlCharacters
      .replace(/[<>:"/\\|?*]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 120) || 'youtube-subtitles';
  const suffix = {
    original: 'original',
    corrected: 'corrected',
    translation: 'zh-CN',
    bilingual: 'bilingual',
  }[mode];
  return `${safeTitle}.${suffix}.${format}`;
}
