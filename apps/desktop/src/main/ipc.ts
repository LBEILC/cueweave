import { dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { DESKTOP_CHANNELS, desktopError, isEmptyRequest } from '../shared/bridge';
import type {
  AppInfo,
  DesktopResult,
  LinkPlayback,
  LoginSite,
  SiteAuthMode,
} from '../shared/bridge';
import type { DesktopErrorCode, LinkImportEvent } from '../shared/bridge';
import type { SubtitleRequest } from '../shared/service';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { isTrustedSender } from './security';
import type { MediaRegistry } from './media';
import { ServiceHostError } from './service-host';
import type { DesktopServiceHost } from './service-host';
import type { SiteAuthManager } from './site-auth';

export function registerAppIpc(options: {
  window: BrowserWindow;
  rendererUrl: string;
  appInfo: AppInfo;
  fontLicensePath: string;
  media: MediaRegistry;
  service: DesktopServiceHost;
  auth: SiteAuthManager;
}): () => void {
  const linkJobs = new Map<string, AbortController>();
  const onlineSubtitles = new Map<
    string,
    Omit<SubtitleRequest, 'cookieFile'> & { authMode: SiteAuthMode }
  >();

  function linkRequest(
    event: IpcMainInvokeEvent,
    request: unknown,
    key: 'url' | 'jobId' | 'id' | 'site',
  ): DesktopResult<never> | string {
    const rejected = guardSender(event);
    if (rejected) return rejected;
    const record = request as Record<string, unknown>;
    if (
      typeof request !== 'object' ||
      request === null ||
      Array.isArray(request) ||
      Object.keys(request).length !== 1 ||
      !(key in record) ||
      typeof record[key] !== 'string' ||
      record[key].length === 0 ||
      record[key].length > 4096
    ) {
      return desktopError('INVALID_REQUEST');
    }
    return record[key];
  }

  function sendLinkEvent(value: LinkImportEvent): void {
    if (!options.window.isDestroyed())
      options.window.webContents.send(DESKTOP_CHANNELS.linkImportEvent, value);
  }

  function authenticatedLinkRequest(
    event: IpcMainInvokeEvent,
    request: unknown,
  ): DesktopResult<never> | { url: string; authMode: SiteAuthMode } {
    const rejected = guardSender(event);
    if (rejected) return rejected;
    if (typeof request !== 'object' || request === null || Array.isArray(request))
      return desktopError('INVALID_REQUEST');
    const record = request as Record<string, unknown>;
    const authMode = record.authMode;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.url !== 'string' ||
      record.url.length === 0 ||
      record.url.length > 4096 ||
      (authMode !== 'none' && authMode !== 'app')
    ) {
      return desktopError('INVALID_REQUEST');
    }
    return { url: record.url, authMode };
  }

  function siteRequest(
    event: IpcMainInvokeEvent,
    request: unknown,
  ): DesktopResult<never> | LoginSite {
    const site = linkRequest(event, request, 'site');
    if (typeof site !== 'string') return site;
    return site === 'youtube' || site === 'bilibili' ? site : desktopError('INVALID_REQUEST');
  }

  function serviceErrorCode(error: unknown): DesktopErrorCode {
    return error instanceof ServiceHostError ? error.code : 'UNAVAILABLE';
  }
  function guardSender(event: IpcMainInvokeEvent): DesktopResult<never> | null {
    if (
      options.window.isDestroyed() ||
      !isTrustedSender(
        {
          windowId: event.sender.id,
          frameUrl: event.senderFrame?.url ?? '',
          isMainFrame: event.senderFrame === event.sender.mainFrame,
        },
        { windowId: options.window.webContents.id, rendererUrl: options.rendererUrl },
      )
    ) {
      return desktopError('FORBIDDEN');
    }
    return null;
  }

  function guardEmpty(event: IpcMainInvokeEvent, request: unknown): DesktopResult<never> | null {
    return guardSender(event) ?? (isEmptyRequest(request) ? null : desktopError('INVALID_REQUEST'));
  }

  ipcMain.handle(DESKTOP_CHANNELS.appInfo, (event, request: unknown) => {
    return guardEmpty(event, request) ?? { ok: true, value: options.appInfo };
  });
  ipcMain.handle(DESKTOP_CHANNELS.fontLicense, async (event, request: unknown) => {
    const rejected = guardEmpty(event, request);
    if (rejected) return rejected;
    try {
      const error = await shell.openPath(options.fontLicensePath);
      return error ? desktopError('UNAVAILABLE') : { ok: true, value: null };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.mediaPick, async (event, request: unknown) => {
    const rejected = guardEmpty(event, request);
    if (rejected) return rejected;
    const result = await dialog.showOpenDialog(options.window, {
      title: '打开视频',
      properties: ['openFile'],
      filters: [
        { name: '视频', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
    const asset = await options.media.register(result.filePaths[0]);
    return asset ? { ok: true, value: asset } : desktopError('INVALID_MEDIA');
  });
  ipcMain.handle(DESKTOP_CHANNELS.mediaDrop, async (event, request: unknown) => {
    const rejected = guardSender(event);
    if (rejected) return rejected;
    if (
      typeof request !== 'object' ||
      request === null ||
      Array.isArray(request) ||
      Object.keys(request).length !== 1 ||
      !('path' in request) ||
      typeof request.path !== 'string' ||
      request.path.length === 0
    ) {
      return desktopError('INVALID_REQUEST');
    }
    const asset = await options.media.register(request.path);
    return asset ? { ok: true, value: asset } : desktopError('INVALID_MEDIA');
  });
  ipcMain.handle(DESKTOP_CHANNELS.mediaProbe, async (event, request: unknown) => {
    const rejected = guardSender(event);
    if (rejected) return rejected;
    if (
      typeof request !== 'object' ||
      request === null ||
      Array.isArray(request) ||
      Object.keys(request).length !== 1 ||
      !('id' in request) ||
      typeof request.id !== 'string'
    ) {
      return desktopError('INVALID_REQUEST');
    }
    const path = options.media.getPath(request.id);
    if (!path) return desktopError('NOT_FOUND');
    try {
      return { ok: true, value: await options.service.probeMedia(path) };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.linkInspect, async (event, request: unknown) => {
    const value = authenticatedLinkRequest(event, request);
    if ('ok' in value) return value;
    try {
      const inspected = await options.auth.withCookieFile(
        value.url,
        value.authMode === 'app',
        (cookieFile) => options.service.inspectLink(value.url, cookieFile),
      );
      const { resolvedUrl, resolvedMime, resolvedVariants, resolvedSubtitles, ...preview } =
        inspected;
      let playback: LinkPlayback | null = null;
      onlineSubtitles.clear();
      if (preview.kind === 'direct') {
        const stream = options.media.registerRemote({
          url: resolvedUrl ?? preview.url,
          name: preview.title,
          ...(resolvedMime ? { mime: resolvedMime } : {}),
          ...(preview.sizeBytes !== undefined ? { size: preview.sizeBytes } : {}),
        });
        if (!stream) return desktopError('UNSUPPORTED_LINK');
        playback = {
          kind: 'dom',
          variants: [
            {
              id: 'direct',
              label: '原始画质',
              videoCodec: '原始',
              videoUrl: stream.url,
            },
          ],
          defaultVariantId: 'direct',
          subtitles: [],
        };
      } else if (resolvedVariants?.length) {
        const variants = options.media.registerRemoteVariants(preview.title, resolvedVariants);
        if (variants.length) {
          const subtitles = (resolvedSubtitles ?? []).map((subtitle) => {
            const id = randomUUID();
            onlineSubtitles.set(id, {
              ...subtitle,
              url: value.url,
              authMode: value.authMode,
            });
            return { id, ...subtitle };
          });
          playback = {
            kind: 'dom',
            variants,
            defaultVariantId: variants[0]?.id ?? '',
            subtitles,
          };
        }
      }
      if (!playback) return desktopError('UNSUPPORTED_LINK');
      return {
        ok: true,
        value: { ...preview, playback },
      };
    } catch (error) {
      return desktopError(serviceErrorCode(error));
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.linkImportStart, (event, request: unknown) => {
    const value = authenticatedLinkRequest(event, request);
    if ('ok' in value) return value;
    const jobId = randomUUID();
    const controller = new AbortController();
    linkJobs.set(jobId, controller);
    void options.auth
      .withCookieFile(value.url, value.authMode === 'app', (cookieFile) =>
        options.service.downloadLink(
          value.url,
          (value) => sendLinkEvent({ type: 'progress', value: { ...value, jobId } }),
          controller.signal,
          cookieFile,
        ),
      )
      .then(async (downloaded) => {
        if (controller.signal.aborted) return;
        const asset = await options.media.register(downloaded.path);
        if (!asset) throw new ServiceHostError('INVALID_MEDIA', 'Downloaded media is invalid');
        const probe = await options.service.probeMedia(downloaded.path);
        sendLinkEvent({ type: 'completed', jobId, asset, probe });
      })
      .catch((error: unknown) => {
        const code = controller.signal.aborted ? 'CANCELLED' : serviceErrorCode(error);
        const result = desktopError(code);
        if (!result.ok)
          sendLinkEvent({ type: 'failed', jobId, code, message: result.error.message });
      })
      .finally(() => linkJobs.delete(jobId));
    return { ok: true, value: { jobId } };
  });
  ipcMain.handle(DESKTOP_CHANNELS.onlineSubtitleLoad, async (event, request: unknown) => {
    const id = linkRequest(event, request, 'id');
    if (typeof id !== 'string') return id;
    const subtitle = onlineSubtitles.get(id);
    if (!subtitle) return desktopError('NOT_FOUND');
    try {
      const { authMode, ...request } = subtitle;
      return {
        ok: true,
        value: await options.auth.withCookieFile(request.url, authMode === 'app', (cookieFile) =>
          options.service.fetchSubtitle({
            ...request,
            ...(cookieFile ? { cookieFile } : {}),
          }),
        ),
      };
    } catch (error) {
      return desktopError(serviceErrorCode(error));
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.linkImportCancel, (event, request: unknown) => {
    const jobId = linkRequest(event, request, 'jobId');
    if (typeof jobId !== 'string') return jobId;
    const controller = linkJobs.get(jobId);
    controller?.abort();
    return { ok: true, value: { cancelled: Boolean(controller) } };
  });
  ipcMain.handle(DESKTOP_CHANNELS.playerSubtitlePick, async (event, request: unknown) => {
    const rejected = guardEmpty(event, request);
    if (rejected) return rejected;
    const result = await dialog.showOpenDialog(options.window, {
      title: '加载字幕',
      properties: ['openFile'],
      filters: [
        { name: '字幕', extensions: ['srt', 'vtt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { ok: true, value: null };
    try {
      if (!['.srt', '.vtt'].includes(extname(path).toLowerCase()))
        return desktopError('INVALID_MEDIA');
      const details = await stat(path);
      if (!details.isFile() || details.size < 1 || details.size > 4 * 1024 * 1024)
        return desktopError('INVALID_MEDIA');
      const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
      return { ok: true, value: { name: basename(path), content } };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.siteLoginOpen, async (event, request: unknown) => {
    const site = siteRequest(event, request);
    if (typeof site !== 'string') return site;
    try {
      return { ok: true, value: await options.auth.open(site, options.window) };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.siteLoginStatus, async (event, request: unknown) => {
    const site = siteRequest(event, request);
    if (typeof site !== 'string') return site;
    try {
      return { ok: true, value: await options.auth.status(site) };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  ipcMain.handle(DESKTOP_CHANNELS.siteLoginClear, async (event, request: unknown) => {
    const site = siteRequest(event, request);
    if (typeof site !== 'string') return site;
    try {
      return { ok: true, value: await options.auth.clear(site) };
    } catch {
      return desktopError('UNAVAILABLE');
    }
  });
  return () => {
    for (const controller of linkJobs.values()) controller.abort();
    linkJobs.clear();
    onlineSubtitles.clear();
    ipcMain.removeHandler(DESKTOP_CHANNELS.appInfo);
    ipcMain.removeHandler(DESKTOP_CHANNELS.fontLicense);
    ipcMain.removeHandler(DESKTOP_CHANNELS.mediaPick);
    ipcMain.removeHandler(DESKTOP_CHANNELS.mediaDrop);
    ipcMain.removeHandler(DESKTOP_CHANNELS.mediaProbe);
    ipcMain.removeHandler(DESKTOP_CHANNELS.linkInspect);
    ipcMain.removeHandler(DESKTOP_CHANNELS.linkImportStart);
    ipcMain.removeHandler(DESKTOP_CHANNELS.linkImportCancel);
    ipcMain.removeHandler(DESKTOP_CHANNELS.onlineSubtitleLoad);
    ipcMain.removeHandler(DESKTOP_CHANNELS.playerSubtitlePick);
    ipcMain.removeHandler(DESKTOP_CHANNELS.siteLoginOpen);
    ipcMain.removeHandler(DESKTOP_CHANNELS.siteLoginStatus);
    ipcMain.removeHandler(DESKTOP_CHANNELS.siteLoginClear);
  };
}
