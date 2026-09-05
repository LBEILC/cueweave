import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  MagicWandIcon,
  PlusIcon,
  ShieldCheckIcon,
  TextAaIcon,
  TrashSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  serializeSubtitles,
  subtitleExportFilename,
  type SubtitleExportFormat,
  type SubtitleExportMode,
} from '@cueweave/core/subtitle';
import type { VideoGlossaryState } from '../../src/context/videoGlossary';
import {
  DELETE_VIDEO_GLOSSARY_TERM_MESSAGE,
  GET_VIDEO_GLOSSARY_MESSAGE,
  UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE,
} from '../../src/provider/messages';
import {
  GET_TRANSCRIPT_REPORT_MESSAGE,
  START_FULL_TRANSLATION_MESSAGE,
  type TranscriptReport,
} from '../../src/platform/youtube/types';
import { readSubtitlePreferences } from '../../src/settings/subtitle';
import { Brand } from '../../src/ui/Brand';

type LoadState = 'loading' | 'ready' | 'error';

interface GlossaryResponse {
  ok: boolean;
  glossary?: VideoGlossaryState;
  message?: string;
}

const MODE_LABELS: Record<SubtitleExportMode, string> = {
  original: '原始转录',
  corrected: '修复原文',
  translation: '中文翻译',
  bilingual: '双语字幕',
};

const CATEGORY_LABELS = {
  'proper-noun': '专有名词',
  'asr-error': '转录错误',
  formatting: '格式修复',
  other: '其他',
} as const;

async function resolveSourceTabId(): Promise<number | undefined> {
  const queryValue = new URLSearchParams(window.location.search).get('tabId');
  const queryTabId = queryValue ? Number(queryValue) : Number.NaN;
  if (Number.isInteger(queryTabId) && queryTabId >= 0) return queryTabId;
  const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
  return tabs.find((tab) => tab.id !== undefined)?.id;
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('正在读取当前视频的字幕数据。');
  const [report, setReport] = useState<TranscriptReport>();
  const [sourceTabId, setSourceTabId] = useState<number>();
  const [exportMode, setExportMode] = useState<SubtitleExportMode>('original');
  const [exportFormat, setExportFormat] = useState<SubtitleExportFormat>('srt');
  const [exportMessage, setExportMessage] = useState('');
  const [glossary, setGlossary] = useState<VideoGlossaryState>({ terms: [], manualTerms: [] });
  const [sourceTerm, setSourceTerm] = useState('');
  const [confirmedTerm, setConfirmedTerm] = useState('');
  const [termMessage, setTermMessage] = useState('');
  const [savingTerm, setSavingTerm] = useState(false);
  const [correctionFilter, setCorrectionFilter] = useState<'all' | 'applied' | 'recorded'>('all');

  const visibleCorrections = useMemo(
    () =>
      report?.corrections.filter(
        (correction) =>
          correctionFilter === 'all' ||
          (correctionFilter === 'applied' ? correction.applied : !correction.applied),
      ) ?? [],
    [report?.corrections, correctionFilter],
  );
  const appliedCount = report?.corrections.filter((correction) => correction.applied).length ?? 0;

  const reconnect = async () => {
    setLoadState('loading');
    setMessage('正在读取当前视频的字幕数据。');
    try {
      const tabId = await resolveSourceTabId();
      if (tabId === undefined)
        throw new Error('没有找到已打开的 YouTube 视频，请先打开视频后再试。');
      setSourceTabId(tabId);
      await loadReport(tabId);
    } catch (error) {
      setLoadState('error');
      setMessage(error instanceof Error ? error.message : '无法连接视频页面，请稍后重试。');
    }
  };

  const loadReport = useCallback(async (tabId: number) => {
    try {
      const value = (await browser.tabs.sendMessage(tabId, {
        type: GET_TRANSCRIPT_REPORT_MESSAGE,
      })) as TranscriptReport;
      if (!value?.videoId) throw new Error('当前页面尚未准备好字幕数据。');
      setReport(value);
      setLoadState('ready');
      setMessage('');
    } catch (error) {
      setLoadState('error');
      setMessage(
        error instanceof Error
          ? `${error.message} 请刷新 YouTube 视频页面后重试。`
          : '无法读取字幕数据，请刷新 YouTube 视频页面后重试。',
      );
    }
  }, []);

  const loadGlossary = useCallback(async (videoId: string) => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: GET_VIDEO_GLOSSARY_MESSAGE,
        videoId,
      })) as GlossaryResponse;
      if (!response.ok || !response.glossary) throw new Error(response.message);
      setGlossary(response.glossary);
    } catch {
      setTermMessage('无法读取当前视频术语，请重新加载扩展后再试。');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveSourceTabId().then((tabId) => {
      if (cancelled) return;
      if (tabId === undefined) {
        setLoadState('error');
        setMessage('没有找到已打开的 YouTube 视频，请先打开视频后再试。');
        return;
      }
      setSourceTabId(tabId);
      void loadReport(tabId);
    });
    return () => {
      cancelled = true;
    };
  }, [loadReport]);

  useEffect(() => {
    if (!report?.videoId) return;
    setTermMessage('');
    void loadGlossary(report.videoId);
  }, [loadGlossary, report?.videoId]);

  useEffect(() => {
    if (!sourceTabId || report?.fullTranslationStatus !== 'working') return;
    const intervalId = window.setInterval(() => void loadReport(sourceTabId), 800);
    return () => window.clearInterval(intervalId);
  }, [loadReport, report?.fullTranslationStatus, sourceTabId]);

  const completionPercent = useMemo(() => {
    if (!report?.totalWindowCount) return 0;
    return Math.round((report.translatedWindowCount / report.totalWindowCount) * 100);
  }, [report]);

  const startFullTranslation = async () => {
    if (!sourceTabId) return;
    setExportMessage('');
    try {
      await browser.tabs.sendMessage(sourceTabId, { type: START_FULL_TRANSLATION_MESSAGE });
      await loadReport(sourceTabId);
    } catch {
      setExportMessage('无法启动完整翻译，请刷新 YouTube 视频页面后重试。');
    }
  };

  const exportSubtitles = async () => {
    if (!report) return;
    const needsTranslation = exportMode !== 'original';
    if (needsTranslation && !report.translationComplete) {
      setExportMessage('请先完成全部字幕翻译，再导出修复原文、中文或双语字幕。');
      return;
    }
    try {
      const preferences = await readSubtitlePreferences();
      const cues = exportMode === 'original' ? report.originalCues : report.translatedCues;
      const content = serializeSubtitles(
        cues,
        exportFormat,
        exportMode,
        preferences.bilingualOrder,
      );
      const blobUrl = URL.createObjectURL(
        new Blob([content], {
          type:
            exportFormat === 'vtt'
              ? 'text/vtt;charset=utf-8'
              : 'application/x-subrip;charset=utf-8',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = subtitleExportFilename(report.videoTitle, exportMode, exportFormat);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
      setExportMessage(`已生成 ${MODE_LABELS[exportMode]} ${exportFormat.toUpperCase()} 文件。`);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : '字幕导出失败，请重试。');
    }
  };

  const saveTerm = async () => {
    if (!report || savingTerm) return;
    const source = sourceTerm.trim().replace(/\s+/gu, ' ');
    const translation = confirmedTerm.trim().replace(/\s+/gu, ' ');
    if (!source || !translation) {
      setTermMessage('请同时填写转录中的写法和确认写法。');
      return;
    }
    setSavingTerm(true);
    setTermMessage('正在保存术语并清理该视频的旧译文。');
    try {
      const response = (await browser.runtime.sendMessage({
        type: UPSERT_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: report.videoId,
        term: { source, translation },
      })) as GlossaryResponse;
      if (!response.ok || !response.glossary) throw new Error(response.message);
      setGlossary(response.glossary);
      setSourceTerm('');
      setConfirmedTerm('');
      setTermMessage(`已保存 ${source} → ${translation}，正在重新翻译当前位置。`);
      if (sourceTabId !== undefined) await loadReport(sourceTabId);
    } catch (error) {
      setTermMessage(
        error instanceof Error && error.message ? error.message : '术语未能保存，请重试。',
      );
    } finally {
      setSavingTerm(false);
    }
  };

  const deleteTerm = async (source: string) => {
    if (!report || savingTerm) return;
    setSavingTerm(true);
    setTermMessage(`正在删除 ${source} 并重新整理该视频的译文。`);
    try {
      const response = (await browser.runtime.sendMessage({
        type: DELETE_VIDEO_GLOSSARY_TERM_MESSAGE,
        videoId: report.videoId,
        source,
      })) as GlossaryResponse;
      if (!response.ok || !response.glossary) throw new Error(response.message);
      setGlossary(response.glossary);
      setTermMessage(`已删除 ${source}，正在重新翻译当前位置。`);
      if (sourceTabId !== undefined) await loadReport(sourceTabId);
    } catch (error) {
      setTermMessage(
        error instanceof Error && error.message ? error.message : '术语未能删除，请重试。',
      );
    } finally {
      setSavingTerm(false);
    }
  };

  return (
    <main className="review-shell">
      <header className="workspace-bar">
        <Brand />
        <span className="workspace-title">字幕工作台</span>
        {report && loadState === 'ready' && (
          <nav aria-label="工作台内容">
            <a href="#corrections">修正记录</a>
            <a href="#terminology">视频术语</a>
            <a href="#export">导出字幕</a>
          </nav>
        )}
      </header>
      <div className="review-content">
        {loadState !== 'ready' || !report ? (
          <section className="connection-state" role="status">
            <div className="connection-symbol">
              {loadState === 'error' ? (
                <WarningCircleIcon size={30} aria-hidden="true" />
              ) : (
                <ArrowClockwiseIcon className="cw-spin" size={30} aria-hidden="true" />
              )}
            </div>
            <h1>{loadState === 'error' ? '暂时无法读取字幕' : '正在连接视频'}</h1>
            <p>{message}</p>
            {loadState === 'error' && (
              <button type="button" className="cw-button" onClick={() => void reconnect()}>
                <ArrowClockwiseIcon size={18} aria-hidden="true" />
                重新连接
              </button>
            )}
            <p className="connection-note">从视频页面的句织菜单进入，可查看对应视频的字幕。</p>
          </section>
        ) : (
          <>
            <header className="video-heading">
              <div className="video-copy">
                <h1>{report.videoTitle}</h1>
                <p className="video-detail">
                  <FileTextIcon size={16} aria-hidden="true" />
                  <span>{report.languageCode?.toUpperCase() ?? '原文'} 字幕</span>
                  <span className="detail-divider" aria-hidden="true" />
                  <span>原始转录始终保留</span>
                </p>
              </div>
              <a className="cw-button secondary export-shortcut" href="#export">
                <DownloadSimpleIcon size={18} aria-hidden="true" />
                导出字幕
              </a>
            </header>
            <section className="translation-status" aria-label="字幕处理进度">
              <div className="translation-summary">
                {report.translationComplete ? (
                  <CheckCircleIcon size={20} weight="fill" aria-hidden="true" />
                ) : report.fullTranslationStatus === 'error' ? (
                  <WarningCircleIcon size={20} aria-hidden="true" />
                ) : (
                  <MagicWandIcon size={20} aria-hidden="true" />
                )}
                <div>
                  <h2>
                    {report.translationComplete
                      ? '完整字幕已准备好'
                      : report.fullTranslationStatus === 'working'
                        ? '正在翻译全部字幕'
                        : report.fullTranslationStatus === 'error'
                          ? '完整翻译尚未完成'
                          : '跟随播放，逐步整理字幕'}
                  </h2>
                  <p>
                    {report.message ??
                      (report.translationComplete
                        ? '可以导出修复原文、中文或双语字幕。'
                        : '当前位置及前方字幕会自动处理。')}
                  </p>
                </div>
              </div>
              <div className="translation-meter">
                <div>
                  <span>
                    已翻译 {report.translatedWindowCount} / {report.totalWindowCount} 个窗口
                  </span>
                  <strong>{completionPercent}%</strong>
                </div>
                <progress
                  value={report.translatedWindowCount}
                  max={Math.max(1, report.totalWindowCount)}
                  aria-label="完整翻译进度"
                />
              </div>
              {!report.translationComplete && (
                <button
                  className="cw-button"
                  type="button"
                  disabled={report.fullTranslationStatus === 'working'}
                  onClick={() => void startFullTranslation()}
                >
                  {report.fullTranslationStatus === 'working' ? (
                    <ArrowClockwiseIcon size={17} className="cw-spin" aria-hidden="true" />
                  ) : (
                    <MagicWandIcon size={17} aria-hidden="true" />
                  )}
                  {report.fullTranslationStatus === 'working'
                    ? '翻译中'
                    : report.fullTranslationStatus === 'error'
                      ? '重试完整翻译'
                      : '翻译全部字幕'}
                </button>
              )}
            </section>
            <div className="workbench-columns">
              <section
                className="corrections-panel"
                id="corrections"
                aria-labelledby="correction-heading"
              >
                <header className="panel-heading">
                  <div>
                    <h2 id="correction-heading">
                      修正记录 <span className="total-count">{report.corrections.length}</span>
                    </h2>
                    <p>核对转录中的改动，原始内容会一直保留。</p>
                  </div>
                  <FileTextIcon size={21} aria-hidden="true" />
                </header>
                <div className="correction-filters" role="group" aria-label="筛选修正记录">
                  <button
                    type="button"
                    aria-pressed={correctionFilter === 'all'}
                    onClick={() => setCorrectionFilter('all')}
                  >
                    全部 <span>{report.corrections.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={correctionFilter === 'applied'}
                    onClick={() => setCorrectionFilter('applied')}
                  >
                    已应用 <span>{appliedCount}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={correctionFilter === 'recorded'}
                    onClick={() => setCorrectionFilter('recorded')}
                  >
                    仅记录 <span>{report.corrections.length - appliedCount}</span>
                  </button>
                </div>
                <div className="corrections-body" aria-live="polite">
                  {visibleCorrections.length === 0 ? (
                    <div className="empty-state">
                      <FileTextIcon size={30} aria-hidden="true" />
                      <h3>
                        {report.corrections.length === 0
                          ? '这部分字幕还没有修正记录'
                          : '没有符合筛选的记录'}
                      </h3>
                      <p>
                        {report.corrections.length === 0
                          ? '继续播放或翻译全部字幕后，这里会汇总检测到的转录修正。'
                          : '切换到“全部”，查看其他修正记录。'}
                      </p>
                    </div>
                  ) : (
                    <ol className="correction-list">
                      {visibleCorrections.map((correction) => (
                        <li
                          key={correction.id}
                          className={correction.applied ? 'is-applied' : 'is-recorded'}
                        >
                          <div className="correction-meta">
                            <span>{CATEGORY_LABELS[correction.category]}</span>
                            <span>{Math.round(correction.confidence * 100)}% 置信度</span>
                            <span
                              className={
                                correction.applied ? 'cw-status success' : 'cw-status warning'
                              }
                            >
                              {correction.applied ? (
                                <CheckCircleIcon size={13} aria-hidden="true" />
                              ) : (
                                <FileTextIcon size={13} aria-hidden="true" />
                              )}
                              {correction.applied ? '已应用' : '仅记录'}
                            </span>
                          </div>
                          <div className="correction-change">
                            <div>
                              <span className="change-label">原始转录</span>
                              <p>{correction.originalText}</p>
                            </div>
                            <ArrowRightIcon className="change-arrow" size={18} aria-hidden="true" />
                            <div className="corrected-copy">
                              <span className="change-label">
                                {correction.applied ? '修正后' : '建议写法 · 未应用'}
                              </span>
                              <p>{correction.correctedText}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <p className="panel-footnote">
                  <ShieldCheckIcon size={16} aria-hidden="true" />
                  只有高置信修正会进入字幕；低置信建议仅供核对。
                </p>
              </section>
              <aside className="terminology-panel" id="terminology" aria-labelledby="term-heading">
                <header className="panel-heading">
                  <div>
                    <h2 id="term-heading">当前视频术语</h2>
                    <p>确认一次，让后续字幕用对名字。</p>
                  </div>
                  <TextAaIcon size={21} aria-hidden="true" />
                </header>
                <div className="terminology-content">
                  <form
                    className="term-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveTerm();
                    }}
                  >
                    <label>
                      <span>转录中的写法</span>
                      <input
                        value={sourceTerm}
                        maxLength={96}
                        placeholder="例如 Soul"
                        autoComplete="off"
                        onChange={(event) => setSourceTerm(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>确认写法或译名</span>
                      <input
                        value={confirmedTerm}
                        maxLength={96}
                        placeholder="例如 Sol"
                        autoComplete="off"
                        onChange={(event) => setConfirmedTerm(event.target.value)}
                      />
                    </label>
                    <button className="cw-button" type="submit" disabled={savingTerm}>
                      {savingTerm ? (
                        <ArrowClockwiseIcon size={17} className="cw-spin" aria-hidden="true" />
                      ) : (
                        <PlusIcon size={17} aria-hidden="true" />
                      )}
                      {savingTerm ? '正在保存' : '保存并重新翻译'}
                    </button>
                  </form>
                  <p className="term-help">
                    仅用于当前视频。修改术语会清理旧译文，并重新翻译当前位置。
                  </p>
                  {termMessage && (
                    <p className="inline-message" role="status">
                      {termMessage}
                    </p>
                  )}
                  <div className="saved-terms-heading">
                    <h3>已确认术语</h3>
                    <span>{glossary.manualTerms.length}</span>
                  </div>
                  {glossary.manualTerms.length === 0 ? (
                    <p className="empty-terms">
                      还没有确认的术语。遇到识别错误的名称时，可以在上方添加。
                    </p>
                  ) : (
                    <ul className="term-list" aria-label="人工确认术语">
                      {glossary.manualTerms.map((term) => (
                        <li key={term.source.toLocaleLowerCase()}>
                          <span>{term.source}</span>
                          <ArrowRightIcon size={14} aria-hidden="true" />
                          <strong>{term.translation}</strong>
                          <button
                            type="button"
                            disabled={savingTerm}
                            aria-label={'删除术语 ' + term.source}
                            onClick={() => void deleteTerm(term.source)}
                          >
                            <TrashSimpleIcon size={16} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
            <section className="export-panel" id="export" aria-labelledby="export-heading">
              <header className="panel-heading">
                <div>
                  <h2 id="export-heading">导出字幕</h2>
                  <p>
                    {report.translationComplete
                      ? '完整字幕已就绪，选择需要的内容和格式。'
                      : '原始转录可立即导出；其余内容需要先完成全部翻译。'}
                  </p>
                </div>
                <DownloadSimpleIcon size={21} aria-hidden="true" />
              </header>
              <div className="export-controls">
                <fieldset>
                  <legend>字幕内容</legend>
                  <div className="segmented-control four-options">
                    {(Object.keys(MODE_LABELS) as SubtitleExportMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={exportMode === mode}
                        disabled={mode !== 'original' && !report.translationComplete}
                        onClick={() => setExportMode(mode)}
                      >
                        {MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>文件格式</legend>
                  <div className="segmented-control">
                    {(['srt', 'vtt'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        aria-pressed={exportFormat === format}
                        onClick={() => setExportFormat(format)}
                      >
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button className="cw-button" type="button" onClick={() => void exportSubtitles()}>
                  <DownloadSimpleIcon size={18} aria-hidden="true" />
                  生成字幕文件
                </button>
              </div>
              {exportMessage && (
                <p className="export-message" role="status">
                  {exportMessage}
                </p>
              )}
            </section>
            <footer className="workspace-footer">
              <span>
                <ShieldCheckIcon size={15} aria-hidden="true" />
                本地校验，保留每一份原始转录
              </span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
