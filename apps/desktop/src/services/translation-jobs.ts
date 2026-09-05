import { randomUUID } from 'node:crypto';
import type { ProjectServiceRequest, ProjectStore } from './projects';
import { translateCueWindow, translationWindows, translationError } from './cue-translation';
import type { ProviderSettings } from '@cueweave/core/provider/types';
import type { ProjectSnapshot } from '../shared/project';

export class TranslationJobs {
  private readonly unsavedFailures = new Map<string, string>();
  private active:
    { id: string; projectId: string; controller: AbortController; done: Promise<void> } | undefined;
  constructor(private store: ProjectStore) {}
  private async read(request: ProjectServiceRequest) {
    const reply = await this.store.run(request);
    const translation = reply.project.translation;
    const error = translation && this.unsavedFailures.get(translation.id);
    if (translation && error)
      reply.project.translation = { ...translation, state: 'failed', error };
    return reply;
  }
  async run(request: ProjectServiceRequest) {
    const { command, directory } = request;
    if (command.action === 'cancel-translation') {
      if (
        this.active?.id === command.translationId &&
        this.active.projectId === command.projectId
      ) {
        this.active.controller.abort();
        await this.active.done;
      }
      return this.read({
        directory,
        command: {
          action: 'refresh',
          projectId: command.projectId,
          baseRevision: command.baseRevision,
        },
      });
    }
    if (command.action !== 'translate' && command.action !== 'resume-translation')
      return this.read(request);
    if (this.active) throw new Error('请先取消正在进行的翻译，或等待完成。');
    const provider = request.provider;
    if (!provider?.apiKey || !provider.baseUrl || !provider.model)
      throw new Error('请先在设置中保存 AI 服务和 API Key。');
    const previous = await this.store.run({
      directory,
      command: {
        action: 'refresh',
        projectId: command.projectId,
        baseRevision: command.baseRevision,
      },
    });
    const language =
      command.action === 'translate'
        ? command.language
        : previous.project.translation?.targetLanguage;
    if (
      !language ||
      (command.action === 'resume-translation' &&
        previous.project.translation?.id !== command.translationId)
    )
      throw new Error('字幕翻译任务已变更，请刷新项目后重试。');
    const generation = randomUUID();
    const started = await this.store.run({
      directory,
      command: {
        action: 'translation-begin',
        projectId: command.projectId,
        baseRevision: command.baseRevision,
        language,
        provider: { baseUrl: provider.baseUrl, model: provider.model, protocol: provider.protocol },
        generation,
        ...(command.action === 'resume-translation' ? { resumeId: command.translationId } : {}),
      },
    });
    const translation = started.project.translation!;
    this.unsavedFailures.delete(translation.id);
    if (translation.state === 'completed') return started;
    const controller = new AbortController();
    const active = {
      id: translation.id,
      projectId: started.project.id,
      controller,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.process(
      directory,
      started.project,
      generation,
      provider,
      controller.signal,
    ).finally(() => {
      if (this.active === active) this.active = undefined;
    });
    return started;
  }
  private async process(
    directory: string,
    project: ProjectSnapshot,
    generation: string,
    provider: ProviderSettings,
    signal: AbortSignal,
  ) {
    const translation = project.translation!;
    const base = {
      directory,
      command: {
        action: 'translation-finish' as const,
        projectId: project.id,
        translationId: translation.id,
        generation,
      },
    };
    try {
      for (const window of translationWindows(project.cues)) {
        signal.throwIfAborted();
        const missing = window.filter((cue) => !translation.cues[cue.id]);
        if (!missing.length) continue;
        const units = await translateCueWindow(
          provider,
          project.cues,
          missing,
          translation.targetLanguage,
          signal,
        );
        signal.throwIfAborted();
        await this.store.run({
          directory,
          command: {
            action: 'translation-commit',
            projectId: project.id,
            translationId: translation.id,
            generation,
            units,
          },
        });
      }
      signal.throwIfAborted();
      await this.store.run({
        ...base,
        command: { ...base.command, state: 'completed', error: '' },
      });
    } catch (error) {
      await this.store
        .run({
          ...base,
          command: {
            ...base.command,
            state: signal.aborted ? 'cancelled' : 'failed',
            error: signal.aborted ? '' : translationError(error),
          },
        })
        .catch(() => {
          this.unsavedFailures.set(
            translation.id,
            '字幕翻译已停止，但任务状态未能保存。请检查磁盘空间和目录权限后重试；已提交的译文仍保留。',
          );
        });
    }
  }
  async shutdown() {
    this.active?.controller.abort();
    await this.active?.done;
  }
}
