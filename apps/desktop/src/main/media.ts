import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { MediaAsset, PlaybackVariant } from '../shared/bridge';
import type { ResolvedMediaStream, ResolvedPlaybackVariant } from '../shared/service';

const mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

interface LocalMedia extends MediaAsset {
  kind: 'local';
  size: number;
  path: string;
  mime: string;
  modified: number;
}

interface RemoteMedia extends MediaAsset {
  kind: 'remote';
  sourceUrl: string;
  mime: string;
  headers: Record<string, string>;
}

type RegisteredMedia = LocalMedia | RemoteMedia;
type RemoteFetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ByteRange =
  | { status: 200; start: 0; end: number }
  | { status: 206; start: number; end: number }
  | { status: 416 };

export function parseByteRange(header: string | null, size: number): ByteRange {
  if (size <= 0) return header ? { status: 416 } : { status: 200, start: 0, end: -1 };
  if (!header) return { status: 200, start: 0, end: size - 1 };
  if (!header.startsWith('bytes=') || header.includes(',')) return { status: 416 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return { status: 416 };
  const first = match[1] ?? '';
  const second = match[2] ?? '';
  if (!first) {
    const suffix = Number(second);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { status: 416 };
    return { status: 206, start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const requestedEnd = second ? Number(second) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return { status: 416 };
  }
  return { status: 206, start, end: Math.min(requestedEnd, size - 1) };
}

export class MediaRegistry {
  private readonly entries = new Map<string, RegisteredMedia>();

  constructor(private readonly fetchRemote: RemoteFetcher = fetch) {}

  async register(inputPath: string): Promise<MediaAsset | null> {
    const extension = extname(inputPath).toLowerCase();
    const mime = mediaTypes[extension];
    if (!mime) return null;
    try {
      const path = await realpath(inputPath);
      const details = await stat(path);
      if (!details.isFile() || details.size <= 0) return null;
      const id = randomUUID();
      const entry: LocalMedia = {
        kind: 'local',
        id,
        name: basename(path),
        size: details.size,
        url: `cueweave-media://asset/${id}`,
        path,
        mime,
        modified: details.mtimeMs,
      };
      this.entries.clear();
      this.entries.set(id, entry);
      return this.publicAsset(entry);
    } catch {
      return null;
    }
  }

  registerRemote(input: {
    url: string;
    name: string;
    mime?: string;
    size?: number;
  }): MediaAsset | null {
    this.entries.clear();
    const entry = this.createRemote(input);
    if (!entry) return null;
    this.entries.set(entry.id, entry);
    return this.publicAsset(entry);
  }

  registerRemoteStreams(
    name: string,
    playback: { video: ResolvedMediaStream; audio?: ResolvedMediaStream },
  ): { videoUrl: string; audioUrl?: string } | null {
    this.entries.clear();
    const video = this.createRemote({ ...playback.video, name });
    const audio = playback.audio
      ? this.createRemote({ ...playback.audio, name: `${name}（音频）` })
      : null;
    if (!video || (playback.audio && !audio)) return null;
    this.entries.set(video.id, video);
    if (audio) this.entries.set(audio.id, audio);
    return { videoUrl: video.url, ...(audio ? { audioUrl: audio.url } : {}) };
  }

  registerRemoteVariants(name: string, variants: ResolvedPlaybackVariant[]): PlaybackVariant[] {
    this.entries.clear();
    const registered = new Map<string, RemoteMedia>();
    const register = (stream: ResolvedMediaStream, suffix: string) => {
      const key = JSON.stringify([stream.url, stream.mime, stream.headers]);
      const existing = registered.get(key);
      if (existing) return existing;
      const entry = this.createRemote({ ...stream, name: `${name}${suffix}` });
      if (!entry) return null;
      registered.set(key, entry);
      this.entries.set(entry.id, entry);
      return entry;
    };
    return variants.flatMap((variant) => {
      const video = register(variant.video, `（${variant.label}）`);
      const audio = variant.audio ? register(variant.audio, '（音频）') : null;
      if (!video || (variant.audio && !audio)) return [];
      return [
        {
          id: variant.id,
          label: variant.label,
          ...(variant.width ? { width: variant.width } : {}),
          ...(variant.height ? { height: variant.height } : {}),
          ...(variant.fps ? { fps: variant.fps } : {}),
          videoCodec: variant.videoCodec,
          videoUrl: video.url,
          ...(audio ? { audioUrl: audio.url } : {}),
        },
      ];
    });
  }

  private createRemote(input: {
    url: string;
    name: string;
    mime?: string;
    size?: number;
    headers?: Record<string, string>;
  }): RemoteMedia | null {
    try {
      const source = new URL(input.url);
      if (
        (source.protocol !== 'http:' && source.protocol !== 'https:') ||
        source.username ||
        source.password
      ) {
        return null;
      }
      const id = randomUUID();
      const inferredMime =
        mediaTypes[extname(source.pathname).toLowerCase()] ??
        mediaTypes[extname(input.name).toLowerCase()];
      const mime =
        input.mime?.startsWith('video/') || input.mime?.startsWith('audio/')
          ? input.mime
          : inferredMime;
      if (!mime) return null;
      const entry: RemoteMedia = {
        kind: 'remote',
        id,
        name: input.name,
        ...(input.size !== undefined ? { size: input.size } : {}),
        url: `cueweave-media://asset/${id}`,
        sourceUrl: source.href,
        mime,
        headers: input.headers ?? {},
      };
      return entry;
    } catch {
      return null;
    }
  }

  getPath(id: string): string | null {
    const entry = this.entries.get(id);
    return entry?.kind === 'local' ? entry.path : null;
  }

  getPlayableSource(id: string): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return entry.kind === 'local' ? entry.path : entry.sourceUrl;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let id = '';
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'cueweave-media:' || url.host !== 'asset')
        return new Response(null, { status: 404 });
      id = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return new Response(null, { status: 404 });
    }
    const entry = this.entries.get(id);
    if (!entry) return new Response(null, { status: 404 });
    if (entry.kind === 'remote') return this.handleRemote(request, entry);
    try {
      const current = await stat(entry.path);
      if (!current.isFile() || current.size !== entry.size || current.mtimeMs !== entry.modified) {
        this.entries.delete(id);
        return new Response(null, { status: 404 });
      }
    } catch {
      this.entries.delete(id);
      return new Response(null, { status: 404 });
    }
    const range = parseByteRange(request.headers.get('range'), entry.size);
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': entry.mime,
      'Cache-Control': 'no-store',
    });
    if (range.status === 416) {
      headers.set('Content-Range', `bytes */${entry.size}`);
      return new Response(null, { status: 416, headers });
    }
    const length = Math.max(0, range.end - range.start + 1);
    headers.set('Content-Length', String(length));
    if (range.status === 206)
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${entry.size}`);
    if (request.method === 'HEAD' || length === 0)
      return new Response(null, { status: range.status, headers });
    const source = createReadStream(entry.path, { start: range.start, end: range.end });
    request.signal.addEventListener('abort', () => source.destroy(), { once: true });
    return new Response(Readable.toWeb(source) as ReadableStream, {
      status: range.status,
      headers,
    });
  }

  private async handleRemote(request: Request, entry: RemoteMedia): Promise<Response> {
    const requestHeaders = new Headers(entry.headers);
    if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'video/*,audio/*,*/*;q=0.1');
    const range = request.headers.get('range');
    if (range) requestHeaders.set('Range', range);
    try {
      const response = await this.fetchFollowingRedirects(entry.sourceUrl, {
        method: request.method,
        headers: requestHeaders,
        signal: request.signal,
      });
      const upstreamType = response.headers.get('content-type');
      const headers = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type':
          upstreamType?.startsWith('video/') || upstreamType?.startsWith('audio/')
            ? upstreamType
            : entry.mime,
      });
      for (const name of [
        'accept-ranges',
        'content-length',
        'content-range',
        'etag',
        'last-modified',
      ]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  }

  private async fetchFollowingRedirects(
    sourceUrl: string,
    init: RequestInit,
    redirects = 0,
  ): Promise<Response> {
    if (redirects > 5) throw new Error('Too many media redirects');
    const response = await this.fetchRemote(sourceUrl, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    const next = new URL(location, sourceUrl);
    const host = next.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      (next.protocol !== 'http:' && next.protocol !== 'https:') ||
      next.username ||
      next.password ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      (isIP(host) !== 0 && isPrivateIpLiteral(host))
    ) {
      throw new Error('Media redirect target is not allowed');
    }
    return this.fetchFollowingRedirects(next.href, init, redirects + 1);
  }

  private publicAsset(entry: RegisteredMedia): MediaAsset {
    return {
      id: entry.id,
      name: entry.name,
      ...(entry.size !== undefined ? { size: entry.size } : {}),
      url: entry.url,
    };
  }
}

function isPrivateIpLiteral(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? address;
  if (normalized === '::' || normalized === '::1') return true;
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
    return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpLiteral(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const [a = -1, b = -1] = normalized.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    a >= 224
  );
}
