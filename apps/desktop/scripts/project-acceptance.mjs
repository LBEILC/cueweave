import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(desktop, '../..');
const output = join(root, '.impeccable/review/desktop-project');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'cueweave-d1-ui-'));
const userData = join(temporary, 'user-data');
const media = join(temporary, '演示视频.mp4');
const moved = join(temporary, '移动的视频.mp4');
await copyFile(join(root, '.fixtures/desktop/D0 中文 sample.mp4'), media);
const subtitle = join(temporary, '原字幕.srt');
await writeFile(
  subtitle,
  '1\n00:00:00,000 --> 00:00:00,800\nFirst subtitle.\n\n2\n00:00:00,800 --> 00:00:01,800\nA longer subtitle for editing.\n\n3\n00:00:01,800 --> 00:00:03,000\n最后一句字幕。\n',
);
const directory = join(temporary, '字幕校对.cueweave');
const exported = join(temporary, '编辑结果.srt');
const errors = [];
const executable = process.env.CUEWEAVE_PROJECT_EXECUTABLE;
let application;
let page;
async function launch() {
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [
      ...(executable ? [] : [desktop]),
      '--hidden',
      '--mute-audio',
      ...(process.env.CUEWEAVE_TEST_DISABLE_GPU_SANDBOX === '1' ? ['--disable-gpu-sandbox'] : []),
    ],
    env,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
    ),
    true,
  );
}
async function choose(kind, path) {
  await application.evaluate(
    ({ dialog }, { kind, path }) => {
      const method = kind === 'save' ? 'showSaveDialog' : 'showOpenDialog';
      const original = dialog[method];
      dialog[method] = async () => {
        dialog[method] = original;
        return kind === 'save'
          ? { canceled: false, filePath: path }
          : { canceled: false, filePaths: [path] };
      };
    },
    { kind, path },
  );
}
async function close() {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await application.close();
}
try {
  await launch();
  await page.getByLabel('选择视频文件').setInputFiles(media);
  await page.getByRole('button', { name: '创建项目', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('video').evaluate((video) => video.pause());
  // Exercise real React quality controls using an isolated local-media link fixture.
  const videoUrl = await page.locator('video').getAttribute('src');
  await application.evaluate(({ ipcMain }, videoUrl) => {
    ipcMain.removeHandler('cueweave:link:inspect');
    ipcMain.handle('cueweave:link:inspect', () => ({
      ok: true,
      value: {
        kind: 'website',
        url: 'https://www.youtube.com/watch?v=controltest',
        title: '播放控件验收样本',
        source: '测试样本',
        durationSeconds: 3,
        playback: {
          kind: 'dom',
          defaultVariantId: 'high',
          subtitles: [],
          variants: [
            { id: 'high', label: '1080p 高码率 · H.264', videoCodec: 'h264', videoUrl },
            { id: 'standard', label: '720p · H.264', videoCodec: 'h264', videoUrl },
          ],
        },
      },
    }));
  }, videoUrl);
  await page.getByRole('button', { name: '打开其他视频', exact: true }).click();
  await page.getByLabel('视频链接').fill('https://www.youtube.com/watch?v=controltest');
  await page.getByRole('button', { name: '读取链接', exact: true }).click();
  await page.getByRole('button', { name: '在线播放', exact: true }).click();
  await page.getByLabel('清晰度', { exact: true }).waitFor();
  for (const [width, height, name] of [
    [1280, 782, 'quality-default'],
    [640, 480, 'quality-narrow'],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    const measurement = await page.getByLabel('清晰度', { exact: true }).evaluate((select) => {
      const style = window.getComputedStyle(select);
      const context = document.createElement('canvas').getContext('2d');
      context.font = style.font;
      const labelWidth = context.measureText(select.selectedOptions[0].text).width;
      const rect = select.getBoundingClientRect();
      const arrow = select.parentElement.querySelector('svg').getBoundingClientRect();
      return {
        textFits:
          labelWidth <= rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        rightGap: rect.right - arrow.right,
        controlsFit: [
          ...document.querySelectorAll(
            '.player-controls button, .player-controls input, .player-controls select',
          ),
        ].every((element) => {
          const r = element.getBoundingClientRect();
          return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
        }),
      };
    });
    assert.equal(measurement.textFits, true);
    assert.equal(measurement.controlsFit, true);
    assert.ok(measurement.rightGap >= 11);
    if (!executable) await page.screenshot({ path: join(output, `${name}.png`) });
  }
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
  );
  await page.getByLabel('选择视频文件').setInputFiles(media);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('video').evaluate((video) => video.pause());
  await choose('save', directory);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('heading', { name: '字幕校对', exact: true }).waitFor();
  await choose('open', subtitle);
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await page.getByRole('button', { name: '编辑第 2 条字幕', exact: true }).click();
  await page.getByLabel('字幕开始时间').fill('0.9');
  await page.getByLabel('字幕文本', { exact: true }).fill('这是一句保存后的字幕。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.locator('.cue-text').filter({ hasText: '这是一句保存后的字幕。' }).waitFor();
  await page.getByRole('button', { name: '撤销字幕修改' }).click();
  await page.locator('.cue-text').filter({ hasText: 'A longer subtitle for editing.' }).waitFor();
  await page.getByRole('button', { name: '重做字幕修改' }).click();
  await page.locator('.cue-text').filter({ hasText: '这是一句保存后的字幕。' }).waitFor();
  await page.getByText('导出字幕', { exact: true }).click();
  await choose('save', exported);
  await page.getByRole('button', { name: '导出文件', exact: true }).click();
  await page.getByText('已导出 编辑结果.srt', { exact: true }).waitFor();
  assert.match(
    await readFile(exported, 'utf8'),
    /00:00:00,900 --> 00:00:01,800\n这是一句保存后的字幕。/,
  );
  await page.getByText('导出字幕', { exact: true }).click();
  await page.locator('video').evaluate((video) => {
    video.pause();
    video.currentTime = 1.25;
  });
  await page.getByRole('button', { name: '编辑第 2 条字幕', exact: true }).click();
  await page.getByLabel('字幕文本', { exact: true }).fill('未保存草稿');
  for (const [width, height, theme, name] of [
    [1280, 782, 'light', 'default-light'],
    [1280, 782, 'dark', 'default-dark'],
    [640, 480, 'light', 'narrow-editor'],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    if (!executable) await page.screenshot({ path: join(output, `${name}.png`) });
    const layout = await page.evaluate(() => {
      const editor = document.querySelector('.cue-editor').getBoundingClientRect();
      const controls = document.querySelector('.player-controls').getBoundingClientRect();
      return {
        horizontal: document.documentElement.scrollWidth > window.innerWidth,
        vertical: document.documentElement.scrollHeight > window.innerHeight,
        editorInside: editor.bottom <= controls.top && editor.top >= 0,
      };
    });
    assert.deepEqual(layout, { horizontal: false, vertical: false, editorInside: true });
  }
  await application.evaluate(({ dialog, BrowserWindow }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async () => {
      dialog.showMessageBox = original;
      return { response: 0, checkboxChecked: false };
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.getByLabel('字幕文本', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('字幕文本', { exact: true }).inputValue(), '未保存草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await close();
  await launch();
  await page.getByRole('heading', { name: '字幕校对', exact: true }).waitFor();
  await page.locator('.cue-text').filter({ hasText: '这是一句保存后的字幕。' }).waitFor();
  assert.equal(await page.locator('.cue-text').filter({ hasText: '未保存草稿' }).count(), 0);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.ok(
    await page
      .locator('video')
      .evaluate((video) => video.paused && Math.abs(video.currentTime - 1.25) < 0.1),
  );
  // A killed utility process must reconnect without losing committed edits.
  await application.evaluate(({ app }) => {
    const service = app
      .getAppMetrics()
      .find((metric) => metric.name === 'CueWeave Background Service');
    if (!service) throw new Error('Service not found');
    process.kill(service.pid);
  });
  await page.getByRole('button', { name: '撤销字幕修改' }).click();
  await page.locator('.cue-text').filter({ hasText: 'A longer subtitle for editing.' }).waitFor();
  await close();
  await rename(media, moved);
  await launch();
  await page.getByRole('button', { name: '重新定位原视频', exact: true }).waitFor();
  await choose('open', join(root, '.fixtures/desktop/D0 中文 sample.webm'));
  await page.getByRole('button', { name: '重新定位原视频', exact: true }).click();
  await page
    .getByText('所选视频与原视频内容不同，未替换媒体或字幕。请选择原视频。', { exact: true })
    .waitFor();
  await choose('open', moved);
  await page.getByRole('button', { name: '重新定位原视频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(await page.getByRole('button', { name: '重新定位原视频', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await close();
  application = null;
  await writeFile(
    join(output, 'acceptance.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'create/import/edit/time/undo/redo/export',
          'default/light/dark/narrow-layout',
          'unsaved-close-protection',
          'restart-with-position',
          'service-crash-recovery',
          'missing-media-and-content-relink',
        ],
        temporary,
      },
      null,
      2,
    ),
  );
  console.log('D1 project UI acceptance passed, with silent playback.');
} catch (error) {
  console.error(error);
  if (!executable && page && !page.isClosed())
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
}
