import {
  FilmSlateIcon,
  SpinnerGapIcon,
  UploadSimpleIcon,
  LinkIcon,
  UserCircleIcon,
  PlayIcon,
  DownloadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type {
  LinkPreview,
  LinkImportProgress,
  SiteAuthMode,
  LoginSite,
} from '../../../shared/bridge';
import { formatBytes, formatDuration, loginSiteName } from '../media-display';
export function MediaImport({
  loading,
  dragging,
  linkUrl,
  linkPreview,
  linkJobId,
  linkProgress,
  inspectingLink,
  authMode,
  siteSignedIn,
  openingLogin,
  clearingLogin,
  currentLoginSite,
  error,
  pickMedia,
  acceptFile,
  inspectVideoLink,
  setLinkUrl,
  setLinkPreview,
  setError,
  setAuthMode,
  openSiteLogin,
  clearSiteLogin,
  startLinkPlayback,
  startLinkImport,
  cancelLinkImport,
}: {
  loading: boolean;
  dragging: boolean;
  linkUrl: string;
  linkPreview: LinkPreview | null;
  linkJobId: string;
  linkProgress: LinkImportProgress | null;
  inspectingLink: boolean;
  authMode: SiteAuthMode;
  siteSignedIn: boolean | null;
  openingLogin: boolean;
  clearingLogin: boolean;
  currentLoginSite: LoginSite | null;
  error: string;
  pickMedia: () => Promise<void>;
  acceptFile: (file: File | undefined) => Promise<void>;
  inspectVideoLink: () => Promise<void>;
  setLinkUrl: (value: string) => void;
  setLinkPreview: (value: LinkPreview | null) => void;
  setError: (value: string) => void;
  setAuthMode: (value: SiteAuthMode) => void;
  openSiteLogin: () => Promise<void>;
  clearSiteLogin: () => Promise<void>;
  startLinkPlayback: () => void;
  startLinkImport: () => Promise<void>;
  cancelLinkImport: () => Promise<void>;
}) {
  return (
    <section
      className={`workspace-empty${dragging ? ' is-dragging' : ''}`}
      aria-labelledby="workspace-title"
    >
      <div className="empty-icon" aria-hidden="true">
        {loading ? <SpinnerGapIcon size={30} className="spin" /> : <FilmSlateIcon size={30} />}
      </div>
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
              <span className={siteSignedIn ? 'account-status is-signed-in' : 'account-status'}>
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
  );
}
