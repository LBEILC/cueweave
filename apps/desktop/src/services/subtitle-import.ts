import type { ProjectCue } from '../shared/project';

export function parseImportedSubtitles(
  bytes: Uint8Array,
  durationMs: number,
): { cues: ProjectCue[]; warnings: string[] } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('字幕编码不受支持，请先转换为 UTF-8。');
  }
  text = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text || text.includes('\u0000')) throw new Error('字幕文件为空或编码不正确。');
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text);
  const warnings = new Set<string>();
  const cues: ProjectCue[] = [];
  const time = (s: string) => {
    const m = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(s);
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) throw new Error(`无效字幕时间：${s}`);
    return Number(m[1] ?? 0) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
  };
  for (const [blockIndex, block] of text.split(/\n[ \t]*\n/).entries()) {
    if (vtt && blockIndex === 0) {
      if (block.split('\n').length > 1) warnings.add('WebVTT 文件头元数据未应用；原文件完整保留。');
      continue;
    }
    if (vtt && /^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) {
      warnings.add('WebVTT 注释、样式和区域未应用；原文件完整保留。');
      continue;
    }
    const lines = block.split('\n');
    const rangeIndex = lines[0]?.includes('-->') ? 0 : 1;
    const m = /^(\S+)\s+-->\s+(\S+)(.*)$/.exec(lines[rangeIndex] ?? '');
    if (!m) throw new Error(`第 ${blockIndex + 1} 段缺少有效时间范围。`);
    const startMs = time(m[1]!);
    const endMs = time(m[2]!);
    if (
      !Number.isSafeInteger(startMs) ||
      !Number.isSafeInteger(endMs) ||
      endMs <= startMs ||
      endMs > durationMs
    )
      throw new Error(`第 ${cues.length + 1} 条字幕超出视频范围或结束时间不晚于开始时间。`);
    let content = lines
      .slice(rangeIndex + 1)
      .join('\n')
      .trim();
    if (m[3]?.trim()) warnings.add('字幕位置设置未应用；原文件完整保留。');
    if (/<[^>]*>/.test(content)) {
      warnings.add('字幕标记已转为纯文本；原文件完整保留。');
      content = content.replace(/<[^>]*>/g, '');
    }
    content = content.replace(
      /&(amp|lt|gt|nbsp);/g,
      (_match, key: string) => ({ amp: '&', lt: '<', gt: '>', nbsp: ' ' })[key]!,
    );
    if (!content.trim() || content.length > 20000)
      throw new Error(`第 ${cues.length + 1} 条字幕为空或过长。`);
    cues.push({ id: String(cues.length + 1), startMs, endMs, text: content });
    if (cues.length > 50000) throw new Error('字幕超过 50000 条，无法导入。');
  }
  if (!cues.length) throw new Error('没有找到可用的字幕。');
  return { cues, warnings: [...warnings] };
}
