import { join } from 'node:path';

export const APP_URL = 'cueweave-app://app/index.html';

export function getRendererUrl(developmentUrl: string | undefined): string {
  if (!developmentUrl) return APP_URL;
  const url = new URL(developmentUrl);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid desktop development server URL');
  }
  return url.href;
}

export function isTrustedSender(
  source: { windowId: number; frameUrl: string; isMainFrame: boolean },
  expected: { windowId: number; rendererUrl: string },
): boolean {
  return (
    source.windowId === expected.windowId &&
    source.isMainFrame &&
    source.frameUrl === expected.rendererUrl
  );
}

export function resolveAppAsset(requestUrl: string, rendererDirectory: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'cueweave-app:' || url.host !== 'app' || url.username || url.password) {
      return null;
    }
    const pathname = decodeURIComponent(url.pathname);
    const allowed =
      /^\/(?:index\.html|cueweave-mark-paper\.svg|fonts\/MiSans-(?:Regular\.woff2|Semibold\.woff2|LICENSE\.pdf)|assets\/[a-zA-Z0-9_-]+\.(?:js|css))$/;
    return allowed.test(pathname) ? join(rendererDirectory, pathname.slice(1)) : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(rendererUrl: string): string {
  const development = rendererUrl !== APP_URL;
  const devOrigin = development ? new URL(rendererUrl).origin : '';
  return [
    "default-src 'none'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    "font-src 'self'",
    "img-src 'self'",
    'media-src cueweave-media:',
    development
      ? `connect-src ${devOrigin} ${devOrigin.replace('http:', 'ws:')} cueweave-media:`
      : 'connect-src cueweave-media:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ');
}
