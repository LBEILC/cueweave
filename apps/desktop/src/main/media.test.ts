import { describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaRegistry, parseByteRange } from './media';

describe('parseByteRange', () => {
  it.each([
    [null, 10, { status: 200, start: 0, end: 9 }],
    ['bytes=0-0', 10, { status: 206, start: 0, end: 0 }],
    ['bytes=4-', 10, { status: 206, start: 4, end: 9 }],
    ['bytes=-3', 10, { status: 206, start: 7, end: 9 }],
    ['bytes=7-99', 10, { status: 206, start: 7, end: 9 }],
    ['bytes=10-', 10, { status: 416 }],
    ['bytes=5-4', 10, { status: 416 }],
    ['bytes=0-1,4-5', 10, { status: 416 }],
    ['items=0-1', 10, { status: 416 }],
  ])('parses %s for %d bytes', (header, size, expected) => {
    expect(parseByteRange(header, size)).toEqual(expected);
  });

  it('supports an empty response for an empty file without a range', () => {
    expect(parseByteRange(null, 0)).toEqual({ status: 200, start: 0, end: -1 });
    expect(parseByteRange('bytes=0-', 0)).toEqual({ status: 416 });
  });
});

describe('MediaRegistry', () => {
  it('serves only the registered file and revokes changed content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cueweave-media-'));
    const path = join(directory, '中文 sample.mp4');
    await writeFile(path, Buffer.from('0123456789'));
    try {
      const registry = new MediaRegistry();
      const asset = await registry.register(path);
      expect(asset).not.toBeNull();
      const response = await registry.handle(
        new Request(asset!.url, { headers: { Range: 'bytes=2-5' } }),
      );
      expect(response.status).toBe(206);
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('2345');
      expect(
        (await registry.handle(new Request('cueweave-media://asset/not-registered'))).status,
      ).toBe(404);
      await appendFile(path, 'changed');
      expect((await registry.handle(new Request(asset!.url))).status).toBe(404);
    } finally {
      await rm(path, { force: true });
      await rmdir(directory);
    }
  });

  it('forwards byte ranges for a registered remote video', async () => {
    const fetchRemote = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('range')).toBe('bytes=2-5');
      return new Response('2345', {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': '4',
          'Content-Range': 'bytes 2-5/10',
          'Content-Type': 'video/mp4',
        },
      });
    });
    const registry = new MediaRegistry(fetchRemote);
    const asset = registry.registerRemote({
      url: 'https://media.example/video.mp4',
      name: 'remote.mp4',
      mime: 'video/mp4',
      size: 10,
    });
    expect(asset).not.toBeNull();
    const response = await registry.handle(
      new Request(asset!.url, { headers: { Range: 'bytes=2-5' } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await response.text()).toBe('2345');
    expect(fetchRemote).toHaveBeenCalledOnce();
    expect(registry.getPath(asset!.id)).toBeNull();
  });

  it('keeps separate website video and audio streams behind internal URLs', async () => {
    const fetchRemote = vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('referer')).toBe('https://video.example/watch/1');
      return new Response(url.endsWith('audio.m4s') ? 'audio' : 'video', {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });
    const registry = new MediaRegistry(fetchRemote);
    const playback = registry.registerRemoteStreams('example', {
      video: {
        url: 'https://cdn.example/video.m4s',
        mime: 'video/mp4',
        headers: { Referer: 'https://video.example/watch/1' },
      },
      audio: {
        url: 'https://cdn.example/audio.m4s',
        mime: 'audio/mp4',
        headers: { Referer: 'https://video.example/watch/1' },
      },
    });
    expect(playback).not.toBeNull();
    const video = await registry.handle(new Request(playback!.videoUrl));
    const audio = await registry.handle(new Request(playback!.audioUrl!));
    expect(video.headers.get('content-type')).toBe('video/mp4');
    expect(audio.headers.get('content-type')).toBe('audio/mp4');
    expect(await video.text()).toBe('video');
    expect(await audio.text()).toBe('audio');
  });

  it('registers quality variants and reuses their shared audio stream', async () => {
    const registry = new MediaRegistry();
    const audio = {
      url: 'https://cdn.example/audio.m4s',
      mime: 'audio/mp4',
      headers: { Referer: 'https://video.example/watch/1' },
    };
    const variants = registry.registerRemoteVariants('example', [
      {
        id: '1080',
        label: '1080p · H.264',
        height: 1080,
        videoCodec: 'H.264',
        video: { url: 'https://cdn.example/1080.m4s', mime: 'video/mp4', headers: {} },
        audio,
      },
      {
        id: '720',
        label: '720p · H.264',
        height: 720,
        videoCodec: 'H.264',
        video: { url: 'https://cdn.example/720.m4s', mime: 'video/mp4', headers: {} },
        audio,
      },
    ]);

    expect(variants.map((variant) => variant.height)).toEqual([1080, 720]);
    expect(variants[0]?.videoUrl).not.toBe(variants[1]?.videoUrl);
    expect(variants[0]?.audioUrl).toBe(variants[1]?.audioUrl);
    expect(variants.every((variant) => variant.videoUrl.startsWith('cueweave-media://'))).toBe(
      true,
    );
  });

  it('follows public CDN redirects but blocks private redirect targets', async () => {
    const publicFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://edge.example/video.mp4' },
        }),
      )
      .mockResolvedValueOnce(new Response('video', { headers: { 'Content-Type': 'video/mp4' } }));
    const publicRegistry = new MediaRegistry(publicFetch);
    const publicAsset = publicRegistry.registerRemote({
      url: 'https://media.example/video.mp4',
      name: 'video.mp4',
    });
    expect(await (await publicRegistry.handle(new Request(publicAsset!.url))).text()).toBe('video');
    expect(publicFetch).toHaveBeenCalledTimes(2);

    const privateFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private.mp4' } }),
      );
    const privateRegistry = new MediaRegistry(privateFetch);
    const privateAsset = privateRegistry.registerRemote({
      url: 'https://media.example/video.mp4',
      name: 'video.mp4',
    });
    expect((await privateRegistry.handle(new Request(privateAsset!.url))).status).toBe(502);
    expect(privateFetch).toHaveBeenCalledOnce();
  });
});
