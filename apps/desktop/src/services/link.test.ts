import { describe, expect, it } from 'vitest';
import {
  isBilibiliUrl,
  isPrivateAddress,
  isSupportedWebsiteUrl,
  isYoutubeUrl,
  parseLink,
  parsePlaybackVariants,
} from './link';

describe('video link validation', () => {
  it('accepts HTTP(S), classifies YouTube, and rejects credentials', () => {
    expect(isYoutubeUrl(parseLink('https://youtu.be/BaW_jenozKc'))).toBe(true);
    expect(isYoutubeUrl(parseLink('https://cdn.example.com/video.mp4'))).toBe(false);
    expect(isBilibiliUrl(parseLink('https://www.bilibili.com/video/BV1xx411c7mD'))).toBe(true);
    expect(isSupportedWebsiteUrl(parseLink('https://b23.tv/example'))).toBe(true);
    expect(() => parseLink('file:///C:/video.mp4')).toThrow('HTTP(S)');
    expect(() => parseLink('https://user:secret@example.com/video.mp4')).toThrow('HTTP(S)');
  });

  it('blocks local, private, link-local, and documentation address ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.1.1',
      '192.168.1.1',
      '169.254.10.2',
      '::1',
      'fe80::1',
      'fc00::1',
      '2001:db8::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('keeps standard SDR qualities through 4K and prefers broadly supported codecs', () => {
    const video = (id: string, height: number, codec: string, extra = {}) => ({
      format_id: id,
      url: `https://media.example/${id}.m4s`,
      protocol: 'https',
      ext: codec.startsWith('vp9') ? 'webm' : 'mp4',
      width: Math.round((height * 16) / 9),
      height,
      fps: 60,
      vcodec: codec,
      acodec: 'none',
      ...extra,
    });
    const variants = parsePlaybackVariants([
      {
        format_id: 'audio',
        url: 'https://media.example/audio.m4a',
        protocol: 'https',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
      },
      video('1080-avc', 1080, 'avc1.64002a'),
      video('1440-av1', 1440, 'av01.0.12M.08'),
      video('1440-vp9', 1440, 'vp9'),
      video('2160-av1', 2160, 'av01.0.13M.08'),
      video('2160-vp9', 2160, 'vp9'),
      video('2160-hdr', 2160, 'vp9.2', { dynamic_range: 'HDR10', tbr: 50_000 }),
      video('4320-vp9', 4320, 'vp9'),
    ]);

    expect(variants.map((variant) => variant.label)).toEqual([
      '2160p（4K） · 60 fps · VP9',
      '1440p（2K） · 60 fps · VP9',
      '1080p · 60 fps · H.264',
    ]);
    expect(variants.every((variant) => variant.audio)).toBe(true);
  });

  it('keeps Bilibili high-bitrate and high-frame-rate tiers at the same resolution', () => {
    const variants = parsePlaybackVariants([
      {
        format_id: '30280',
        url: 'https://media.example/audio.m4s',
        protocol: 'https',
        ext: 'm4a',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
      },
      ...[
        ['30080', '1080P 高清', 80, 30],
        ['30112', '1080P 高码率', 112, 30],
        ['30116', '1080P 60帧', 116, 60],
        ['30120', '4K 超高清', 120, 60],
      ].map(([formatId, format, quality, fps]) => ({
        format_id: formatId,
        format,
        quality,
        url: `https://media.example/${formatId}.m4s`,
        protocol: 'https',
        ext: 'mp4',
        width: quality === 120 ? 3840 : 1920,
        height: quality === 120 ? 2160 : 1080,
        fps,
        vcodec: 'avc1.640033',
        acodec: 'none',
      })),
    ]);

    expect(variants.map((variant) => variant.label)).toEqual([
      '4K 超高清 · 60 fps · H.264',
      '1080P 60帧 · H.264',
      '1080P 高码率 · H.264',
      '1080P 高清 · H.264',
    ]);
  });
});
