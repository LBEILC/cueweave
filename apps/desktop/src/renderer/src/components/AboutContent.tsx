import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import type { AppInfo } from '../../../shared/bridge';
export function AboutContent({
  info,
  loading,
  error,
  openingLicense,
  openLicense,
  loadInfo,
}: {
  info: AppInfo | null;
  loading: boolean;
  error: string;
  openingLicense: boolean;
  openLicense: () => Promise<void>;
  loadInfo: () => Promise<void>;
}) {
  return (
    <>
      <h1 tabIndex={-1}>关于句织</h1>
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
  );
}
