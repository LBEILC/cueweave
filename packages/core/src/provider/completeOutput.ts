export class SubtitleResponseError extends Error {}

export class TruncatedOutputError extends SubtitleResponseError {
  constructor(public readonly content: string) {
    super('模型连续两次达到输出上限；未将截断内容视为完整译文。');
  }
}

/** Each callback is a separately traced and budgeted request. */
export async function requestCompleteOutput(
  request: (outputLimit: number, retry: boolean) => Promise<unknown>,
): Promise<string> {
  for (const outputLimit of [4096, 8192]) {
    const payload = (await request(outputLimit, outputLimit !== 4096)) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    };
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.finish_reason === 'length') {
      if (outputLimit === 8192) throw new TruncatedOutputError(content ?? '');
      continue;
    }
    if (choice?.finish_reason && choice.finish_reason !== 'stop')
      throw new SubtitleResponseError(`模型未正常结束响应：${choice.finish_reason}`);
    if (typeof content !== 'string' || !content.trim())
      throw new SubtitleResponseError('模型返回了空内容。');
    return content;
  }
  throw new SubtitleResponseError('未获得完整响应。');
}
