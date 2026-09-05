import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsOutIcon,
  FilmSlateIcon,
  InfoIcon,
  LinkIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SpinnerGapIcon,
  SubtitlesIcon,
  UploadSimpleIcon,
  UserCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type {
  AppInfo,
  LinkImportProgress,
  LinkPreview,
  LoginSite,
  MediaAsset,
  MediaProbe,
  PlayerState,
  SiteAuthMode,
} from '../../shared/bridge';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '时长未知';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function loginSiteFromLink(rawUrl: string): LoginSite | null {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be')
      return 'youtube';
    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili';
    return null;
  } catch {
    return null;
  }
}

function loginSiteName(site: LoginSite): string {
  return site === 'youtube' ? 'YouTube' : '哔哩哔哩';
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function subtitleTime(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part)))
    return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (hours === undefined || minutes === undefined || seconds === undefined) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseSubtitle(content: string): SubtitleCue[] {
  const blocks = content
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const match = /^\s*([^\s]+)\s*-->\s*([^\s]+)/.exec(lines[timingIndex] ?? '');
    const start = match?.[1] ? subtitleTime(match[1]) : null;
    const end = match?.[2] ? subtitleTime(match[2]) : null;
    const text = lines
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((left, right) => left.start - right.start);
}

const idlePlayer: PlayerState = {
  phase: 'idle',
  positionSeconds: 0,
  speed: 1,
  volume: 100,
  muted: false,
  subtitleDelaySeconds: 0,
};

export function App() {
  const [about, setAbout] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openingLicense, setOpeningLicense] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [onlinePlayback, setOnlinePlayback] = useState<LinkPreview | null>(null);
  const [linkJobId, setLinkJobId] = useState('');
  const [linkProgress, setLinkProgress] = useState<LinkImportProgress | null>(null);
  const [inspectingLink, setInspectingLink] = useState(false);
  const [authMode, setAuthMode] = useState<SiteAuthMode>('none');
  const [inspectedAuthMode, setInspectedAuthMode] = useState<SiteAuthMode>('none');
  const [siteSignedIn, setSiteSignedIn] = useState<boolean | null>(null);
  const [openingLogin, setOpeningLogin] = useState(false);
  const [clearingLogin, setClearingLogin] = useState(false);
  const [mediaOrigin, setMediaOrigin] = useState<'local' | 'network'>('local');
  const [rate, setRate] = useState('1');
  const [player, setPlayer] = useState<PlayerState>(idlePlayer);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedOnlineSubtitleId, setSelectedOnlineSubtitleId] = useState('');
  const [onlineSubtitleLoading, setOnlineSubtitleLoading] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const aboutButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const linkJobRef = useRef('');
  const qualityResumeRef = useRef<{ positionSeconds: number; paused: boolean } | null>(null);
  const playback = onlinePlayback?.playback;
  const selectedVariant =
    playback?.variants.find((variant) => variant.id === selectedVariantId) ?? playback?.variants[0];
  const videoUrl = asset?.url ?? selectedVariant?.videoUrl ?? '';
  const audioUrl = selectedVariant?.audioUrl;
  const currentLoginSite = loginSiteFromLink(linkUrl);

  async function loadInfo() {
    setLoading(true);
    setError('');
    try {
      const result = await window.cueweave.getAppInfo();
      if (result.ok) setInfo(result.value);
      else setError(result.error.message);
    } catch {
      setError('无法读取应用信息，请重试或重新打开应用。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (about) {
      titleRef.current?.focus();
      void loadInfo();
    }
  }, [about]);

  useEffect(() => {
    let active = true;
    setSiteSignedIn(null);
    if (!currentLoginSite) return () => undefined;
    void window.cueweave.getSiteLoginStatus(currentLoginSite).then((result) => {
      if (active) setSiteSignedIn(result.ok ? result.value.signedIn : null);
    });
    return () => {
      active = false;
    };
  }, [currentLoginSite]);

  useEffect(
    () =>
      window.cueweave.onLinkImportEvent((event) => {
        if (event.type === 'progress') {
          if (linkJobRef.current && event.value.jobId !== linkJobRef.current) return;
          setLinkProgress(event.value);
          return;
        }
        if (event.type === 'completed') {
          if (event.jobId !== linkJobRef.current) return;
          setAsset(event.asset);
          setOnlinePlayback(null);
          setProbe(event.probe);
          setMediaOrigin('network');
          setLinkJobId('');
          linkJobRef.current = '';
          setLinkProgress(null);
          setError('');
          return;
        }
        if (event.jobId !== linkJobRef.current) return;
        setLinkJobId('');
        linkJobRef.current = '';
        setLinkProgress(null);
        if (event.code !== 'CANCELLED') setError(event.message);
      }),
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (about || !videoUrl || !video) {
      setPlayer(idlePlayer);
      return;
    }
    setSeekValue(null);
    const resuming = Boolean(qualityResumeRef.current);
    if (resuming) setPlayer((current) => ({ ...current, phase: 'loading' }));
    else {
      setSubtitleCues([]);
      setSelectedOnlineSubtitleId('');
      setRate('1');
      setPlayer({ ...idlePlayer, phase: 'loading' });
    }
    const speed = resuming ? Number(rate) : 1;
    const volume = resuming ? player.volume / 100 : 1;
    const muted = resuming ? player.muted : false;
    video.playbackRate = speed;
    video.volume = volume;
    video.muted = Boolean(audioUrl) || muted;
    if (audio) {
      audio.playbackRate = speed;
      audio.volume = volume;
      audio.muted = muted;
    }
    const start = async () => {
      try {
        await video.play();
      } catch {
        setPlayer((current) => ({ ...current, phase: 'paused' }));
      }
    };
    void start();
    return () => {
      video.pause();
      audio?.pause();
    };
  }, [about, videoUrl, audioUrl]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!asset && !onlinePlayback) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, button')) return;
      if (event.key === ' ') {
        event.preventDefault();
        void togglePause();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekTo(Math.max(0, player.positionSeconds - 5));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekTo(Math.min(player.durationSeconds ?? Infinity, player.positionSeconds + 5));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [asset, onlinePlayback, player.positionSeconds, player.durationSeconds, fullscreen]);

  async function inspect(nextAsset: MediaAsset) {
    const result = await window.cueweave.probeMedia(nextAsset.id);
    if (result.ok) setProbe(result.value);
    else setError('视频已打开，但暂时无法读取媒体信息。');
  }

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError('');
    setProbe(null);
    try {
      const result = await window.cueweave.registerDroppedMedia(file);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAsset(result.value);
      setOnlinePlayback(null);
      setMediaOrigin('local');
      await inspect(result.value);
    } catch {
      setError('无法打开这个视频，请重试。');
    } finally {
      setLoading(false);
    }
  }

  async function pickMedia() {
    setLoading(true);
    setError('');
    try {
      const result = await window.cueweave.pickMedia();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (!result.value) return;
      setProbe(null);
      setAsset(result.value);
      setOnlinePlayback(null);
      setMediaOrigin('local');
      await inspect(result.value);
    } catch {
      setError('无法打开这个视频，请重试。');
    } finally {
      setLoading(false);
    }
  }

  async function inspectVideoLink() {
    if (!linkUrl.trim()) {
      setError('请输入视频链接。');
      return;
    }
    setInspectingLink(true);
    setError('');
    setLinkPreview(null);
    try {
      const result = await window.cueweave.inspectLink(linkUrl, authMode);
      if (result.ok) {
        setLinkPreview(result.value);
        setInspectedAuthMode(authMode);
      } else setError(result.error.message);
    } catch {
      setError('无法读取这个链接，请检查网络后重试。');
    } finally {
      setInspectingLink(false);
    }
  }

  async function startLinkImport() {
    if (!linkPreview) return;
    setError('');
    setLinkProgress({ jobId: '', phase: 'starting' });
    const result = await window.cueweave.startLinkImport(linkPreview.url, inspectedAuthMode);
    if (result.ok) {
      linkJobRef.current = result.value.jobId;
      setLinkJobId(result.value.jobId);
      setLinkProgress({ jobId: result.value.jobId, phase: 'starting' });
    } else {
      setLinkProgress(null);
      setError(result.error.message);
    }
  }

  async function openSiteLogin() {
    if (!currentLoginSite) return;
    setOpeningLogin(true);
    setError('');
    try {
      const result = await window.cueweave.openSiteLogin(currentLoginSite);
      if (result.ok) {
        setSiteSignedIn(result.value.signedIn);
        setLinkPreview(null);
      } else setError(result.error.message);
    } catch {
      setError('登录窗口未完成，请重试。');
    } finally {
      setOpeningLogin(false);
    }
  }

  async function clearSiteLogin() {
    if (!currentLoginSite) return;
    setClearingLogin(true);
    setError('');
    try {
      const result = await window.cueweave.clearSiteLogin(currentLoginSite);
      if (result.ok) {
        setSiteSignedIn(result.value.signedIn);
        setLinkPreview(null);
      } else setError(result.error.message);
    } catch {
      setError('无法清除登录状态，请重试。');
    } finally {
      setClearingLogin(false);
    }
  }

  function startLinkPlayback() {
    if (!linkPreview?.playback) {
      setError('暂时无法在线播放这个链接，可以尝试下载后打开。');
      return;
    }
    setAsset(null);
    setProbe(null);
    setSelectedVariantId(linkPreview.playback.defaultVariantId);
    setSelectedOnlineSubtitleId('');
    setSubtitleCues([]);
    setOnlinePlayback(linkPreview);
    setMediaOrigin('network');
    setError('');
  }

  async function cancelLinkImport() {
    if (!linkJobId) return;
    await window.cueweave.cancelLinkImport(linkJobId);
    linkJobRef.current = '';
    setLinkJobId('');
    setLinkProgress(null);
  }

  async function openLicense() {
    setOpeningLicense(true);
    setError('');
    try {
      const result = await window.cueweave.openFontLicense();
      if (!result.ok) setError('无法打开字体许可，请确认已安装 PDF 阅读器后重试。');
    } catch {
      setError('无法打开字体许可，请重新打开应用后重试。');
    } finally {
      setOpeningLicense(false);
    }
  }

  function goBack() {
    setAbout(false);
    setError('');
    aboutButtonRef.current?.focus();
  }

  function changeRate(value: string) {
    setRate(value);
    const speed = Number(value);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
    setPlayer((current) => ({ ...current, speed }));
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workspaceRef.current?.requestFullscreen();
  }

  function commitSeek(positionSeconds: number) {
    setSeekValue(null);
    seekTo(positionSeconds);
  }

  function seekTo(positionSeconds: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(positionSeconds)) return;
    const duration = Number.isFinite(video.duration) ? video.duration : positionSeconds;
    const next = Math.max(0, Math.min(duration, positionSeconds));
    video.currentTime = next;
    if (audioRef.current) audioRef.current.currentTime = next;
    setPlayer((current) => ({ ...current, positionSeconds: next }));
  }

  async function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      if (video.ended) seekTo(0);
      await video
        .play()
        .catch(() =>
          setPlayer((current) => ({ ...current, phase: 'error', error: '无法继续播放视频。' })),
        );
    } else video.pause();
  }

  function syncAudio(force = false) {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    if (force || Math.abs(audio.currentTime - video.currentTime) > 0.3)
      audio.currentTime = video.currentTime;
    audio.playbackRate = video.playbackRate;
    if (!video.paused && !video.ended) void audio.play().catch(() => {});
  }

  function setVolume(volume: number) {
    const normalized = Math.max(0, Math.min(100, volume));
    const target = audioRef.current ?? videoRef.current;
    if (target) target.volume = normalized / 100;
    setPlayer((current) => ({ ...current, volume: normalized }));
  }

  function toggleMute() {
    const muted = !player.muted;
    const target = audioRef.current ?? videoRef.current;
    if (target) target.muted = muted;
    setPlayer((current) => ({ ...current, muted }));
  }

  function setSubtitleDelay(delay: number) {
    setPlayer((current) => ({ ...current, subtitleDelaySeconds: delay }));
  }

  function changeQuality(id: string) {
    const video = videoRef.current;
    if (!video || id === selectedVariant?.id) return;
    qualityResumeRef.current = {
      positionSeconds: video.currentTime,
      paused: video.paused,
    };
    setSelectedVariantId(id);
  }

  async function loadOnlineSubtitle(id: string) {
    setSelectedOnlineSubtitleId(id);
    if (!id) {
      setSubtitleCues([]);
      setPlayer((current) => {
        const next = { ...current };
        delete next.subtitleName;
        return next;
      });
      return;
    }
    setOnlineSubtitleLoading(true);
    setSubtitleCues([]);
    setError('');
    try {
      const result = await window.cueweave.loadOnlineSubtitle(id);
      if (!result.ok) {
        setSelectedOnlineSubtitleId('');
        setError('在线字幕未能加载，请稍后重试。');
        return;
      }
      const cues = parseSubtitle(result.value.content);
      if (!cues.length) {
        setSelectedOnlineSubtitleId('');
        setError('所选在线字幕没有可用内容。');
        return;
      }
      setSubtitleCues(cues);
      setPlayer((current) => ({
        ...current,
        subtitleName: result.value.name,
        subtitleDelaySeconds: 0,
      }));
    } catch {
      setSelectedOnlineSubtitleId('');
      setError('在线字幕未能加载，请稍后重试。');
    } finally {
      setOnlineSubtitleLoading(false);
    }
  }

  async function pickSubtitle() {
    const result = await window.cueweave.pickPlayerSubtitle();
    if (!result.ok) {
      setError('字幕未能加载，请使用 SRT 或 WebVTT 文件。');
      return;
    }
    if (!result.value) return;
    const subtitle = result.value;
    const cues = parseSubtitle(subtitle.content);
    if (!cues.length) {
      setError('没有在字幕文件中找到可用的字幕。');
      return;
    }
    setSubtitleCues(cues);
    setSelectedOnlineSubtitleId('');
    setPlayer((current) => ({
      ...current,
      subtitleName: subtitle.name,
      subtitleDelaySeconds: 0,
    }));
    setError('');
  }

  const duration =
    player.durationSeconds ?? onlinePlayback?.durationSeconds ?? probe?.durationSeconds ?? 0;
  const displayedPosition = Math.min(seekValue ?? player.positionSeconds, duration || Infinity);
  const playerUnavailable = player.phase === 'loading' || player.phase === 'error';
  const subtitleTimePosition = player.positionSeconds - player.subtitleDelaySeconds;
  const visibleSubtitle = subtitleCues.find(
    (cue) => subtitleTimePosition >= cue.start && subtitleTimePosition <= cue.end,
  )?.text;

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void acceptFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="app-header">
        <div className="brand" aria-label="CueWeave 句织">
          <img src="/cueweave-mark-paper.svg" alt="" width="32" height="32" />
          <strong>句织</strong>
          <span>CueWeave</span>
        </div>
        <button
          ref={aboutButtonRef}
          type="button"
          className="quiet-button"
          aria-pressed={about}
          onClick={() => setAbout(true)}
        >
          <InfoIcon size={18} aria-hidden="true" />
          关于
        </button>
      </header>
      <main id="main-content" className={about ? 'about-page' : 'workspace'}>
        {about ? (
          <>
            <button type="button" className="quiet-button back-button" onClick={goBack}>
              <ArrowLeftIcon size={18} aria-hidden="true" />
              返回工作台
            </button>
            <h1 ref={titleRef} tabIndex={-1}>
              关于句织
            </h1>
            <p className="about-intro">CueWeave · 字幕工作台</p>
            <dl className="app-info" aria-busy={loading}>
              <div>
                <dt>版本</dt>
                <dd>{info?.version ?? (loading ? '正在读取…' : '未能读取')}</dd>
              </div>
              <div>
                <dt>软件许可</dt>
                <dd>MIT</dd>
              </div>
            </dl>
            <section aria-labelledby="third-party-title" className="notices">
              <h2 id="third-party-title">第三方声明</h2>
              <p>
                MiSans 字体
                <br />
                <span>Copyright Xiaomi Technology Co., Ltd.</span>
              </p>
              <button
                type="button"
                className="text-button"
                disabled={openingLicense}
                onClick={() => void openLicense()}
              >
                {openingLicense ? '正在打开…' : '阅读 MiSans 字体许可'}
                <ArrowSquareOutIcon size={16} aria-hidden="true" />
              </button>
              <p>
                FFmpeg 与 ffprobe
                <br />
                <span>GNU General Public License v3</span>
              </p>
              <p>
                yt-dlp
                <br />
                <span>Unlicense · 随包组件许可证见安装目录</span>
              </p>
              <p>
                Deno
                <br />
                <span>Copyright 2018–2026 the Deno authors · MIT</span>
              </p>
              <p>
                Phosphor Icons
                <br />
                <span>Copyright © 2020 Phosphor Icons · MIT</span>
              </p>
            </section>
            {error && (
              <div className="error-message" role="alert">
                <p>{error}</p>
                {!info && (
                  <button type="button" disabled={loading} onClick={() => void loadInfo()}>
                    重新读取
                  </button>
                )}
              </div>
            )}
          </>
        ) : asset || onlinePlayback ? (
          <section
            ref={workspaceRef}
            className={`player-workspace${fullscreen ? ' is-fullscreen' : ''}`}
            aria-labelledby="media-title"
          >
            <div className="media-heading">
              <div>
                <p className="eyebrow">
                  {onlinePlayback
                    ? '在线播放'
                    : mediaOrigin === 'network'
                      ? '链接视频'
                      : '本地视频'}
                </p>
                <h1 id="media-title">{onlinePlayback?.title ?? asset?.name}</h1>
                <p className="media-meta">
                  {onlinePlayback ? (
                    <>
                      {onlinePlayback.source}
                      {onlinePlayback.durationSeconds !== undefined
                        ? ` · ${formatDuration(onlinePlayback.durationSeconds)}`
                        : ''}
                    </>
                  ) : (
                    <>
                      {asset?.size !== undefined ? formatBytes(asset.size) : '大小未知'}
                      {probe ? ` · ${formatDuration(probe.durationSeconds)}` : ''}
                      {probe?.tracks.find((track) => track.type === 'video')?.codec
                        ? ` · ${probe.tracks.find((track) => track.type === 'video')?.codec.toUpperCase()}`
                        : ''}
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setAsset(null);
                  setOnlinePlayback(null);
                  setProbe(null);
                  setError('');
                }}
              >
                打开其他视频
              </button>
              <label className="file-input-label">
                从文件选择器更换
                <input
                  type="file"
                  accept="video/*,.mkv,.avi"
                  aria-label="选择视频文件"
                  onChange={(event) => void acceptFile(event.target.files?.[0])}
                />
              </label>
            </div>
            <div ref={stageRef} className="video-stage" aria-label="视频画面">
              <video
                ref={videoRef}
                src={videoUrl}
                autoPlay
                playsInline
                preload="auto"
                muted={Boolean(audioUrl) || player.muted}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  setPlayer((current) => ({
                    ...current,
                    ...(Number.isFinite(duration) && duration > 0
                      ? { durationSeconds: duration }
                      : {}),
                  }));
                  const resume = qualityResumeRef.current;
                  if (resume) {
                    const position = Number.isFinite(duration)
                      ? Math.min(resume.positionSeconds, duration)
                      : resume.positionSeconds;
                    event.currentTarget.currentTime = position;
                    if (audioRef.current) audioRef.current.currentTime = position;
                    qualityResumeRef.current = null;
                    if (resume.paused) event.currentTarget.pause();
                    else void event.currentTarget.play().catch(() => {});
                  }
                  syncAudio(true);
                }}
                onDurationChange={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration) && duration > 0)
                    setPlayer((current) => ({ ...current, durationSeconds: duration }));
                }}
                onTimeUpdate={(event) => {
                  const positionSeconds = event.currentTarget.currentTime;
                  setPlayer((current) => ({ ...current, positionSeconds }));
                  syncAudio();
                }}
                onPlaying={() => {
                  setPlayer((current) => {
                    const next: PlayerState = { ...current, phase: 'playing' };
                    delete next.error;
                    return next;
                  });
                  syncAudio(true);
                }}
                onPause={() => {
                  audioRef.current?.pause();
                  setPlayer((current) => ({
                    ...current,
                    phase: videoRef.current?.ended ? 'ended' : 'paused',
                  }));
                }}
                onWaiting={() => {
                  audioRef.current?.pause();
                  setPlayer((current) => ({ ...current, phase: 'loading' }));
                }}
                onSeeking={() => syncAudio(true)}
                onSeeked={() => syncAudio(true)}
                onEnded={() => {
                  audioRef.current?.pause();
                  setPlayer((current) => ({ ...current, phase: 'ended' }));
                }}
                onError={() =>
                  setPlayer((current) => ({
                    ...current,
                    phase: 'error',
                    error: '视频流加载失败，请检查网络后重试。',
                  }))
                }
              />
              {audioUrl && (
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  autoPlay
                  preload="auto"
                  muted={player.muted}
                  aria-hidden="true"
                  onCanPlay={() => syncAudio()}
                  onError={() =>
                    setPlayer((current) => ({
                      ...current,
                      phase: 'error',
                      error: '音频流加载失败，请检查网络后重试。',
                    }))
                  }
                />
              )}
              {visibleSubtitle && <div className="subtitle-overlay">{visibleSubtitle}</div>}
              <div className="player-status" role="status" aria-live="polite">
                {player.phase === 'loading' && (
                  <>
                    <SpinnerGapIcon size={26} className="spin" aria-hidden="true" />
                    <span>正在准备播放…</span>
                  </>
                )}
                {player.phase === 'error' && <span>{player.error ?? '播放器未能加载视频。'}</span>}
              </div>
            </div>
            <div className="player-controls">
              <div className="transport-row">
                <button
                  type="button"
                  className="player-icon-button"
                  aria-label={
                    player.phase === 'paused' || player.phase === 'ended' ? '播放' : '暂停'
                  }
                  disabled={playerUnavailable}
                  onClick={() => void togglePause()}
                >
                  {player.phase === 'paused' || player.phase === 'ended' ? (
                    <PlayIcon size={19} weight="fill" aria-hidden="true" />
                  ) : (
                    <PauseIcon size={19} weight="fill" aria-hidden="true" />
                  )}
                </button>
                <span className="time-readout">
                  {formatDuration(displayedPosition)} / {formatDuration(duration || undefined)}
                </span>
                <input
                  className="seek-control"
                  type="range"
                  aria-label="播放进度"
                  min="0"
                  max={Math.max(1, duration)}
                  step="0.05"
                  value={Math.min(displayedPosition, Math.max(1, duration))}
                  disabled={!duration || playerUnavailable}
                  onChange={(event) => setSeekValue(Number(event.target.value))}
                  onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                  onKeyUp={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                      commitSeek(Number(event.currentTarget.value));
                  }}
                />
                <button
                  type="button"
                  className="player-icon-button"
                  aria-label={player.muted ? '取消静音' : '静音'}
                  disabled={playerUnavailable}
                  onClick={toggleMute}
                >
                  {player.muted ? (
                    <SpeakerSlashIcon size={19} aria-hidden="true" />
                  ) : (
                    <SpeakerHighIcon size={19} aria-hidden="true" />
                  )}
                </button>
                <input
                  className="volume-control"
                  type="range"
                  aria-label="音量"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(player.volume)}
                  disabled={playerUnavailable}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </div>
              <div className="player-tools">
                <div className="player-tool-group">
                  {playback && playback.variants.length > 1 && (
                    <label>
                      清晰度
                      <select
                        aria-label="清晰度"
                        value={selectedVariant?.id ?? ''}
                        onChange={(event) => changeQuality(event.target.value)}
                      >
                        {playback.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    播放速度
                    <select value={rate} onChange={(event) => changeRate(event.target.value)}>
                      <option value="0.5">0.5×</option>
                      <option value="0.75">0.75×</option>
                      <option value="1">1×</option>
                      <option value="1.25">1.25×</option>
                      <option value="1.5">1.5×</option>
                      <option value="2">2×</option>
                    </select>
                  </label>
                  {playback && playback.subtitles.length > 0 && (
                    <label>
                      在线字幕
                      <select
                        aria-label="在线字幕"
                        value={selectedOnlineSubtitleId}
                        disabled={onlineSubtitleLoading}
                        onChange={(event) => void loadOnlineSubtitle(event.target.value)}
                      >
                        <option value="">
                          {onlineSubtitleLoading ? '正在加载…' : '关闭在线字幕'}
                        </option>
                        {playback.subtitles.map((subtitle) => (
                          <option key={subtitle.id} value={subtitle.id}>
                            {subtitle.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => void pickSubtitle()}
                  >
                    <SubtitlesIcon size={18} aria-hidden="true" />
                    {selectedOnlineSubtitleId
                      ? '加载本地字幕'
                      : (player.subtitleName ?? '加载字幕')}
                  </button>
                  {player.subtitleName && (
                    <label>
                      字幕偏移
                      <select
                        value={player.subtitleDelaySeconds}
                        onChange={(event) => setSubtitleDelay(Number(event.target.value))}
                      >
                        <option value="-1">提前 1 秒</option>
                        <option value="-0.5">提前 0.5 秒</option>
                        <option value="0">无偏移</option>
                        <option value="0.5">延后 0.5 秒</option>
                        <option value="1">延后 1 秒</option>
                      </select>
                    </label>
                  )}
                </div>
                <button type="button" className="quiet-button" onClick={toggleFullscreen}>
                  <ArrowsOutIcon size={18} aria-hidden="true" />
                  {fullscreen ? '退出全屏' : '全屏'}
                </button>
              </div>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        ) : (
          <section
            className={`workspace-empty${dragging ? ' is-dragging' : ''}`}
            aria-labelledby="workspace-title"
          >
            <div className="empty-icon" aria-hidden="true">
              {loading ? (
                <SpinnerGapIcon size={30} className="spin" />
              ) : (
                <FilmSlateIcon size={30} />
              )}
            </div>
            <p className="eyebrow">字幕工作台</p>
            <h1 id="workspace-title">打开一个视频开始工作</h1>
            <p className="empty-description">
              可打开 MP4、WebM、MOV、MKV 和 AVI；能否直接播放取决于文件编码。也可以把文件拖到这里。
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={loading}
              onClick={() => void pickMedia()}
            >
              <UploadSimpleIcon size={18} weight="bold" aria-hidden="true" />
              {loading ? '正在打开…' : '打开视频'}
            </button>
            <label className="file-input-label">
              从文件选择器打开
              <input
                type="file"
                accept="video/*,.mkv,.avi"
                aria-label="选择视频文件"
                onChange={(event) => void acceptFile(event.target.files?.[0])}
              />
            </label>
            <div className="import-divider">
              <span>或</span>
            </div>
            <form
              className="link-import"
              onSubmit={(event) => {
                event.preventDefault();
                void inspectVideoLink();
              }}
            >
              <label htmlFor="video-link">视频链接</label>
              <div className="link-input-row">
                <div className="link-input-wrap">
                  <LinkIcon size={18} aria-hidden="true" />
                  <input
                    id="video-link"
                    type="url"
                    value={linkUrl}
                    disabled={Boolean(linkJobId)}
                    placeholder="粘贴视频直链、YouTube 或哔哩哔哩单视频链接"
                    autoComplete="off"
                    onChange={(event) => {
                      setLinkUrl(event.target.value);
                      setLinkPreview(null);
                      setError('');
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={inspectingLink || Boolean(linkJobId)}
                >
                  {inspectingLink ? '正在读取…' : '读取链接'}
                </button>
              </div>
              <div className="login-source">
                <label htmlFor="login-source">网站账号</label>
                <select
                  id="login-source"
                  value={authMode}
                  disabled={inspectingLink || Boolean(linkJobId)}
                  onChange={(event) => {
                    setAuthMode(event.target.value as SiteAuthMode);
                    setLinkPreview(null);
                    setError('');
                  }}
                >
                  <option value="none">不使用登录</option>
                  <option value="app">使用句织登录</option>
                </select>
                {authMode === 'none' ? (
                  <span>公开内容会直接读取。</span>
                ) : currentLoginSite ? (
                  <div className="account-actions">
                    <span
                      className={siteSignedIn ? 'account-status is-signed-in' : 'account-status'}
                    >
                      {siteSignedIn === null
                        ? '正在检查登录状态…'
                        : siteSignedIn
                          ? `已登录 · ${loginSiteName(currentLoginSite)}`
                          : `未登录 · ${loginSiteName(currentLoginSite)}`}
                    </span>
                    <button
                      type="button"
                      className="quiet-button account-button"
                      disabled={openingLogin || clearingLogin || Boolean(linkJobId)}
                      onClick={() => void openSiteLogin()}
                    >
                      <UserCircleIcon size={17} aria-hidden="true" />
                      {openingLogin ? '登录窗口已打开' : siteSignedIn ? '重新登录' : '打开登录窗口'}
                    </button>
                    {siteSignedIn && (
                      <button
                        type="button"
                        className="text-button account-clear"
                        disabled={clearingLogin || openingLogin}
                        onClick={() => void clearSiteLogin()}
                      >
                        {clearingLogin ? '正在清除…' : '清除登录'}
                      </button>
                    )}
                  </div>
                ) : (
                  <span>输入 YouTube 或哔哩哔哩链接后可登录。</span>
                )}
              </div>
            </form>
            {linkPreview && !linkProgress && (
              <div className="link-preview">
                <div>
                  <strong>{linkPreview.title}</strong>
                  <p>
                    {linkPreview.source}
                    {linkPreview.durationSeconds !== undefined
                      ? ` · ${formatDuration(linkPreview.durationSeconds)}`
                      : ''}
                    {linkPreview.sizeBytes !== undefined
                      ? ` · ${formatBytes(linkPreview.sizeBytes)}`
                      : ''}
                  </p>
                </div>
                <div className="link-preview-actions">
                  <button
                    type="button"
                    className="primary-button compact-button"
                    onClick={startLinkPlayback}
                  >
                    <PlayIcon size={18} weight="fill" aria-hidden="true" />
                    在线播放
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void startLinkImport()}
                  >
                    <DownloadSimpleIcon size={18} aria-hidden="true" />
                    下载
                  </button>
                </div>
              </div>
            )}
            {linkProgress && (
              <div className="download-status" aria-live="polite">
                <div className="download-copy">
                  <span>
                    {linkProgress.phase === 'starting'
                      ? '正在准备下载…'
                      : linkProgress.phase === 'processing'
                        ? '正在整理视频…'
                        : '正在下载视频…'}
                  </span>
                  {linkProgress.downloadedBytes !== undefined && (
                    <span>
                      {formatBytes(linkProgress.downloadedBytes)}
                      {linkProgress.totalBytes !== undefined
                        ? ` / ${formatBytes(linkProgress.totalBytes)}`
                        : ''}
                    </span>
                  )}
                </div>
                <progress
                  aria-label="视频下载进度"
                  {...(linkProgress.totalBytes && linkProgress.downloadedBytes !== undefined
                    ? { value: linkProgress.downloadedBytes, max: linkProgress.totalBytes }
                    : {})}
                />
                <button
                  type="button"
                  className="text-button cancel-button"
                  onClick={() => void cancelLinkImport()}
                >
                  <XIcon size={16} aria-hidden="true" />
                  取消下载
                </button>
              </div>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          松开以打开视频
        </div>
      )}
    </div>
  );
}
