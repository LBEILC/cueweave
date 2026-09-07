import type { ProjectCommand, ProjectReply } from './project';
import type { SettingsCommand, SettingsReply } from './settings';
import type {
  OnlineSubtitleSource,
  OnlineTranslationCommand,
  OnlineTranslationSnapshot,
} from './online-translation';
export const DESKTOP_CHANNELS = {
  onlineTranslation: 'cueweave:subtitle:online-translation',
  settings: 'cueweave:settings:command',
  project: 'cueweave:project:command',
  appInfo: 'cueweave:app:info',
  fontLicense: 'cueweave:app:font-license',
  mediaPick: 'cueweave:media:pick',
  mediaDrop: 'cueweave:media:drop',
  mediaProbe: 'cueweave:media:probe',
  mediaReveal: 'cueweave:media:reveal',
  linkInspect: 'cueweave:link:inspect',
  linkImportStart: 'cueweave:link:import-start',
  linkImportCancel: 'cueweave:link:import-cancel',
  linkImportEvent: 'cueweave:link:import-event',
  onlineSubtitleLoad: 'cueweave:subtitle:online-load',
  playerSubtitlePick: 'cueweave:player:subtitle-pick',
  siteLoginOpen: 'cueweave:site-login:open',
  siteLoginStatus: 'cueweave:site-login:status',
  siteLoginClear: 'cueweave:site-login:clear',
} as const;

export interface AppInfo {
  name: string;
  version: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  size?: number;
  url: string;
}

export type SiteAuthMode = 'none' | 'app';
export type LoginSite = 'youtube' | 'bilibili';

export interface SiteLoginStatus {
  site: LoginSite;
  signedIn: boolean;
}

export interface PlaybackVariant {
  id: string;
  label: string;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec: string;
  videoUrl: string;
  audioUrl?: string;
}

export interface OnlineSubtitleTrack {
  id: string;
  label: string;
  language: string;
  kind: 'manual' | 'automatic';
}

export interface LinkPlayback {
  kind: 'dom';
  variants: PlaybackVariant[];
  defaultVariantId: string;
  subtitles: OnlineSubtitleTrack[];
}

export interface MediaTrack {
  type: 'video' | 'audio' | 'subtitle' | 'other';
  codec: string;
  language?: string;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
  frameRate?: string;
  default?: boolean;
  rotation?: number;
}

export interface MediaProbe {
  durationSeconds?: number;
  startTimeSeconds?: number;
  format: string;
  tracks: MediaTrack[];
}

export interface LinkPreview {
  kind: 'direct' | 'website';
  url: string;
  title: string;
  source: string;
  durationSeconds?: number;
  sizeBytes?: number;
  playback?: LinkPlayback;
}

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerState {
  phase: PlayerPhase;
  positionSeconds: number;
  durationSeconds?: number;
  speed: number;
  volume: number;
  muted: boolean;
  subtitleDelaySeconds: number;
  subtitleName?: string;
  title?: string;
  error?: string;
}

export interface LinkImportProgress {
  jobId: string;
  phase: 'starting' | 'downloading' | 'processing';
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
}

export type LinkImportEvent =
  | { type: 'progress'; value: LinkImportProgress }
  | { type: 'completed'; jobId: string; asset: MediaAsset; probe: MediaProbe }
  | { type: 'failed'; jobId: string; code: DesktopErrorCode; message: string };

export type DesktopErrorCode =
  | 'SETTINGS_ERROR'
  | 'PROJECT_ERROR'
  | 'INVALID_REQUEST'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'INVALID_MEDIA'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_LINK'
  | 'NETWORK_ERROR'
  | 'TOO_LARGE'
  | 'CANCELLED';

export type DesktopResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: DesktopErrorCode;
        message: string;
      };
    };

export interface DesktopBridge {
  settingsCommand: (command: SettingsCommand) => Promise<DesktopResult<SettingsReply>>;
  projectCommand: (command: ProjectCommand) => Promise<DesktopResult<ProjectReply>>;
  getAppInfo: () => Promise<DesktopResult<AppInfo>>;
  openFontLicense: () => Promise<DesktopResult<null>>;
  pickMedia: () => Promise<DesktopResult<MediaAsset | null>>;
  registerDroppedMedia: (file: unknown) => Promise<DesktopResult<MediaAsset>>;
  probeMedia: (id: string) => Promise<DesktopResult<MediaProbe>>;
  revealMedia: (id: string) => Promise<DesktopResult<null>>;
  inspectLink: (url: string, authMode: SiteAuthMode) => Promise<DesktopResult<LinkPreview>>;
  startLinkImport: (
    url: string,
    authMode: SiteAuthMode,
  ) => Promise<DesktopResult<{ jobId: string }>>;
  cancelLinkImport: (jobId: string) => Promise<DesktopResult<{ cancelled: boolean }>>;
  onLinkImportEvent: (listener: (event: LinkImportEvent) => void) => () => void;
  loadOnlineSubtitle: (id: string) => Promise<DesktopResult<OnlineSubtitleSource>>;
  onlineTranslation: (
    command: OnlineTranslationCommand,
  ) => Promise<DesktopResult<OnlineTranslationSnapshot>>;
  pickPlayerSubtitle: () => Promise<DesktopResult<{ name: string; content: string } | null>>;
  openSiteLogin: (site: LoginSite) => Promise<DesktopResult<SiteLoginStatus>>;
  getSiteLoginStatus: (site: LoginSite) => Promise<DesktopResult<SiteLoginStatus>>;
  clearSiteLogin: (site: LoginSite) => Promise<DesktopResult<SiteLoginStatus>>;
}

// These actions have no renderer-controlled paths, channels, or options.
export function isEmptyRequest(value: unknown): value is Record<string, never> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.keys(value).length === 0
  );
}

export function desktopError(code: DesktopErrorCode): DesktopResult<never> {
  const messages = {
    SETTINGS_ERROR: '设置操作未完成，请重试。',
    PROJECT_ERROR: '项目操作未完成，请重试。',
    INVALID_REQUEST: '请求格式不正确，请重新打开窗口。',
    FORBIDDEN: '当前页面无法访问桌面功能，请重新打开应用。',
    UNAVAILABLE: '桌面操作未完成，请重试。',
    INVALID_MEDIA: '无法打开这个媒体文件，请选择常见的视频格式。',
    NOT_FOUND: '媒体授权已失效，请重新选择文件。',
    UNSUPPORTED_LINK: '暂不支持这个链接。请使用视频直链、YouTube 或哔哩哔哩单视频链接。',
    NETWORK_ERROR: '无法读取这个链接，请检查网络后重试。',
    TOO_LARGE: '视频超过 20 GB，无法下载。',
    CANCELLED: '下载已取消。',
  };
  return { ok: false, error: { code, message: messages[code] } };
}
