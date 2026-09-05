import { BrowserWindow, session } from 'electron';
import type { Cookie, Session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoginSite, SiteLoginStatus } from '../shared/bridge';

const LOGIN_PARTITION = 'persist:cueweave-site-login';

const SITE_CONFIG: Record<
  LoginSite,
  { title: string; startUrl: string; navigationDomains: string[]; cookieDomains: string[] }
> = {
  youtube: {
    title: '登录 YouTube · 句织',
    startUrl: 'https://www.youtube.com/signin',
    navigationDomains: [
      'youtube.com',
      'youtu.be',
      'google.com',
      'gstatic.com',
      'googleusercontent.com',
    ],
    cookieDomains: ['youtube.com', 'youtu.be', 'google.com'],
  },
  bilibili: {
    title: '登录哔哩哔哩 · 句织',
    startUrl: 'https://passport.bilibili.com/login',
    navigationDomains: ['bilibili.com'],
    cookieDomains: ['bilibili.com'],
  },
};

function normalizedDomain(domain: string): string {
  return domain.trim().replace(/^\./, '').toLowerCase();
}

function domainMatches(domain: string, suffix: string): boolean {
  const normalized = normalizedDomain(domain);
  return normalized === suffix || normalized.endsWith(`.${suffix}`);
}

export function loginSiteForUrl(rawUrl: string): LoginSite | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (domainMatches(url.hostname, 'youtube.com') || domainMatches(url.hostname, 'youtu.be'))
      return 'youtube';
    if (domainMatches(url.hostname, 'bilibili.com')) return 'bilibili';
    return null;
  } catch {
    return null;
  }
}

export function cookiesForSite(cookies: Cookie[], site: LoginSite): Cookie[] {
  const domains = SITE_CONFIG[site].cookieDomains;
  return cookies.filter(
    (cookie) =>
      typeof cookie.domain === 'string' &&
      domains.some((domain) => domainMatches(cookie.domain ?? '', domain)),
  );
}

export function netscapeCookieFile(cookies: Cookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Generated temporarily by CueWeave'];
  for (const cookie of cookies) {
    const cookieDomain = cookie.domain ?? '';
    const cookiePath = cookie.path ?? '/';
    if (
      !cookie.name ||
      !cookieDomain ||
      /[\t\r\n]/.test(cookie.name) ||
      /[\t\r\n]/.test(cookie.value) ||
      /[\t\r\n]/.test(cookieDomain) ||
      /[\t\r\n]/.test(cookiePath)
    ) {
      continue;
    }
    const includeSubdomains = cookieDomain.startsWith('.');
    const domain = `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookieDomain}`;
    const expires = Math.max(0, Math.floor(cookie.expirationDate ?? 0));
    lines.push(
      [
        domain,
        includeSubdomains ? 'TRUE' : 'FALSE',
        cookiePath,
        cookie.secure ? 'TRUE' : 'FALSE',
        String(expires),
        cookie.name,
        cookie.value,
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

function loginCookiePresent(cookies: Cookie[], site: LoginSite): boolean {
  const names = new Set(cookies.map((cookie) => cookie.name));
  return site === 'bilibili'
    ? names.has('SESSDATA')
    : names.has('SAPISID') || names.has('__Secure-3PAPISID') || names.has('LOGIN_INFO');
}

export class SiteAuthManager {
  private readonly loginSession: Session;
  private readonly windows = new Map<LoginSite, BrowserWindow>();

  constructor(private readonly hidden = false) {
    this.loginSession = session.fromPartition(LOGIN_PARTITION);
    this.loginSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    this.loginSession.setPermissionCheckHandler(() => false);
    const userAgent = this.loginSession.getUserAgent().replace(/\sElectron\/[^\s]+/i, '');
    this.loginSession.setUserAgent(userAgent);
  }

  async status(site: LoginSite): Promise<SiteLoginStatus> {
    const cookies = cookiesForSite(await this.loginSession.cookies.get({}), site);
    return { site, signedIn: loginCookiePresent(cookies, site) };
  }

  async open(site: LoginSite, parent: BrowserWindow): Promise<SiteLoginStatus> {
    const existing = this.windows.get(site);
    if (existing && !existing.isDestroyed()) {
      if (!this.hidden) {
        existing.show();
        existing.focus();
      }
      return new Promise((resolve) =>
        existing.once('closed', () => void this.status(site).then(resolve)),
      );
    }

    const config = SITE_CONFIG[site];
    const loginWindow = new BrowserWindow({
      parent,
      title: config.title,
      width: 1080,
      height: 760,
      minWidth: 640,
      minHeight: 520,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: LOGIN_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    if (this.hidden) loginWindow.webContents.setAudioMuted(true);
    this.windows.set(site, loginWindow);
    const isAllowed = (value: string) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          config.navigationDomains.some((domain) => domainMatches(url.hostname, domain))
        );
      } catch {
        return false;
      }
    };
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowed(url)) void loginWindow.loadURL(url);
      return { action: 'deny' };
    });
    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) event.preventDefault();
    });
    loginWindow.webContents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame && !isAllowed(details.url)) details.preventDefault();
    });
    loginWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
    loginWindow.once('ready-to-show', () => {
      if (!this.hidden) loginWindow.show();
    });
    const closed = new Promise<void>((resolve) => {
      loginWindow.once('closed', () => {
        this.windows.delete(site);
        resolve();
      });
    });
    try {
      await loginWindow.loadURL(config.startUrl);
    } catch (error) {
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
      await closed;
      throw error;
    }
    await closed;
    await this.loginSession.cookies.flushStore();
    return this.status(site);
  }

  async clear(site: LoginSite): Promise<SiteLoginStatus> {
    const cookies = cookiesForSite(await this.loginSession.cookies.get({}), site);
    await Promise.all(
      cookies.map((cookie) => {
        const host = normalizedDomain(cookie.domain ?? '');
        return this.loginSession.cookies.remove(
          `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
          cookie.name,
        );
      }),
    );
    await this.loginSession.cookies.flushStore();
    return this.status(site);
  }

  async withCookieFile<T>(
    rawUrl: string,
    enabled: boolean,
    operation: (cookieFile?: string) => Promise<T>,
  ): Promise<T> {
    const site = enabled ? loginSiteForUrl(rawUrl) : null;
    if (!site) return operation();
    const directory = await mkdtemp(join(tmpdir(), 'cueweave-site-auth-'));
    const cookieFile = join(directory, 'cookies.txt');
    try {
      const cookies = cookiesForSite(await this.loginSession.cookies.get({}), site);
      await writeFile(cookieFile, netscapeCookieFile(cookies), { encoding: 'utf8', mode: 0o600 });
      return await operation(cookieFile);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  dispose(): void {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.windows.clear();
  }
}
