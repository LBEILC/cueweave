import type { LoginSite } from '../../shared/bridge';
import type { SubtitleCue } from './components/SubtitlePanel';

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '时长未知';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function loginSiteFromLink(rawUrl: string): LoginSite | null {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be')
      return 'youtube';
    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili';
    return null;
  } catch {
    return null;
  }
}

export function loginSiteName(site: LoginSite): string {
  return site === 'youtube' ? 'YouTube' : '哔哩哔哩';
}

function subtitleTime(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part)))
    return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (hours === undefined || minutes === undefined || seconds === undefined) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseSubtitle(content: string): SubtitleCue[] {
  const blocks = content
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const match = /^\s*([^\s]+)\s*-->\s*([^\s]+)/.exec(lines[timingIndex] ?? '');
    const start = match?.[1] ? subtitleTime(match[1]) : null;
    const end = match?.[2] ? subtitleTime(match[2]) : null;
    const text = lines
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((left, right) => left.start - right.start);
}
