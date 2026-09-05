import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DESKTOP_CHANNELS, desktopError } from '../shared/bridge';
import { isProjectCommand } from '../shared/project';
import type { ProjectServiceReply, ProjectServiceRequest } from '../services/projects';
import type { MediaRegistry } from './media';
import { type DesktopServiceHost, ServiceHostError } from './service-host';
import { isTrustedSender } from './security';
import type { SettingsStore } from './settings-store';

export function registerProjectIpc(options: {
  window: BrowserWindow;
  rendererUrl: string;
  media: MediaRegistry;
  service: DesktopServiceHost;
  settings?: SettingsStore;
}) {
  const { window, service, media } = options;
  const authorized = new Map<string, string>();
  const revisions = new Map<string, number>();
  const idleWaiters: Array<() => void> = [];
  async function perform(request: ProjectServiceRequest) {
    const reply = await service.project(request);
    revisions.set(reply.project.id, reply.project.revision);
    return reply;
  }
  const recentPath = join(app.getPath('userData'), 'recent-project.json');
  let busy = false;
  async function opened(directory: string, reply: ProjectServiceReply) {
    authorized.set(reply.project.id, directory);
    await writeFile(recentPath, JSON.stringify({ directory })).catch(() => {});
    const asset = reply.mediaPath ? await media.register(reply.mediaPath) : null;
    return {
      ok: true as const,
      value: { opened: { project: reply.project, asset, probe: reply.probe } },
    };
  }
  ipcMain.handle(DESKTOP_CHANNELS.project, async (event, command: unknown) => {
    if (
      window.isDestroyed() ||
      !isTrustedSender(
        {
          windowId: event.sender.id,
          frameUrl: event.senderFrame?.url ?? '',
          isMainFrame: event.senderFrame === event.sender.mainFrame,
        },
        { windowId: window.webContents.id, rendererUrl: options.rendererUrl },
      )
    )
      return desktopError('FORBIDDEN');
    if (!isProjectCommand(command)) return desktopError('INVALID_REQUEST');
    if (command.action === 'refresh') {
      const directory = authorized.get(command.projectId);
      if (!directory) return desktopError('FORBIDDEN');
      try {
        return { ok: true, value: { project: (await perform({ directory, command })).project } };
      } catch {
        return {
          ok: false,
          error: { code: 'PROJECT_ERROR', message: '无法读取项目进度，请稍后重试。' },
        };
      }
    }
    if (busy)
      return {
        ok: false,
        error: { code: 'PROJECT_ERROR', message: '上一个项目操作仍在进行，请稍候。' },
      };
    busy = true;
    try {
      if (command.action === 'create') {
        const mediaPath = media.getPath(command.mediaId);
        if (!mediaPath) return desktopError('NOT_FOUND');
        const chosen = await dialog.showSaveDialog(window, {
          title: '创建字幕项目目录',
          defaultPath: basename(mediaPath).replace(/\.[^.]+$/, '') + '.cueweave',
          filters: [{ name: '句织项目目录', extensions: ['cueweave'] }],
        });
        if (chosen.canceled || !chosen.filePath) return { ok: true, value: null };
        const directory = chosen.filePath.endsWith('.cueweave')
          ? chosen.filePath
          : chosen.filePath + '.cueweave';
        const probe = await service.probeMedia(mediaPath);
        return opened(directory, await perform({ directory, command, mediaPath, probe }));
      }
      if (command.action === 'open' || command.action === 'recent') {
        let directory: string;
        if (command.action === 'recent') {
          try {
            const recent = JSON.parse(await readFile(recentPath, 'utf8')) as {
              directory?: unknown;
            };
            if (typeof recent.directory !== 'string') return { ok: true, value: null };
            directory = recent.directory;
          } catch {
            return { ok: true, value: null };
          }
        } else {
          const chosen = await dialog.showOpenDialog(window, {
            title: '打开 .cueweave 项目目录',
            properties: ['openDirectory'],
          });
          if (chosen.canceled || !chosen.filePaths[0]) return { ok: true, value: null };
          directory = chosen.filePaths[0];
        }
        return opened(directory, await perform({ directory, command }));
      }
      if (!('projectId' in command)) return desktopError('INVALID_REQUEST');
      const directory = authorized.get(command.projectId);
      if (!directory) return desktopError('FORBIDDEN');
      if (command.action === 'translate' || command.action === 'resume-translation') {
        const saved = options.settings?.snapshot();
        const apiKey = options.settings?.key();
        if (!saved?.provider.baseUrl || !saved.provider.model || !apiKey)
          return {
            ok: false,
            error: {
              code: 'PROJECT_ERROR',
              message: '请先在设置中填写并保存 AI 服务、模型和 API Key。',
            },
          };
        const reply = await perform({
          directory,
          command,
          provider: { ...saved.provider, apiKey },
        });
        return { ok: true, value: { project: reply.project } };
      }
      if (command.action === 'import') {
        const chosen = await dialog.showOpenDialog(window, {
          title: '导入字幕',
          properties: ['openFile'],
          filters: [{ name: '字幕', extensions: ['srt', 'vtt'] }],
        });
        if (chosen.canceled || !chosen.filePaths[0]) return { ok: true, value: null };
        const reply = await perform({
          directory,
          command,
          subtitlePath: chosen.filePaths[0],
        });
        return { ok: true, value: { project: reply.project } };
      }
      if (command.action === 'relink') {
        const chosen = await dialog.showOpenDialog(window, {
          title: '重新定位原视频',
          properties: ['openFile'],
          filters: [{ name: '视频', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] }],
        });
        if (chosen.canceled || !chosen.filePaths[0]) return { ok: true, value: null };
        return opened(
          directory,
          await perform({ directory, command, mediaPath: chosen.filePaths[0] }),
        );
      }
      if (command.action === 'export') {
        const chosen = await dialog.showSaveDialog(window, {
          title: command.mode
            ? `导出${command.partial ? '部分' : ''}${command.mode === 'bilingual' ? '双语字幕' : '译文'}`
            : command.original
              ? '导出原始字幕'
              : '导出编辑后字幕',
          defaultPath: `${basename(directory, '.cueweave')}${command.original ? '-原始' : command.mode === 'bilingual' ? '-双语' : command.mode ? '-译文' : ''}${command.partial ? '-部分' : ''}.${command.format}`,
          filters: [{ name: '字幕', extensions: [command.format] }],
        });
        if (chosen.canceled || !chosen.filePath) return { ok: true, value: null };
        const outputPath = chosen.filePath.toLowerCase().endsWith(`.${command.format}`)
          ? chosen.filePath
          : `${chosen.filePath}.${command.format}`;
        const reply = await perform({ directory, command, outputPath });
        return { ok: true, value: { exported: reply.exported, project: reply.project } };
      }
      return {
        ok: true,
        value: { project: (await perform({ directory, command })).project },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_ERROR',
          message:
            error instanceof ServiceHostError && error.code === 'PROJECT_ERROR'
              ? error.message
              : '无法完成项目操作。请检查文件是否存在、目录权限和磁盘空间。',
        },
      };
    } finally {
      busy = false;
      idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  });
  return {
    dispose: () => ipcMain.removeHandler(DESKTOP_CHANNELS.project),
    beforeClose: async () => {
      if (busy) await new Promise<void>((resolve) => idleWaiters.push(resolve));
      const state = (await window.webContents.executeJavaScript(
        "({id: document.documentElement.dataset.projectId, dirty: document.documentElement.dataset.projectDirty === 'true', position: document.querySelector('video')?.currentTime})",
      )) as { id?: string; dirty: boolean; position?: number };
      if (state.dirty) {
        const answer = await dialog.showMessageBox(window, {
          type: 'question',
          title: '字幕尚未保存',
          message: '当前字幕修改尚未保存。',
          detail: '返回保存修改，或放弃这次修改并关闭。已保存的项目内容不会丢失。',
          buttons: ['返回编辑', '放弃修改并关闭'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return false;
      }
      if (
        state.id &&
        authorized.has(state.id) &&
        revisions.has(state.id) &&
        Number.isFinite(state.position)
      ) {
        try {
          await perform({
            directory: authorized.get(state.id)!,
            command: {
              action: 'position',
              projectId: state.id,
              baseRevision: revisions.get(state.id)!,
              positionMs: Math.max(0, Math.round(state.position! * 1000)),
            },
          });
        } catch {
          const answer = await dialog.showMessageBox(window, {
            type: 'warning',
            title: '播放位置未保存',
            message: '无法保存最新播放位置。已保存的字幕修改仍保留在项目中。',
            buttons: ['返回项目', '关闭'],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) return false;
        }
      }
      return true;
    },
  };
}
