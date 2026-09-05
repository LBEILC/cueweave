import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AiSubtitleContext } from '@cueweave/core/subtitle/ai';
import { translateFirstPass } from '@cueweave/core/provider/firstPass';
import {
  SubtitleResponseError,
  TruncatedOutputError,
} from '@cueweave/core/provider/completeOutput';
import { readRun, pipelineHash, writeJson } from './eval/io';

const { values } = parseArgs({ options: { from: { type: 'string' }, out: { type: 'string' } } });
async function main() {
  if (!values.from || !values.out)
    throw new Error(
      '需要 --from 首轮运行目录和 --out 审计 JSON 路径。此命令只回放保存的响应，不调用模型。',
    );
  const run = await readRun(values.from);
  const differences: Array<{ windowId: string; message: string }> = [];
  let windows = 0,
    cues = 0,
    promptMatches = 0;
  for (const window of run.windows) {
    const active = run.results[window.id]?.at(-1);
    if (active?.status !== 'success') throw new Error(`窗口尚未完整产出：${window.id}`);
    const traces = await Promise.all(
      active.requests.map((r) =>
        readFile(path.join(values.from!, 'requests', `${r.id}.json`), 'utf8').then(JSON.parse),
      ),
    );
    const first = traces.find((r) => r.scope.endsWith(':first-pass'));
    if (!first) throw new Error('缺少首轮请求记录。');
    const prompt = first.request.messages[1].content as string;
    const data = prompt.split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const context = data.find((d) => d && !Array.isArray(d) && 'previousCues' in d) as
      AiSubtitleContext | undefined;
    const neighbors = data.find((d) => d && !Array.isArray(d) && 'timing' in d)?.neighbors;
    if (!context || !neighbors) throw new Error('请求中的上下文无法还原。');
    context.correctionEnabled = !prompt.includes('用户已关闭转录修复');
    const result = await translateFirstPass(
      window.tokens,
      context,
      neighbors,
      async (stage, actualPrompt) => {
        const selected = traces.filter(
          (r) => r.scope.endsWith(`:${stage}`) || r.scope.endsWith(`:${stage}-length-retry`),
        );
        if (!selected.length) throw new Error(`回放请求阶段没有对应日志：${stage}`);
        if (selected[0].request.messages[1].content === actualPrompt) promptMatches++;
        else differences.push({ windowId: window.id, message: `${stage} 的提示词与记录不一致` });
        const choice = selected.at(-1)!.response?.choices?.[0];
        if (choice?.finish_reason === 'length')
          throw new TruncatedOutputError(choice.message?.content ?? '');
        if (choice?.finish_reason !== 'stop' || !choice.message?.content)
          throw new SubtitleResponseError('已存响应未正常结束。');
        return choice.message.content;
      },
    );
    windows++;
    cues += result.cues.length;
    if (
      JSON.stringify(result.cues) !== JSON.stringify(active.cues) ||
      result.missingTokenIds.length
    )
      differences.push({ windowId: window.id, message: '字幕文本、范围或元数据与已存结果不一致' });
  }
  const result = {
    source: path.resolve(values.from),
    windows,
    cues,
    networkRequests: 0,
    promptMatches,
    differences,
    recordedPipelineHash: run.identity.pipelineHash,
    currentPipelineHash: await pipelineHash(),
  };
  await writeJson(path.resolve(values.out), result);
  console.info(JSON.stringify(result));
  if (differences.length) process.exitCode = 2;
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
