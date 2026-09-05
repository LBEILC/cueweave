import { SelectControl } from './components/SelectControl';
import {
  ArrowsOutIcon,
  InfoIcon,
  GearSixIcon,
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SpinnerGapIcon,
  SubtitlesIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AboutContent } from './components/AboutContent';
import { MediaImport } from './components/MediaImport';
import { formatBytes, formatDuration, loginSiteFromLink, parseSubtitle } from './media-display';
export { loginSiteFromLink, parseSubtitle } from './media-display';
import { WorkspaceDialog } from './components/WorkspaceDialog';
import { SubtitlePanel, type SubtitleCue } from './components/SubtitlePanel';
import { ProjectHeader, ProjectTools } from './components/ProjectTools';
import { CueEditor } from './components/CueEditor';
import { useProject } from './use-project';
import { SettingsPage } from './components/SettingsPage';
import type {
  AppInfo,
  LinkImportProgress,
  LinkPreview,
  MediaAsset,
  MediaProbe,
  PlayerState,
  SiteAuthMode,
} from '../../shared/bridge';

const idlePlayer: PlayerState = {
  phase: 'idle',
  positionSeconds: 0,
  speed: 1,
  volume: 100,
  muted: false,
  subtitleDelaySeconds: 0,
};

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [about, setAbout] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const aboutButtonRef = useRef<HTMLButtonElement>(null);
  const subtitleButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const linkJobRef = useRef('');
  const qualityResumeRef = useRef<{ positionSeconds: number; paused: boolean } | null>(null);
  const [editingCueId, setEditingCueId] = useState('');
  const mediaLoadGeneration = useRef(0);
  const projects = useProject(({ project, asset: openedAsset, probe: openedProbe }) => {
    mediaLoadGeneration.current++;
    setError('');
    qualityResumeRef.current = { positionSeconds: project.positionMs / 1000, paused: true };
    setAsset(openedAsset);
    setProbe(openedProbe);
    setOnlinePlayback(null);
    setMediaOrigin('local');
    setImportOpen(false);
    setPanelOpen(true);
    setEditingCueId('');
    setPlayer((current) => ({ ...current, subtitleDelaySeconds: 0 }));
  });
  const project = projects.project;
  const displayedCues = useMemo(
    () =>
      project
        ? project.cues.map((cue) => ({
            start: cue.startMs / 1000,
            end: cue.endMs / 1000,
            text: cue.text,
          }))
        : subtitleCues,
    [project?.cues, subtitleCues],
  );
  const editingCue = project?.cues.find((cue) => cue.id === editingCueId);
  const lastCheckpointRef = useRef(0);
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
          setImportOpen(false);
          setAsset(event.asset);
          projects.detach();
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
    if (!videoUrl || !video) {
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
  }, [videoUrl, audioUrl]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || (!asset && !onlinePlayback) || document.querySelector('dialog[open]'))
        return;
      if (event.key === 'Escape' && panelOpen && !document.fullscreenElement) {
        if (projects.dirty) return;
        setPanelOpen(false);
        subtitleButtonRef.current?.focus();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, button, [contenteditable=true]')) return;
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
  }, [
    settingsOpen,
    asset,
    onlinePlayback,
    player.positionSeconds,
    player.durationSeconds,
    fullscreen,
    panelOpen,
    projects.dirty,
  ]);

  async function inspect(nextAsset: MediaAsset) {
    const generation = ++mediaLoadGeneration.current;
    const result = await window.cueweave.probeMedia(nextAsset.id);
    if (generation !== mediaLoadGeneration.current) return;
    if (result.ok) setProbe(result.value);
    else setError('视频已打开，但暂时无法读取媒体信息。');
  }

  async function acceptFile(file: File | undefined) {
    if (!file || projects.busy || projects.dirty) return;
    setLoading(true);
    setError('');
    setProbe(null);
    try {
      const result = await window.cueweave.registerDroppedMedia(file);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setImportOpen(false);
      setAsset(result.value);
      projects.detach();
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
      setImportOpen(false);
      setAsset(result.value);
      projects.detach();
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
    projects.detach();
    setProbe(null);
    setSelectedVariantId(linkPreview.playback.defaultVariantId);
    setSelectedOnlineSubtitleId('');
    setSubtitleCues([]);
    setImportOpen(false);
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
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch {
      setError('无法切换全屏，请重试。');
    }
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
      setPanelOpen(true);
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
    setPanelOpen(true);
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
  const playerUnavailable = !videoUrl || player.phase === 'loading' || player.phase === 'error';
  const subtitleTimePosition = player.positionSeconds - player.subtitleDelaySeconds;
  const visibleSubtitle = displayedCues
    .filter((cue) => subtitleTimePosition >= cue.start && subtitleTimePosition < cue.end)
    .map((cue) => cue.text)
    .join('\n');

  const subtitleTools = (
    <>
      <p className="project-warning">
        {asset
          ? '创建项目后，可以编辑、保存和导出字幕。'
          : '下载视频并创建项目后，可以编辑、保存和导出字幕。'}
      </p>
      {playback && playback.subtitles.length > 0 && (
        <label>
          在线字幕
          <SelectControl
            aria-label="在线字幕"
            value={selectedOnlineSubtitleId}
            disabled={onlineSubtitleLoading}
            onChange={(event) => void loadOnlineSubtitle(event.target.value)}
          >
            <option value="">{onlineSubtitleLoading ? '正在加载…' : '关闭在线字幕'}</option>
            {playback.subtitles.map((subtitle) => (
              <option key={subtitle.id} value={subtitle.id}>
                {subtitle.label}
              </option>
            ))}
          </SelectControl>
        </label>
      )}
      <button type="button" className="quiet-button" onClick={() => void pickSubtitle()}>
        <SubtitlesIcon size={18} aria-hidden="true" />
        {player.subtitleName ? '更换字幕文件' : '加载字幕'}
      </button>
      {player.subtitleName && (
        <label>
          字幕偏移
          <SelectControl
            value={player.subtitleDelaySeconds}
            onChange={(event) => setSubtitleDelay(Number(event.target.value))}
          >
            <option value="-1">提前 1 秒</option>
            <option value="-0.5">提前 0.5 秒</option>
            <option value="0">无偏移</option>
            <option value="0.5">延后 0.5 秒</option>
            <option value="1">延后 1 秒</option>
          </SelectControl>
        </label>
      )}
    </>
  );
  const aboutContent = (
    <AboutContent
      info={info}
      loading={loading}
      error={error}
      openingLicense={openingLicense}
      openLicense={openLicense}
      loadInfo={loadInfo}
    />
  );
  const importContent = (
    <MediaImport
      loading={loading}
      dragging={dragging}
      linkUrl={linkUrl}
      linkPreview={linkPreview}
      linkJobId={linkJobId}
      linkProgress={linkProgress}
      inspectingLink={inspectingLink}
      authMode={authMode}
      siteSignedIn={siteSignedIn}
      openingLogin={openingLogin}
      clearingLogin={clearingLogin}
      currentLoginSite={currentLoginSite}
      error={error}
      pickMedia={pickMedia}
      acceptFile={acceptFile}
      inspectVideoLink={inspectVideoLink}
      setLinkUrl={setLinkUrl}
      setLinkPreview={setLinkPreview}
      setError={setError}
      setAuthMode={setAuthMode}
      openSiteLogin={openSiteLogin}
      clearSiteLogin={clearSiteLogin}
      startLinkPlayback={startLinkPlayback}
      startLinkImport={startLinkImport}
      cancelLinkImport={cancelLinkImport}
    />
  );
  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        if (settingsOpen) return;
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
        if (settingsOpen) return;
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
        <div className="header-actions" hidden={settingsOpen}>
          <ProjectHeader
            canCreate={Boolean(asset) && !linkJobId}
            hasProject={Boolean(project)}
            busy={loading || projects.busy || projects.dirty || Boolean(linkJobId)}
            run={(action) => {
              if (action === 'create' && asset) void projects.run({ action, mediaId: asset.id });
              else if (action === 'open') void projects.run({ action });
            }}
          />
          {(asset || onlinePlayback) && (
            <button
              type="button"
              className="quiet-button"
              disabled={projects.busy || projects.dirty}
              onClick={() => setImportOpen(true)}
            >
              <UploadSimpleIcon size={18} aria-hidden="true" />
              打开其他视频
            </button>
          )}
          <button
            ref={settingsButtonRef}
            type="button"
            className="quiet-button"
            onClick={() => {
              videoRef.current?.pause();
              audioRef.current?.pause();
              setSettingsOpen(true);
            }}
          >
            <GearSixIcon size={18} aria-hidden="true" />
            设置
          </button>
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
        </div>
      </header>
      <main id="main-content" className="workspace" hidden={settingsOpen}>
        {asset || onlinePlayback || project ? (
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
                <h1 id="media-title" title={project?.name ?? onlinePlayback?.title ?? asset?.name}>
                  {project?.name ?? onlinePlayback?.title ?? asset?.name}
                </h1>
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
                className="quiet-button"
                ref={subtitleButtonRef}
                aria-expanded={panelOpen}
                aria-controls="subtitle-panel"
                disabled={projects.dirty}
                onClick={() => setPanelOpen(!panelOpen)}
              >
                <SubtitlesIcon size={18} aria-hidden="true" />
                字幕
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
            <div className={`workspace-body${panelOpen ? ' has-panel' : ''}`}>
              <div className="playback-column">
                <div ref={stageRef} className="video-stage" aria-label="视频画面">
                  {project?.mediaMissing && (
                    <div className="missing-media">
                      <p>原视频已移动或内容发生变化。</p>
                      <button
                        className="primary-button"
                        disabled={projects.busy || projects.dirty}
                        onClick={() =>
                          void projects.run({
                            action: 'relink',
                            projectId: project.id,
                            baseRevision: project.revision,
                          })
                        }
                      >
                        重新定位原视频
                      </button>
                      <p>字幕仍可编辑和导出。</p>
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    src={videoUrl || undefined}
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
                      if (Date.now() - lastCheckpointRef.current > 5000) {
                        lastCheckpointRef.current = Date.now();
                        void projects.checkpoint(positionSeconds);
                      }
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
                      if (videoRef.current) void projects.checkpoint(videoRef.current.currentTime);
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
                    {player.phase === 'error' && (
                      <span>{player.error ?? '播放器未能加载视频。'}</span>
                    )}
                  </div>
                </div>
              </div>
              {panelOpen && (
                <SubtitlePanel
                  cues={displayedCues}
                  name={project?.trackName || player.subtitleName}
                  locked={projects.dirty || projects.busy}
                  onEdit={
                    project
                      ? (index) => {
                          setEditingCueId(project.cues[index]?.id ?? '');
                          videoRef.current?.pause();
                        }
                      : undefined
                  }
                  tools={
                    project && (
                      <ProjectTools
                        project={project}
                        busy={projects.busy || projects.dirty}
                        run={projects.run}
                      />
                    )
                  }
                  editor={
                    editingCue &&
                    project && (
                      <CueEditor
                        key={`${project.id}:${editingCue.id}:${project.revision}`}
                        cue={editingCue}
                        durationMs={project.durationMs}
                        busy={projects.busy}
                        onDirty={projects.setDirty}
                        onClose={() => setEditingCueId('')}
                        onSave={(cue) =>
                          projects.run({
                            action: 'edit',
                            projectId: project.id,
                            baseRevision: project.revision,
                            cue,
                          })
                        }
                      />
                    )
                  }
                  position={subtitleTimePosition}
                  onSeek={(seconds) => seekTo(seconds + player.subtitleDelaySeconds)}
                  onClose={() => {
                    setPanelOpen(false);
                    subtitleButtonRef.current?.focus();
                  }}
                >
                  {project ? (
                    <p>原始字幕保留在项目中。点击铅笔修改文本和时间，保存后自动写入项目。</p>
                  ) : (
                    subtitleTools
                  )}
                </SubtitlePanel>
              )}
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
                      <SelectControl
                        aria-label="清晰度"
                        value={selectedVariant?.id ?? ''}
                        onChange={(event) => changeQuality(event.target.value)}
                      >
                        {playback.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.label}
                          </option>
                        ))}
                      </SelectControl>
                    </label>
                  )}
                  <label>
                    播放速度
                    <SelectControl
                      value={rate}
                      onChange={(event) => changeRate(event.target.value)}
                    >
                      <option value="0.5">0.5×</option>
                      <option value="0.75">0.75×</option>
                      <option value="1">1×</option>
                      <option value="1.25">1.25×</option>
                      <option value="1.5">1.5×</option>
                      <option value="2">2×</option>
                    </SelectControl>
                  </label>
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
            {projects.error && (
              <p className="inline-error" role="alert">
                {projects.error}
              </p>
            )}
          </section>
        ) : (
          <div className="welcome-scroll">
            <div className="welcome-content">
              {projects.error && (
                <p className="inline-error" role="alert">
                  {projects.error}
                </p>
              )}
              {importContent}
            </div>
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsPage
          onClose={() => {
            setSettingsOpen(false);
            requestAnimationFrame(() => settingsButtonRef.current?.focus());
          }}
        />
      )}
      <footer className="workspace-status">
        <span>
          {asset || onlinePlayback || project
            ? `${project?.name ?? onlinePlayback?.source ?? '本地视频'}${displayedCues.length ? ` · ${displayedCues.length} 条字幕` : ''}`
            : '本地文件 · YouTube · 哔哩哔哩'}
        </span>
        {linkProgress ? (
          <button className="text-button" type="button" onClick={() => setImportOpen(true)}>
            下载进行中
            {linkProgress.downloadedBytes !== undefined
              ? ` · ${formatBytes(linkProgress.downloadedBytes)}`
              : ''}
          </button>
        ) : (
          <span>
            {projects.busy
              ? '正在处理项目…'
              : projects.dirty
                ? '有未保存的字幕修改'
                : project
                  ? projects.message || '已保存'
                  : player.phase === 'playing'
                    ? '正在播放'
                    : asset || onlinePlayback
                      ? '就绪'
                      : '字幕工作台'}
          </span>
        )}
      </footer>
      {about && (
        <WorkspaceDialog label="关于句织" onClose={goBack}>
          <div className="about-page">{aboutContent}</div>
        </WorkspaceDialog>
      )}
      {importOpen && (
        <WorkspaceDialog label="打开视频" onClose={() => setImportOpen(false)}>
          {importContent}
        </WorkspaceDialog>
      )}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          松开以打开视频
        </div>
      )}
    </div>
  );
}
