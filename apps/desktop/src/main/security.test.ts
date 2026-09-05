import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  APP_URL,
  contentSecurityPolicy,
  getRendererUrl,
  isTrustedSender,
  resolveAppAsset,
} from './security';

describe('desktop resource and sender boundaries', () => {
  it('accepts only the exact main frame in the expected window', () => {
    const source = { windowId: 1, frameUrl: APP_URL, isMainFrame: true };
    const expected = { windowId: 1, rendererUrl: APP_URL };
    expect(isTrustedSender(source, expected)).toBe(true);
    for (const changed of [
      { windowId: 2 },
      { isMainFrame: false },
      { frameUrl: `${APP_URL}?spoof=1` },
      { frameUrl: 'https://example.invalid/' },
      { frameUrl: 'about:blank' },
    ])
      expect(isTrustedSender({ ...source, ...changed }, expected)).toBe(false);
  });

  it('serves only compiled application assets', () => {
    for (const path of [
      'index.html',
      'assets/index-abc123.js',
      'assets/index-abc123.css',
      'fonts/MiSans-Regular.woff2',
    ]) {
      expect(resolveAppAsset(`cueweave-app://app/${path}`, '/renderer')).toBe(
        join('/renderer', path),
      );
    }
    for (const url of [
      'file:///private.txt',
      'cueweave-app://other/index.html',
      'cueweave-app://app:123/index.html',
      'cueweave-app://user@app/index.html',
      'cueweave-app://app/../../private.txt',
      'cueweave-app://app/assets/%2e%2e%2fprivate.txt',
      'cueweave-app://app/assets/..%5cprivate.js',
      'cueweave-app://app/assets/%00.js',
      'cueweave-app://app/%',
      'cueweave-app://app/node_modules/module.js',
    ])
      expect(resolveAppAsset(url, '/renderer')).toBeNull();
  });

  it('restricts the dev server to a local HTTP root', () => {
    expect(getRendererUrl(undefined)).toBe(APP_URL);
    expect(getRendererUrl('http://127.0.0.1:5174')).toBe('http://127.0.0.1:5174/');
    for (const url of [
      'https://example.invalid',
      'file:///tmp/index.html',
      'http://localhost.evil/',
      'http://user@localhost/',
      'http://localhost/other',
      'http://localhost/?redirect=1',
    ]) {
      expect(() => getRendererUrl(url)).toThrow();
    }
  });

  it('keeps dev allowances out of production CSP', () => {
    const production = contentSecurityPolicy(APP_URL);
    expect(production).toContain('connect-src cueweave-media:');
    expect(production).not.toContain('unsafe-inline');
    expect(production).not.toContain('unsafe-eval');
    expect(production).toContain("frame-src 'none'");
    expect(contentSecurityPolicy('http://127.0.0.1:5174/')).toContain(
      'connect-src http://127.0.0.1:5174 ws://127.0.0.1:5174',
    );
  });
});
