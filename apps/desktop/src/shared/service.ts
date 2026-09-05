import type { DesktopErrorCode, LinkImportProgress, LinkPreview, MediaProbe } from './bridge';

export type ServiceMethod =
  | 'project'
  | 'health'
  | 'storageCheck'
  | 'probeMedia'
  | 'extractAudio'
  | 'inspectLink'
  | 'fetchSubtitle'
  | 'downloadLink'
  | 'cancellationCheck'
  | 'cancel'
  | 'shutdown'
  | 'crashForTest';

export interface ServiceRequest {
  kind: 'request';
  id: string;
  generation: number;
  method: ServiceMethod;
  payload: unknown;
}

export interface ServiceResponse {
  kind: 'response';
  id: string;
  generation: number;
  ok: boolean;
  value?: unknown;
  error?: string;
  errorCode?: DesktopErrorCode;
}

export interface ServiceEvent {
  kind: 'event';
  id: string;
  generation: number;
  event: 'downloadProgress';
  value: Omit<LinkImportProgress, 'jobId'>;
}

export interface ServiceReady {
  kind: 'ready';
  generation: number;
  pid: number;
}

export interface ServiceHealth {
  generation: number;
  pid: number;
}

export interface StorageCheck {
  token: string;
  reopened: boolean;
}

export interface ProbeRequest {
  inputPath: string;
}

export interface ExtractAudioRequest {
  inputPath: string;
  outputPath: string;
}

export interface CancelRequest {
  targetId: string;
}

export interface DownloadedMedia {
  path: string;
  title: string;
  kind: 'direct' | 'website';
}

export interface InspectedLink extends LinkPreview {
  resolvedUrl?: string;
  resolvedMime?: string;
  resolvedVariants?: ResolvedPlaybackVariant[];
  resolvedSubtitles?: ResolvedSubtitleTrack[];
}

export interface ResolvedPlaybackVariant {
  id: string;
  label: string;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec: string;
  video: ResolvedMediaStream;
  audio?: ResolvedMediaStream;
}

export interface ResolvedSubtitleTrack {
  language: string;
  label: string;
  kind: 'manual' | 'automatic';
}

export interface SubtitleRequest extends ResolvedSubtitleTrack {
  url: string;
  cookieFile?: string;
}

export interface ResolvedMediaStream {
  url: string;
  mime: string;
  headers: Record<string, string>;
  size?: number;
}

export type ServiceValue =
  | ServiceHealth
  | StorageCheck
  | MediaProbe
  | InspectedLink
  | DownloadedMedia
  | { cancelled: boolean }
  | null;
