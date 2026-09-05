import { copyFile, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { serializeSubtitles } from '@cueweave/core/subtitle';
import type { DisplayCue } from '@cueweave/core/subtitle';
import { alignRuns, cueWarnings, summarize } from './analysis';
import { copyReportFonts, hash, readRun, writeAtomic, writeJson } from './io';
import { successfulCues } from './types';
import type { EvalRun } from './types';

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
const e = escapeHtml;
export const REPORT_PAGE_SIZE = 40;
const LOG_PAGE_SIZE = 20;
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}
function pager(kind: 'rows' | 'logs'): string {
  const label = kind === 'rows' ? '字幕' : '日志';
  return `<nav class="pager" data-pager="${kind}" aria-label="${label}分页" hidden><button type="button" data-page-step="-1">上一页${label}</button><span data-page-label role="status"></span><button type="button" data-page-step="1">下一页${label}</button></nav>`;
}
const stamp = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function renderCues(cues: DisplayCue[], missing: boolean): string {
  return `${missing ? '<p class="warning">此范围输出不完整 · 请查看请求记录</p>' : ''}${cues
    .map(
      (cue) =>
        `<div class="cue"><span class="time">${stamp(cue.startMs)}—${stamp(cue.endMs)}</span><p class="translation">${e(cue.translation)}</p><p class="corrected">${e(cue.sourceText)}</p>${cue.originalText && cue.originalText !== cue.sourceText ? `<p class="muted">转录原文：${e(cue.originalText)}</p>` : ''}${cueWarnings(
          cue,
        )
          .map((warning) => `<span class="warning tag">${e(warning)}</span>`)
          .join('')}</div>`,
    )
    .join('')}`;
}

function renderSummary(run: EvalRun, side: string): string {
  const stats = summarize(run);
  return `<section class="summary"><h2>${side} · ${e(run.name)}</h2><p class="model">${e(run.identity.model)} <span class="muted">/ ${e(run.identity.mode)}</span></p><dl class="stats"><div><dt>成功窗口</dt><dd>${stats.successfulWindows}<small> / ${stats.windows}</small></dd></div><div><dt>单请求直接通过</dt><dd>${stats.firstPassWindows}</dd></div><div><dt>失败 / 未完成</dt><dd>${stats.failedWindows}<small> / ${stats.pendingWindows}</small></dd></div><div><dt>模型请求</dt><dd>${stats.requestCount}</dd></div></dl><p class="muted">局部可用窗口 ${stats.partialWindows} · 词元缺失 ${stats.missingTokens} · 重复 ${stats.duplicatedTokens} · 范围外 ${stats.unexpectedTokens} · 降级 ${stats.fallbackEvents} · 待审阅字幕 ${stats.softWarningCues}</p><p class="muted">已记录请求耗时 ${(stats.requestDurationMs / 60000).toFixed(1)} 分钟 · 已报告 Token ${stats.reportedUsage?.total.toLocaleString() ?? '不可用'}${stats.usageMissingRequests ? `（${stats.usageMissingRequests} 次请求未报告用量）` : ''}</p><details><summary>配置与版本</summary><pre>${e(JSON.stringify({ status: run.status, ...run.identity, windowIds: `${run.windows.length} selected windows`, gitRevision: run.gitRevision, createdAt: run.createdAt, aliases: run.aliases }, null, 2))}</pre></details></section>`;
}

function renderLogs(run: EvalRun, prefix: string, side: string): string[] {
  return [
    ...run.entityAttempts.map((attempt) => ({ attempt, label: '视频实体识别' })),
    ...run.windows.flatMap((window) =>
      (run.results[window.id] ?? []).map((attempt, i) => ({
        attempt,
        label: `${stamp(window.startMs)} 窗口 · 尝试 ${i + 1}`,
      })),
    ),
  ].map(
    ({ attempt, label }) =>
      `<details class="log"><summary>${side} · ${e(label)} · ${e(attempt.status)} · ${attempt.requests.length} 请求</summary>${attempt.error ? `<p class="warning">${e(attempt.error)}</p>` : ''}<ul>${attempt.diagnostics.map((event) => `<li>${e(event.kind)}：${e(event.message)}</li>`).join('')}</ul><p>${attempt.requests.map((request, index) => `<a href="${prefix}requests/${encodeURIComponent(request.id)}.json" target="_blank" rel="noopener">请求 ${index + 1} · HTTP ${request.status ?? '未完成'} · ${(request.durationMs / 1000).toFixed(1)}s</a>`).join(' · ')}</p></details>`,
  );
}

export async function renderReport(left: EvalRun, right?: EvalRun): Promise<string> {
  const groups = alignRuns(left, right);
  const key = hash([
    left.id,
    left.fingerprint,
    left.updatedAt,
    right?.id,
    right?.fingerprint,
    right?.updatedAt,
  ]);
  const cases = summarize(left).caseChecks;
  const configDiff =
    right &&
    ['mode', 'baseUrl', 'protocol', 'context', 'pipelineHash', 'windowIds'].filter(
      (key) =>
        JSON.stringify(left.identity[key as keyof typeof left.identity]) !==
        JSON.stringify(right.identity[key as keyof typeof right.identity]),
    );
  const css = await readFile(new URL('./report.css', import.meta.url), 'utf8');
  const js = await readFile(new URL('./report-client.js', import.meta.url), 'utf8');
  const rows = groups.map((group) => {
    const warnings =
      group.leftMissing ||
      group.rightMissing ||
      [...group.left, ...group.right].some((cue) => cueWarnings(cue).length);
    const html = `<article id="${group.id}" class="group" tabindex="-1" data-start="${group.startMs}" data-end="${group.endMs}" data-different="${group.different}" data-issue="${!!warnings}">
      <header class="group-header"><a href="#${group.id}" class="time">${stamp(group.startMs)}—${stamp(group.endMs)}</a>${right ? `<span class="muted">${group.different ? '文本或切分有差异' : '输出相同'}</span>` : ''}</header>
      <p class="source" lang="en">${e(group.source)}</p>
      <div class="outputs ${right ? 'paired' : ''}">
      <section aria-label="运行 A 输出">${right ? '<h3>运行 A</h3>' : ''}${renderCues(group.left, group.leftMissing)}</section>${
        right
          ? `<section aria-label="运行 B 输出">
      <h3>运行 B</h3>${renderCues(group.right, group.rightMissing)}</section>`
          : ''
      }</div>
      <details class="review">
      <summary>人工评审</summary>
      </details>
      </article>`;
    return {
      id: group.id,
      startMs: group.startMs,
      endMs: group.endMs,
      different: group.different,
      issue: !!warnings,
      search: [
        group.source,
        ...[...group.left, ...group.right].flatMap((cue) => [
          cue.sourceText,
          cue.originalText ?? '',
          cue.translation,
        ]),
      ]
        .join(' ')
        .toLocaleLowerCase(),
      html,
    };
  });
  const reviewTemplate = `<template id="review-template">
      <div class="review-fields">
      <label>判断<select data-field="verdict"><option value="">未评审</option>${right ? '<option value="a">A 更好</option><option value="b">B 更好</option><option value="equal">相当</option>' : '<option value="good">可接受</option><option value="needs-work">需要改进</option>'}<option value="uncertain">无法判断</option></select>
      </label>
      <label class="note">备注<textarea data-field="note" rows="2" placeholder="例如：并列分句可拆开；专有名词需核对音频"></textarea>
      </label>
      </div>
      </template>`;
  const data = {
    pageSize: REPORT_PAGE_SIZE,
    logPageSize: LOG_PAGE_SIZE,
    rows,
    logs: [
      ...renderLogs(left, right ? 'A/' : '', 'A'),
      ...(right ? renderLogs(right, 'B/', 'B') : []),
    ],
  };
  return `<!doctype html>
      <html lang="zh-CN">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CueWeave · 字幕评测</title>
      <style>${css}</style>
      </head>
      <body data-review-key="${key}"><a class="skip" href="#results">跳到字幕</a>
      <main>
      <header class="page-header">
      <p class="eyebrow">CUEWEAVE / 句织</p>
      <h1>${right ? '让差异有据可查' : '把每一句看清楚'}</h1>
      <p class="intro">${e(left.videoId)} · ${right ? '按原文词元范围对齐两个运行，保留各自切分。' : '字幕翻译基线 · 原始转录、纠错与译文逐段对照。'}</p>
      <p class="muted">自动检查反映结构与风险，不代表翻译准确率。较长字幕仅供审阅，不会按空格或字数强制切分。</p>
      </header>
      <div class="summaries ${right ? 'paired' : ''}">${renderSummary(left, 'A')}${right ? renderSummary(right, 'B') : ''}</div>${configDiff?.length ? `<p class="notice">除模型外还存在配置差异：${e(configDiff.join('、'))}。这份报告不是仅改变模型的对照实验。</p>` : ''}<details class="cases">
      <summary>重点案例与核对提示（${cases.length}）</summary>
      <p class="muted">提示与词面检查不发送给模型。自动匹配不能判定语义正确。</p>${cases.map((item) => `<p><a href="#" data-jump="${item.startMs}">${stamp(item.startMs)} · ${e(item.label)}</a> · ${e(item.status)}${right ? ` / B：${e(summarize(right).caseChecks.find((test) => test.id === item.id)?.status ?? '未设置')}` : ''}<br>${e(item.review)}</p>`).join('') || '<p>本次未提供案例文件。</p>'}</details>
      <form class="toolbar" onsubmit="return false">
      <label class="search">搜索原文或译文<input id="search" type="search" placeholder="ChatGPT / Astra / 关键词">
      </label>
      <label>跳到时间<input id="jump" type="text" placeholder="21:56" inputmode="decimal">
      </label>
      <button id="jump-button" type="button">定位</button>
      <label class="check"><input id="issues" type="checkbox">只看风险项</label>${right ? '<label class="check"><input id="differences" type="checkbox">只看差异</label>' : ''}<button id="export" type="button">导出评审</button>
      </form>
      <p id="filter-status" role="status" class="muted">
      </p>
      <p id="save-status" role="status" class="muted">备注保存在当前浏览器；请导出 JSON 留存。结果更新后使用新的评审记录。</p>
      ${pager('rows')}
      <div id="results">${rows
        .slice(0, REPORT_PAGE_SIZE)
        .map((row) => row.html)
        .join('')}</div>
      ${pager('rows')}
      <noscript><p>当前仅展示首页字幕。请启用 JavaScript 使用全片搜索、分页和评审功能。</p></noscript>
      <p id="empty" hidden>没有匹配的字幕。请清空搜索或关闭筛选。</p>
      <details class="all-logs">
      <summary>请求与修复记录</summary>
      <p class="muted">记录包含字幕、上下文与模型输出，不包含认证请求头。分享前请检查内容。异常退出的未完成请求见 requests 目录。</p>${pager('logs')}<div id="log-results"></div></details>
      <footer>CueWeave 使用 MiSans · Copyright Xiaomi Technology Co., Ltd. · <a href="assets/MiSans-LICENSE.pdf">字体许可协议</a>
      <p>这是文本评测，不模拟浏览器播放、排队延迟或实际字幕换行。</p>
      </footer>
      ${reviewTemplate}
      </main>
      <script type="application/json" id="report-data">${scriptJson(data)}</script>
      <script>${js}</script>
      </body>
      </html>`;
}

async function writeExports(directory: string, run: EvalRun): Promise<void> {
  const cues = successfulCues(run);
  const stats = summarize(run);
  await writeJson(path.join(directory, 'summary.json'), stats);
  const partial = stats.successfulWindows !== stats.windows ? '.partial' : '';
  const files = new Set(await readdir(directory));
  const archive = path.join(directory, 'exports-history', randomUUID());
  // Preserve a former full export if a resumed run becomes incomplete (and vice versa).
  for (const mode of ['bilingual', 'translation'])
    for (const format of ['srt', 'vtt']) {
      for (const suffix of ['', '.partial']) {
        const previous = `${mode}${suffix}.${format}`;
        if (files.has(previous) && (suffix !== partial || !cues.length)) {
          await mkdir(archive, { recursive: true });
          await rename(path.join(directory, previous), path.join(archive, previous));
        }
      }
    }
  if (!cues.length) return;
  for (const mode of ['bilingual', 'translation'] as const)
    for (const format of ['srt', 'vtt'] as const) {
      await writeAtomic(
        path.join(directory, `${mode}${partial}.${format}`),
        serializeSubtitles(cues, format, mode),
      );
    }
}

export async function writeReport(directory: string): Promise<void> {
  const run = await readRun(directory);
  await copyReportFonts(directory);
  await writeExports(directory, run);
  await writeAtomic(path.join(directory, 'report.html'), await renderReport(run));
}

export async function writeComparison(
  leftDirectory: string,
  rightDirectory: string,
  output: string,
): Promise<void> {
  const left = await readRun(leftDirectory);
  const right = await readRun(rightDirectory);
  const html = await renderReport(left, right);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await copyReportFonts(output);
  for (const [source, label, run] of [
    [leftDirectory, 'A', left],
    [rightDirectory, 'B', right],
  ] as const) {
    const target = path.join(output, label);
    await mkdir(path.join(target, 'requests'), { recursive: true });
    await writeJson(path.join(target, 'result.json'), run);
    await writeExports(target, run);
    for (const file of await readdir(path.join(source, 'requests'))) {
      if (/^[a-f\d-]+\.json$/u.test(file))
        await copyFile(path.join(source, 'requests', file), path.join(target, 'requests', file));
    }
  }
  await writeAtomic(path.join(output, 'report.html'), html);
  console.info(`对比报告：${path.join(output, 'report.html')}`);
}
