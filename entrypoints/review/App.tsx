import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  MagicWandIcon,
  PlusIcon,
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
} from '../../src/domain/subtitle';
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
      <aside className="review-rail" aria-label="CueWeave 字幕工作台">
        <div className="thread-line" aria-hidden="true" />
        <img src="/cueweave-mark.svg" alt="" />
        <div>
          <p className="eyebrow">CueWeave</p>
          <p className="brand-name">字幕工作台</p>
        </div>
        <nav aria-label="工作台内容">
          <a href="#overview">处理进度</a>
          <a href="#corrections">修正记录</a>
          <a href="#terminology">术语修正</a>
          <a href="#export">字幕导出</a>
        </nav>
      </aside>

      <section className="review-content">
        <header className="review-heading" id="overview">
          <div>
            <p className="section-index">TRANSCRIPT INTELLIGENCE</p>
            <h1>{report?.videoTitle ?? '读取字幕数据'}</h1>
            <p>原始转录始终保留；只有高置信修正会进入修复原文和中文翻译。</p>
          </div>
          <MagicWandIcon size={30} aria-hidden="true" />
        </header>

        {loadState !== 'ready' || !report ? (
          <section className={`state-panel state-${loadState}`} role="status">
            {loadState === 'error' ? (
              <WarningCircleIcon size={22} weight="fill" aria-hidden="true" />
            ) : (
              <ArrowClockwiseIcon className="spinning" size={22} aria-hidden="true" />
            )}
            <div>
              <strong>{loadState === 'error' ? '字幕数据不可用' : '正在连接视频页面'}</strong>
              <p>{message}</p>
            </div>
            {loadState === 'error' && sourceTabId !== undefined && (
              <button type="button" onClick={() => void loadReport(sourceTabId)}>
                重试
              </button>
            )}
          </section>
        ) : (
          <>
            <section className="progress-section" aria-labelledby="progress-heading">
              <div className="progress-copy">
                <p className="section-index">01 / PROCESSING</p>
                <h2 id="progress-heading">字幕处理进度</h2>
                <p>{report.message ?? '当前位置及前方字幕会自动处理。'}</p>
              </div>
              <div className="progress-value" aria-label={`完整翻译进度 ${completionPercent}%`}>
                <strong>{completionPercent}%</strong>
                <span>
                  {report.translatedWindowCount} / {report.totalWindowCount} 个窗口
                </span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${completionPercent / 100})` }} />
              </div>
              {!report.translationComplete && (
                <button
                  className="primary-action"
                  type="button"
                  disabled={report.fullTranslationStatus === 'working'}
                  onClick={() => void startFullTranslation()}
                >
                  <MagicWandIcon size={18} weight="bold" aria-hidden="true" />
                  {report.fullTranslationStatus === 'working' ? '正在翻译全部字幕' : '翻译全部字幕'}
                </button>
              )}
              {report.translationComplete && (
                <p className="ready-note">
                  <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
                  完整字幕已准备好
                </p>
              )}
            </section>

            <section
              className="correction-section"
              id="corrections"
              aria-labelledby="correction-heading"
            >
              <header className="section-heading">
                <div>
                  <p className="section-index">02 / CORRECTIONS</p>
                  <h2 id="correction-heading">修正记录</h2>
                  <p>低置信建议只记录，不会改写字幕。</p>
                </div>
                <span className="count-label">{report.corrections.length}</span>
              </header>

              {report.corrections.length === 0 ? (
                <div className="empty-state">
                  <FileTextIcon size={22} aria-hidden="true" />
                  <div>
                    <strong>当前已处理范围没有转录修正</strong>
                    <p>继续播放或完成全部翻译后，这里会汇总 AI 发现的明确转录错误。</p>
                  </div>
                </div>
              ) : (
                <ol className="correction-list">
                  {report.corrections.map((correction) => (
                    <li key={correction.id}>
                      <div className="correction-meta">
                        <span>{CATEGORY_LABELS[correction.category]}</span>
                        <span>{Math.round(correction.confidence * 100)}% 置信度</span>
                        <span>{correction.applied ? '已应用' : '仅记录'}</span>
                      </div>
                      <div className="correction-change">
                        <del>{correction.originalText}</del>
                        <span aria-hidden="true">→</span>
                        <ins>{correction.correctedText}</ins>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section
              className="terminology-section"
              id="terminology"
              aria-labelledby="terminology-heading"
            >
              <header className="section-heading">
                <div>
                  <p className="section-index">03 / TERMINOLOGY</p>
                  <h2 id="terminology-heading">当前视频术语</h2>
                  <p>当转录无法判断新名称时，确认一次即可用于本视频后续字幕。</p>
                </div>
                <TextAaIcon size={25} aria-hidden="true" />
              </header>

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
                    placeholder="Soul"
                    autoComplete="off"
                    onChange={(event) => setSourceTerm(event.target.value)}
                  />
                </label>
                <span className="term-arrow" aria-hidden="true">
                  →
                </span>
                <label>
                  <span>确认写法或译名</span>
                  <input
                    value={confirmedTerm}
                    maxLength={96}
                    placeholder="Sol"
                    autoComplete="off"
                    onChange={(event) => setConfirmedTerm(event.target.value)}
                  />
                </label>
                <button className="primary-action" type="submit" disabled={savingTerm}>
                  <PlusIcon size={18} weight="bold" aria-hidden="true" />
                  保存并重新翻译
                </button>
              </form>

              {glossary.manualTerms.length === 0 ? (
                <div className="empty-state compact-empty">
                  <TextAaIcon size={22} aria-hidden="true" />
                  <div>
                    <strong>还没有人工确认的术语</strong>
                    <p>例如把转录中的 Soul 确认为 Sol；自动识别的术语不会覆盖这里的设置。</p>
                  </div>
                </div>
              ) : (
                <ul className="term-list" aria-label="人工确认术语">
                  {glossary.manualTerms.map((term) => (
                    <li key={term.source.toLocaleLowerCase()}>
                      <span>{term.source}</span>
                      <span aria-hidden="true">→</span>
                      <strong>{term.translation}</strong>
                      <button
                        type="button"
                        disabled={savingTerm}
                        aria-label={`删除术语 ${term.source}`}
                        onClick={() => void deleteTerm(term.source)}
                      >
                        <TrashSimpleIcon size={18} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {termMessage && (
                <p className="term-message" role="status">
                  {termMessage}
                </p>
              )}
            </section>

            <section className="export-section" id="export" aria-labelledby="export-heading">
              <header className="section-heading">
                <div>
                  <p className="section-index">04 / EXPORT</p>
                  <h2 id="export-heading">导出字幕</h2>
                  <p>原始转录可立即导出；其余内容需要完整翻译通过校验。</p>
                </div>
                <DownloadSimpleIcon size={25} aria-hidden="true" />
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
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void exportSubtitles()}
                >
                  <DownloadSimpleIcon size={18} weight="bold" aria-hidden="true" />
                  生成字幕文件
                </button>
              </div>
              {exportMessage && (
                <p className="export-message" role="status">
                  {exportMessage}
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
