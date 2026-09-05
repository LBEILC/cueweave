import { describe, expect, it } from 'vitest';
import type { Cookie } from 'electron';
import { cookiesForSite, loginSiteForUrl, netscapeCookieFile } from './site-auth';

function cookie(overrides: Partial<Cookie>): Cookie {
  return {
    name: 'name',
    value: 'value',
    domain: '.example.com',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: false,
    session: false,
    sameSite: 'unspecified',
    ...overrides,
  };
}

describe('site login isolation', () => {
  it('recognizes only supported video sites', () => {
    expect(loginSiteForUrl('https://www.youtube.com/watch?v=1')).toBe('youtube');
    expect(loginSiteForUrl('https://b23.bilibili.com/example')).toBe('bilibili');
    expect(loginSiteForUrl('https://example.com/youtube.com')).toBeNull();
  });

  it('exports only cookies used by the selected site', () => {
    const cookies = [
      cookie({ domain: '.bilibili.com', name: 'SESSDATA' }),
      cookie({ domain: '.youtube.com', name: 'LOGIN_INFO' }),
      cookie({ domain: '.google.com', name: 'SAPISID' }),
      cookie({ domain: '.example.com', name: 'private' }),
    ];
    expect(cookiesForSite(cookies, 'bilibili').map((value) => value.name)).toEqual(['SESSDATA']);
    expect(cookiesForSite(cookies, 'youtube').map((value) => value.name)).toEqual([
      'LOGIN_INFO',
      'SAPISID',
    ]);
  });

  it('writes Netscape cookie format and drops unsafe fields', () => {
    const output = netscapeCookieFile([
      cookie({ domain: '.bilibili.com', name: 'SESSDATA', value: 'token', httpOnly: true }),
      cookie({ domain: '.bilibili.com', name: 'bad\nname', value: 'secret' }),
    ]);
    expect(output).toContain('#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\ttoken');
    expect(output).not.toContain('bad\nname');
  });
});
