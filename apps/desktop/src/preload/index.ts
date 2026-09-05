import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { DESKTOP_CHANNELS, desktopError } from '../shared/bridge';
import type { ProjectReply } from '../shared/project';
import type { SettingsReply } from '../shared/settings';
import type {
  AppInfo,
  DesktopBridge,
  DesktopResult,
  LinkImportEvent,
  LinkPreview,
  MediaAsset,
  MediaProbe,
  LoginSite,
  SiteAuthMode,
  SiteLoginStatus,
} from '../shared/bridge';

const bridge: DesktopBridge = {
  settingsCommand: (command) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.settings, command) as Promise<
        DesktopResult<SettingsReply>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  projectCommand: (command) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.project, command) as Promise<DesktopResult<ProjectReply>>
    ).catch(() => desktopError('UNAVAILABLE')),
  getAppInfo: () =>
    (ipcRenderer.invoke(DESKTOP_CHANNELS.appInfo, {}) as Promise<DesktopResult<AppInfo>>).catch(
      () => desktopError('UNAVAILABLE'),
    ),
  openFontLicense: () =>
    (ipcRenderer.invoke(DESKTOP_CHANNELS.fontLicense, {}) as Promise<DesktopResult<null>>).catch(
      () => desktopError('UNAVAILABLE'),
    ),
  pickMedia: () =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.mediaPick, {}) as Promise<
        DesktopResult<MediaAsset | null>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  registerDroppedMedia: (file: unknown) => {
    try {
      const path = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]);
      if (!path) return Promise.resolve(desktopError('INVALID_MEDIA'));
      return (
        ipcRenderer.invoke(DESKTOP_CHANNELS.mediaDrop, { path }) as Promise<
          DesktopResult<MediaAsset>
        >
      ).catch(() => desktopError('UNAVAILABLE'));
    } catch {
      return Promise.resolve(desktopError('INVALID_MEDIA'));
    }
  },
  probeMedia: (id: string) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.mediaProbe, { id }) as Promise<DesktopResult<MediaProbe>>
    ).catch(() => desktopError('UNAVAILABLE')),
  inspectLink: (url: string, authMode: SiteAuthMode) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.linkInspect, { url, authMode }) as Promise<
        DesktopResult<LinkPreview>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  startLinkImport: (url: string, authMode: SiteAuthMode) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.linkImportStart, { url, authMode }) as Promise<
        DesktopResult<{ jobId: string }>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  cancelLinkImport: (jobId: string) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.linkImportCancel, { jobId }) as Promise<
        DesktopResult<{ cancelled: boolean }>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  onLinkImportEvent: (listener: (event: LinkImportEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object' || !('type' in value)) return;
      listener(value as LinkImportEvent);
    };
    ipcRenderer.on(DESKTOP_CHANNELS.linkImportEvent, handler);
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.linkImportEvent, handler);
  },
  loadOnlineSubtitle: (id: string) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.onlineSubtitleLoad, { id }) as Promise<
        DesktopResult<{ name: string; content: string }>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  pickPlayerSubtitle: () =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.playerSubtitlePick, {}) as Promise<
        DesktopResult<{ name: string; content: string } | null>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  openSiteLogin: (site: LoginSite) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.siteLoginOpen, { site }) as Promise<
        DesktopResult<SiteLoginStatus>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  getSiteLoginStatus: (site: LoginSite) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.siteLoginStatus, { site }) as Promise<
        DesktopResult<SiteLoginStatus>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
  clearSiteLogin: (site: LoginSite) =>
    (
      ipcRenderer.invoke(DESKTOP_CHANNELS.siteLoginClear, { site }) as Promise<
        DesktopResult<SiteLoginStatus>
      >
    ).catch(() => desktopError('UNAVAILABLE')),
};

contextBridge.exposeInMainWorld('cueweave', bridge);
