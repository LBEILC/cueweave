import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { get } from 'node:http';
import { get as getHttps } from 'node:https';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { LinkImportProgress, LinkPreview } from '../shared/bridge';
import type {
  DownloadedMedia,
  InspectedLink,
  ResolvedMediaStream,
  ResolvedPlaybackVariant,
  ResolvedSubtitleTrack,
  SubtitleRequest,
} from '../shared/service';

const MAX_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MEDIA_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi']);

export class LinkError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_LINK' | 'NETWORK_ERROR' | 'TOO_LARGE' | 'CANCELLED',
    message: string,
  ) {
    super(message);
  }
}

export interface LinkTools {
  ytDlpPath: string;
  denoPath: string;
  ffmpegPath: string;
  downloadsDirectory: string;
  allowPrivateNetwork?: boolean;
}

export function isYoutubeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
}

export function isBilibiliUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com');
}

export function isSupportedWebsiteUrl(url: URL): boolean {
  return isYoutubeUrl(url) || isBilibiliUrl(url);
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? address;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8'))
    return true;
  if (normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb'))
    return true;
  if (normalized.startsWith('2001:db8:')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split('.').map(Number);
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function parseLink(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new LinkError('UNSUPPORTED_LINK', '链接格式不正确');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new LinkError('UNSUPPORTED_LINK', '只支持 HTTP(S) 视频链接');
  }
  return url;
}

async function safeLookup(hostname: string, allowPrivateNetwork: boolean) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (
    !records.length ||
    (!allowPrivateNetwork && records.some((item) => isPrivateAddress(item.address)))
  ) {
    throw new LinkError('UNSUPPORTED_LINK', '链接指向了不允许访问的地址');
  }
  const selected = records[0];
  if (!selected) throw new LinkError('NETWORK_ERROR', '无法解析链接地址');
  return selected;
}

async function openResponse(
  url: URL,
  options: { method: 'HEAD' | 'GET'; rangeStart?: number; signal?: AbortSignal },
  allowPrivateNetwork: boolean,
  redirects = 0,
): Promise<{ response: IncomingMessage; url: URL }> {
  if (redirects > MAX_REDIRECTS) throw new LinkError('NETWORK_ERROR', '链接重定向次数过多');
  const address = await safeLookup(url.hostname, allowPrivateNetwork);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? getHttps : get)(url, {
      method: options.method,
      headers: {
        'User-Agent': 'CueWeave/0.1 (+https://github.com/CueWeave)',
        Accept: 'video/*,audio/*,application/octet-stream;q=0.8,*/*;q=0.1',
        ...(options.rangeStart ? { Range: `bytes=${options.rangeStart}-` } : {}),
      },
      lookup: (_hostname, _lookupOptions, callback) =>
        callback(null, address.address, address.family),
      signal: options.signal,
      timeout: 30_000,
    });
    request.once('timeout', () => request.destroy(new Error('Request timed out')));
    request.once('error', (error) => {
      if (options.signal?.aborted) reject(new LinkError('CANCELLED', '下载已取消'));
      else reject(new LinkError('NETWORK_ERROR', error.message));
    });
    request.once('response', (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        let next: URL;
        try {
          next = new URL(response.headers.location, url);
        } catch {
          reject(new LinkError('NETWORK_ERROR', '链接返回了无效的重定向'));
          return;
        }
        if (
          (next.protocol !== 'http:' && next.protocol !== 'https:') ||
          next.username ||
          next.password
        ) {
          reject(new LinkError('UNSUPPORTED_LINK', '链接重定向到了不支持的协议'));
          return;
        }
        void openResponse(next, options, allowPrivateNetwork, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new LinkError('NETWORK_ERROR', `服务器返回了 ${status}`));
        return;
      }
      resolve({ response, url });
    });
  });
}

function contentLength(response: IncomingMessage): number | undefined {
  const value = Number(response.headers['content-length']);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function contentRangeTotal(response: IncomingMessage): number | undefined {
  const match = /\/([0-9]+)$/.exec(response.headers['content-range'] ?? '');
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function extensionFor(response: IncomingMessage, url: URL): string {
  const disposition = response.headers['content-disposition'] ?? '';
  const fileMatch = /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(disposition);
  const candidates = [fileMatch?.[1], url.pathname].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const extension = extname(decodeURIComponent(candidate)).toLowerCase();
    if (MEDIA_EXTENSIONS.has(extension)) return extension;
  }
  const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  const mapping: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
  };
  return type ? (mapping[type] ?? '') : '';
}

function directTitle(response: IncomingMessage, url: URL, extension: string): string {
  const disposition = response.headers['content-disposition'] ?? '';
  const fileMatch = /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(disposition);
  const raw = fileMatch?.[1] ? decodeURIComponent(fileMatch[1]) : basename(url.pathname);
  return (raw || `网络视频${extension}`)
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .slice(0, 140);
}

function assertDirectMedia(response: IncomingMessage, url: URL): string {
  const extension = extensionFor(response, url);
  const contentType = (response.headers['content-type'] ?? '').toLowerCase();
  if (!extension || contentType.startsWith('text/html')) {
    response.resume();
    throw new LinkError('UNSUPPORTED_LINK', '这个地址不是可下载的视频文件');
  }
  const length = contentLength(response);
  if (length !== undefined && length > MAX_BYTES) {
    response.resume();
    throw new LinkError('TOO_LARGE', '视频超过 20 GB');
  }
  return extension;
}

export async function inspectDirect(url: URL, allowPrivateNetwork = false): Promise<InspectedLink> {
  let opened: { response: IncomingMessage; url: URL };
  try {
    try {
      opened = await openResponse(url, { method: 'HEAD' }, allowPrivateNetwork);
    } catch (error) {
      if (!(error instanceof LinkError) || error.code !== 'NETWORK_ERROR') throw error;
      opened = await openResponse(url, { method: 'GET' }, allowPrivateNetwork);
    }
    if (!extensionFor(opened.response, opened.url)) {
      opened.response.resume();
      opened = await openResponse(url, { method: 'GET' }, allowPrivateNetwork);
    }
    const extension = assertDirectMedia(opened.response, opened.url);
    const result: LinkPreview = {
      kind: 'direct',
      url: url.href,
      title: directTitle(opened.response, opened.url, extension),
      source: opened.url.hostname,
    };
    const contentType = (opened.response.headers['content-type'] ?? '').split(';')[0]?.trim();
    const inspected: InspectedLink = {
      ...result,
      resolvedUrl: opened.url.href,
      ...(contentType ? { resolvedMime: contentType } : {}),
    };
    const length = contentLength(opened.response);
    if (length !== undefined) inspected.sizeBytes = length;
    opened.response.resume();
    return inspected;
  } catch (error) {
    if (error instanceof LinkError) throw error;
    throw new LinkError('NETWORK_ERROR', '无法读取视频链接');
  }
}

function runYtDlp(
  id: string,
  tools: LinkTools,
  args: string[],
  onChild: (id: string, child: ChildProcess | null) => void,
  options: {
    captureOutput?: boolean;
    maxOutputChars?: number;
    onLine?: (line: string) => void;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ytDlpPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onChild(id, child);
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    const fail = (error: Error, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) child.kill('SIGKILL');
      onChild(id, null);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new LinkError('NETWORK_ERROR', '读取视频链接超时'), true),
      30 * 60_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (options.captureOutput !== false) {
        stdout += text;
        if (stdout.length > (options.maxOutputChars ?? 128_000)) {
          fail(new LinkError('NETWORK_ERROR', '视频站点返回的信息过多'), true);
          return;
        }
      }
      if (options.onLine) {
        pending += text;
        if (pending.length > 64_000 && !pending.includes('\n')) {
          fail(new LinkError('NETWORK_ERROR', '视频站点返回了异常信息'), true);
          return;
        }
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) options.onLine(line);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-16_000);
    });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onChild(id, null);
      if (code === 0) {
        if (pending) options.onLine?.(pending);
        resolve(stdout);
      } else if (signal) reject(new LinkError('CANCELLED', '下载已取消'));
      else reject(new LinkError('NETWORK_ERROR', stderr.trim() || `yt-dlp exited with ${code}`));
    });
  });
}

function ytCommon(tools: LinkTools, cookieFile?: string): string[] {
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--encoding',
    'utf-8',
    '--socket-timeout',
    '20',
    '--retries',
    '2',
    '--extractor-retries',
    '2',
    '--js-runtimes',
    `deno:${tools.denoPath}`,
  ];
  if (cookieFile) args.push('--cookies', cookieFile);
  return args;
}

export async function inspectWebsite(
  id: string,
  url: URL,
  tools: LinkTools,
  onChild: (id: string, child: ChildProcess | null) => void,
  cookieFile?: string,
): Promise<InspectedLink> {
  const output = await runYtDlp(
    id,
    tools,
    [...ytCommon(tools, cookieFile), '--skip-download', '--dump-single-json', url.href],
    onChild,
    { maxOutputChars: 2_000_000 },
  );
  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    metadata = parsed as Record<string, unknown>;
  } catch {
    throw new LinkError('NETWORK_ERROR', '视频站点返回了无效的信息');
  }
  const videoId = typeof metadata.id === 'string' ? metadata.id : '';
  if (!videoId) throw new LinkError('UNSUPPORTED_LINK', '这不是受支持的单个视频链接');
  const title = (typeof metadata.title === 'string' ? metadata.title : '在线视频').slice(0, 200);
  const source = (typeof metadata.uploader === 'string' ? metadata.uploader : url.hostname).slice(
    0,
    100,
  );
  const duration = Number(metadata.duration);
  const variants = parsePlaybackVariants(metadata.formats);
  const subtitles = parseSubtitleTracks(metadata);
  return {
    kind: 'website',
    url: url.href,
    title,
    source,
    ...(Number.isFinite(duration) && duration >= 0 ? { durationSeconds: duration } : {}),
    ...(variants.length ? { resolvedVariants: variants } : {}),
    ...(subtitles.length ? { resolvedSubtitles: subtitles } : {}),
  };
}

function codecRank(codec: string): number {
  if (/^(avc1|h264)/i.test(codec)) return 4;
  if (/^(vp9|vp0?9)/i.test(codec)) return 3;
  if (/^(av01|av1)/i.test(codec)) return 2;
  if (/^(hev1|hvc1|hevc)/i.test(codec)) return 1;
  return 0;
}

function codecLabel(codec: string): string {
  if (/^(avc1|h264)/i.test(codec)) return 'H.264';
  if (/^(vp9|vp0?9)/i.test(codec)) return 'VP9';
  if (/^(av01|av1)/i.test(codec)) return 'AV1';
  if (/^(hev1|hvc1|hevc)/i.test(codec)) return 'HEVC';
  return codec.split('.')[0]?.toUpperCase() || '视频';
}

function numeric(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function displayHeight(format: Record<string, unknown>): number | undefined {
  const width = numeric(format.width);
  const height = numeric(format.height);
  if (!height) return undefined;
  return width ? Math.min(width, height) : height;
}

function platformQualityName(format: Record<string, unknown>): string | undefined {
  if (typeof format.format !== 'string') return undefined;
  const name = format.format.trim();
  return /^(?:\d{3,4}P|[48]K)(?:\s|$)/i.test(name) && name.length <= 40 ? name : undefined;
}

function resolutionLabel(height: number): string {
  if (height === 2160) return '2160p（4K）';
  if (height === 1440) return '1440p（2K）';
  return `${height}p`;
}

function isStandardDynamicRange(format: Record<string, unknown>): boolean {
  return (
    typeof format.dynamic_range !== 'string' ||
    format.dynamic_range.length === 0 ||
    format.dynamic_range.toUpperCase() === 'SDR'
  );
}

export function parsePlaybackVariants(values: unknown): ResolvedPlaybackVariant[] {
  if (!Array.isArray(values)) return [];
  const formats = values.filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  );
  const audioCandidates = formats
    .filter(
      (format) =>
        (format.protocol === 'http' || format.protocol === 'https') &&
        format.vcodec === 'none' &&
        typeof format.acodec === 'string' &&
        format.acodec !== 'none' &&
        resolvedMediaStream(format)?.mime.startsWith('audio/'),
    )
    .sort((left, right) => {
      const audioRank = (format: Record<string, unknown>) =>
        typeof format.acodec === 'string' && /^mp4a/i.test(format.acodec)
          ? 2
          : typeof format.acodec === 'string' && /^opus/i.test(format.acodec)
            ? 1
            : 0;
      return (
        audioRank(right) - audioRank(left) || (numeric(right.abr) ?? 0) - (numeric(left.abr) ?? 0)
      );
    });
  const bestAudio = audioCandidates[0] ? resolvedMediaStream(audioCandidates[0]) : null;
  const videos = formats.filter(
    (format) =>
      (format.protocol === 'http' || format.protocol === 'https') &&
      typeof format.vcodec === 'string' &&
      format.vcodec !== 'none' &&
      displayHeight(format) !== undefined &&
      (displayHeight(format) ?? Infinity) <= 2160 &&
      isStandardDynamicRange(format) &&
      resolvedMediaStream(format)?.mime.startsWith('video/'),
  );
  const byQuality = new Map<string, Record<string, unknown>>();
  for (const format of videos) {
    const height = displayHeight(format);
    if (!height) continue;
    const platformName = platformQualityName(format);
    const key = platformName ? `platform:${platformName}` : `resolution:${height}`;
    const current = byQuality.get(key);
    const score = (item: Record<string, unknown>) =>
      codecRank(String(item.vcodec ?? '')) * 1_000_000 +
      (numeric(item.fps) ?? 0) * 1_000 +
      (numeric(item.tbr) ?? 0);
    if (!current || score(format) > score(current)) byQuality.set(key, format);
  }
  return [...byQuality.values()]
    .sort(
      (left, right) =>
        (displayHeight(right) ?? 0) - (displayHeight(left) ?? 0) ||
        (numeric(right.fps) ?? 0) - (numeric(left.fps) ?? 0) ||
        (numeric(right.quality) ?? 0) - (numeric(left.quality) ?? 0) ||
        (numeric(right.tbr) ?? 0) - (numeric(left.tbr) ?? 0),
    )
    .flatMap((format) => {
      const video = resolvedMediaStream(format);
      if (!video) return [];
      const codec = String(format.vcodec ?? '');
      const fps = numeric(format.fps);
      const width = numeric(format.width);
      const height = displayHeight(format);
      if (!height) return [];
      const actualHeight = numeric(format.height);
      const platformName = platformQualityName(format);
      const hasAudio = typeof format.acodec === 'string' && format.acodec !== 'none';
      const id = typeof format.format_id === 'string' ? format.format_id : `${height}-${codec}`;
      const fpsLabel = fps && fps >= 50 && !platformName?.includes(String(Math.round(fps)));
      return [
        {
          id,
          label: `${platformName ?? resolutionLabel(height)}${fpsLabel ? ` · ${Math.round(fps)} fps` : ''} · ${codecLabel(codec)}`,
          ...(width ? { width } : {}),
          ...(actualHeight ? { height: actualHeight } : {}),
          ...(fps ? { fps } : {}),
          videoCodec: codecLabel(codec),
          video,
          ...(!hasAudio && bestAudio ? { audio: bestAudio } : {}),
        },
      ];
    });
}

function parseSubtitleTracks(metadata: Record<string, unknown>): ResolvedSubtitleTrack[] {
  const result: ResolvedSubtitleTrack[] = [];
  for (const [field, kind] of [
    ['subtitles', 'manual'],
    ['automatic_captions', 'automatic'],
  ] as const) {
    const collection = metadata[field];
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
    for (const [language, rawTracks] of Object.entries(collection)) {
      if (!Array.isArray(rawTracks) || !rawTracks.length || language.length > 80) continue;
      const named = rawTracks.find(
        (track) =>
          track &&
          typeof track === 'object' &&
          !Array.isArray(track) &&
          typeof (track as Record<string, unknown>).name === 'string',
      ) as Record<string, unknown> | undefined;
      const base = typeof named?.name === 'string' ? named.name : language;
      result.push({
        language,
        label: `${base}（${kind === 'manual' ? '人工' : '自动'}）`,
        kind,
      });
    }
  }
  return result;
}

function resolvedMediaStream(value: unknown): ResolvedMediaStream | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const format = value as Record<string, unknown>;
  if (typeof format.url !== 'string' || format.url.length < 1 || format.url.length > 16_384)
    return null;
  let parsed: URL;
  try {
    parsed = new URL(format.url);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  )
    return null;
  const video = typeof format.vcodec === 'string' && format.vcodec !== 'none';
  const audio = typeof format.acodec === 'string' && format.acodec !== 'none';
  const extension = typeof format.ext === 'string' ? format.ext.toLowerCase() : '';
  const mime = video
    ? extension === 'webm'
      ? 'video/webm'
      : 'video/mp4'
    : audio
      ? extension === 'webm'
        ? 'audio/webm'
        : 'audio/mp4'
      : '';
  if (!mime) return null;
  const headers: Record<string, string> = {};
  const rawHeaders =
    format.http_headers &&
    typeof format.http_headers === 'object' &&
    !Array.isArray(format.http_headers)
      ? (format.http_headers as Record<string, unknown>)
      : {};
  const allowedHeaders = new Set(['accept', 'accept-language', 'origin', 'referer', 'user-agent']);
  for (const [name, headerValue] of Object.entries(rawHeaders)) {
    if (
      allowedHeaders.has(name.toLowerCase()) &&
      typeof headerValue === 'string' &&
      headerValue.length <= 4_096 &&
      !/[\r\n]/.test(headerValue)
    ) {
      headers[name] = headerValue;
    }
  }
  const rawSize = format.filesize ?? format.filesize_approx;
  const size = Number(rawSize);
  return {
    url: parsed.href,
    mime,
    headers,
    ...(Number.isSafeInteger(size) && size > 0 ? { size } : {}),
  };
}

export async function inspectLink(
  id: string,
  rawUrl: string,
  tools: LinkTools,
  onChild: (id: string, child: ChildProcess | null) => void,
  cookieFile?: string,
): Promise<InspectedLink> {
  const url = parseLink(rawUrl);
  return isSupportedWebsiteUrl(url)
    ? inspectWebsite(id, url, tools, onChild, cookieFile)
    : inspectDirect(url, tools.allowPrivateNetwork);
}

export async function fetchWebsiteSubtitle(
  id: string,
  request: SubtitleRequest,
  tools: LinkTools,
  onChild: (id: string, child: ChildProcess | null) => void,
): Promise<{ name: string; content: string }> {
  const url = parseLink(request.url);
  if (!isSupportedWebsiteUrl(url)) throw new LinkError('UNSUPPORTED_LINK', '这个链接没有在线字幕');
  const directory = await mkdtemp(join(tmpdir(), 'cueweave-subtitle-'));
  try {
    const exactLanguage = `^${request.language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    await runYtDlp(
      id,
      tools,
      [
        ...ytCommon(tools, request.cookieFile),
        '--skip-download',
        request.kind === 'automatic' ? '--write-auto-subs' : '--write-subs',
        '--sub-langs',
        exactLanguage,
        '--sub-format',
        'vtt',
        '--convert-subs',
        'vtt',
        '--ffmpeg-location',
        dirname(tools.ffmpegPath),
        '-o',
        join(directory, 'subtitle.%(language)s.%(ext)s'),
        url.href,
      ],
      onChild,
      { maxOutputChars: 64_000 },
    );
    const files = (await readdir(directory)).filter(
      (name) => extname(name).toLowerCase() === '.vtt',
    );
    const filename = files[0];
    if (!filename) throw new LinkError('NETWORK_ERROR', '没有取得所选在线字幕');
    const path = join(directory, filename);
    const details = await stat(path);
    if (!details.isFile() || details.size < 1 || details.size > 4 * 1024 * 1024)
      throw new LinkError('NETWORK_ERROR', '在线字幕文件无效');
    return {
      name: request.label,
      content: (await readFile(path, 'utf8')).replace(/^\uFEFF/, ''),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function downloadDirect(
  url: URL,
  tools: LinkTools,
  signal: AbortSignal,
  onProgress: (value: Omit<LinkImportProgress, 'jobId'>) => void,
): Promise<DownloadedMedia> {
  await mkdir(tools.downloadsDirectory, { recursive: true });
  const key = createHash('sha256').update(url.href).digest('hex').slice(0, 16);
  const partPath = join(tools.downloadsDirectory, `${key}.part`);
  const existing = await stat(partPath).then(
    (value) => value.size,
    () => 0,
  );
  const opened = await openResponse(
    url,
    { method: 'GET', ...(existing > 0 ? { rangeStart: existing } : {}), signal },
    tools.allowPrivateNetwork ?? false,
  );
  const extension = assertDirectMedia(opened.response, opened.url);
  const resumed = existing > 0 && opened.response.statusCode === 206;
  const start = resumed ? existing : 0;
  const responseBytes = contentLength(opened.response);
  const total =
    contentRangeTotal(opened.response) ??
    (responseBytes === undefined ? undefined : start + responseBytes);
  if (total !== undefined && total > MAX_BYTES) {
    opened.response.resume();
    throw new LinkError('TOO_LARGE', '视频超过 20 GB');
  }
  const title = directTitle(opened.response, opened.url, extension);
  const outputPath = join(
    tools.downloadsDirectory,
    `${title.replace(/\.[^.]+$/, '')} [${key}]${extension}`,
  );
  let downloaded = start;
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(partPath, { flags: resumed ? 'a' : 'w' });
    const cancel = () => {
      opened.response.destroy();
      output.destroy();
      reject(new LinkError('CANCELLED', '下载已取消'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    opened.response.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      if (downloaded > MAX_BYTES) {
        opened.response.destroy();
        output.destroy();
        reject(new LinkError('TOO_LARGE', '视频超过 20 GB'));
        return;
      }
      const elapsed = Math.max(1, (Date.now() - started) / 1000);
      onProgress({
        phase: 'downloading',
        downloadedBytes: downloaded,
        ...(total !== undefined ? { totalBytes: total } : {}),
        speedBytesPerSecond: Math.max(0, (downloaded - start) / elapsed),
      });
    });
    output.once('error', reject);
    opened.response.once('error', (error) =>
      reject(signal.aborted ? new LinkError('CANCELLED', '下载已取消') : error),
    );
    output.once('finish', resolve);
    opened.response.pipe(output);
  });
  await rm(outputPath, { force: true });
  await rename(partPath, outputPath);
  return { path: outputPath, title, kind: 'direct' };
}

async function downloadWebsite(
  id: string,
  url: URL,
  tools: LinkTools,
  onChild: (id: string, child: ChildProcess | null) => void,
  onProgress: (value: Omit<LinkImportProgress, 'jobId'>) => void,
  cookieFile?: string,
): Promise<DownloadedMedia> {
  await mkdir(tools.downloadsDirectory, { recursive: true });
  let finalPath = '';
  await runYtDlp(
    id,
    tools,
    [
      ...ytCommon(tools, cookieFile),
      '--newline',
      '--max-filesize',
      String(MAX_BYTES),
      '--ffmpeg-location',
      dirname(tools.ffmpegPath),
      '-f',
      'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '--progress-template',
      'download:CW_PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
      '--print',
      'after_move:CW_FILE:%(filepath)s',
      '-o',
      join(tools.downloadsDirectory, '%(title).120B [%(id)s].%(ext)s'),
      url.href,
    ],
    onChild,
    {
      captureOutput: false,
      onLine: (line) => {
        if (line.startsWith('CW_FILE:')) finalPath = line.slice('CW_FILE:'.length).trim();
        if (!line.startsWith('CW_PROGRESS:')) return;
        const [downloaded, total, speed, eta] = line.slice('CW_PROGRESS:'.length).split('|');
        const numeric = (value: string | undefined) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
        };
        const downloadedBytes = numeric(downloaded);
        const totalBytes = numeric(total);
        const speedBytesPerSecond = numeric(speed);
        const etaSeconds = numeric(eta);
        onProgress({
          phase: 'downloading',
          ...(downloadedBytes !== undefined ? { downloadedBytes } : {}),
          ...(totalBytes !== undefined ? { totalBytes } : {}),
          ...(speedBytesPerSecond !== undefined ? { speedBytesPerSecond } : {}),
          ...(etaSeconds !== undefined ? { etaSeconds } : {}),
        });
      },
    },
  );
  if (!finalPath) throw new LinkError('NETWORK_ERROR', '下载完成后未找到视频文件');
  const root = resolve(tools.downloadsDirectory);
  const resolvedPath = resolve(finalPath);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`))
    throw new LinkError('NETWORK_ERROR', '下载工具返回了无效的文件位置');
  onProgress({ phase: 'processing' });
  return { path: resolvedPath, title: basename(resolvedPath), kind: 'website' };
}

export async function downloadLink(
  id: string,
  rawUrl: string,
  tools: LinkTools,
  signal: AbortSignal,
  onChild: (id: string, child: ChildProcess | null) => void,
  onProgress: (value: Omit<LinkImportProgress, 'jobId'>) => void,
  cookieFile?: string,
): Promise<DownloadedMedia> {
  const url = parseLink(rawUrl);
  onProgress({ phase: 'starting' });
  return isSupportedWebsiteUrl(url)
    ? downloadWebsite(id, url, tools, onChild, onProgress, cookieFile)
    : downloadDirect(url, tools, signal, onProgress);
}
