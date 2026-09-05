import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(desktop, '../../.impeccable/review/desktop-controls');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'cueweave-controls-'));
const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let application;
try {
  application = await electron.launch({
    args: [
      desktop,
      '--hidden',
      '--mute-audio',
      ...(process.env.CUEWEAVE_TEST_DISABLE_GPU_SANDBOX === '1' ? ['--disable-gpu-sandbox'] : []),
    ],
    env,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await page.evaluate(() => window.CSS.supports('appearance', 'base-select')), true);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
    ),
    true,
  );
  await page
    .getByLabel('选择视频文件')
    .setInputFiles(join(desktop, '../../.fixtures/desktop/D0 中文 sample.mp4'));
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('video').evaluate((video) => video.pause());
  const videoUrl = await page.locator('video').getAttribute('src');
  await application.evaluate(({ ipcMain }, videoUrl) => {
    ipcMain.removeHandler('cueweave:link:inspect');
    ipcMain.handle('cueweave:link:inspect', () => ({
      ok: true,
      value: {
        kind: 'website',
        url: 'https://www.youtube.com/watch?v=controltest',
        title: '控件验收样本',
        source: '测试样本',
        durationSeconds: 3,
        playback: {
          kind: 'dom',
          defaultVariantId: '1080',
          subtitles: [],
          variants: ['1080', '720', '480', '360', '240', '144'].map((height) => ({
            id: height,
            label: `${height}p${height === '1080' ? ' 高码率' : ''} · H.264`,
            videoCodec: 'h264',
            videoUrl,
          })),
        },
      },
    }));
    ipcMain.removeHandler('cueweave:player:subtitle-pick');
    ipcMain.handle('cueweave:player:subtitle-pick', () => ({
      ok: true,
      value: {
        name: '控件验收字幕.srt',
        content: Array.from({ length: 100 }, (_, index) => {
          const time = (seconds) =>
            `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
          return `${index + 1}\n${time(index * 3)} --> ${time(index * 3 + 3)}\n第 ${index + 1} 条控件验收字幕。\n`;
        }).join('\n'),
      },
    }));
  }, videoUrl);
  await page.getByRole('button', { name: '打开其他视频', exact: true }).click();
  await page.getByLabel('视频链接').fill('https://www.youtube.com/watch?v=controltest');
  await page.getByRole('button', { name: '读取链接', exact: true }).click();
  await page.getByRole('button', { name: '在线播放', exact: true }).click();
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  await page.getByRole('button', { name: '加载字幕', exact: true }).click();
  await page.locator('.subtitle-source-options summary').click();
  const replace = page.getByRole('button', { name: '更换字幕文件', exact: true });
  const padding = await replace.evaluate((el) => ({
    left: parseFloat(window.getComputedStyle(el).paddingLeft),
    right: parseFloat(window.getComputedStyle(el).paddingRight),
  }));
  assert.ok(padding.left >= 10 && padding.right >= 10);
  const quality = page.getByLabel('清晰度', { exact: true });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
    );
    await page.evaluate(() => document.fonts.ready);
    await replace.hover();
    await page.screenshot({ path: join(output, `workspace-${theme}.png`) });
    await quality.click();
    await page.waitForFunction(() => Boolean(document.querySelector('select:open')));
    const options = await quality.locator('option').evaluateAll((options) =>
      options.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    assert.ok(
      options.every((r) => r.left >= 0 && r.right <= 1280 && r.top >= 0 && r.bottom <= 782),
    );
    await page.screenshot({ path: join(output, `quality-${theme}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await quality.inputValue(), '1080');
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
    );
    await quality.click();
    await page.waitForFunction(() => Boolean(document.querySelector('select:open')));
    await page.screenshot({ path: join(output, `quality-narrow-${theme}.png`) });
    assert.ok(
      await quality.locator('option').evaluateAll((options) =>
        options.every((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= window.innerWidth &&
            r.top >= 0 &&
            r.bottom <= window.innerHeight
          );
        }),
      ),
    );
    await page.keyboard.press('Escape');
  }
  await quality.click();
  await page.getByRole('option', { name: '720p · H.264', exact: true }).click();
  assert.equal(await quality.inputValue(), '720');
  await quality.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  assert.equal(await quality.inputValue(), '1080');
  await quality.click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await quality.inputValue(), '1080');
  await quality.click();
  await page.getByRole('heading', { name: '控件验收样本', exact: true }).click();
  assert.equal(await page.locator('select:open').count(), 0);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await quality.click();
  await page.getByRole('option', { name: '720p · H.264', exact: true }).click();
  assert.equal(await quality.inputValue(), '720');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const protocol = page.getByLabel('接口协议', { exact: true });
  await protocol.waitFor();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
    );
    await page.locator('.settings-scroll').evaluate((el) => (el.scrollTop = 0));
    await protocol.click();
    await page.screenshot({ path: join(output, `settings-${theme}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(
      await page.getByRole('heading', { name: '设置', exact: true }).count(),
      1,
      'Escape closes picker, not settings',
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
    );
    await page.locator('.settings-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: join(output, `settings-scroll-${theme}.png`) });
  }
  await protocol.click();
  await page.getByRole('option', { name: 'Responses', exact: true }).click();
  assert.equal(await protocol.inputValue(), 'responses');
  const scroll = await page.locator('.settings-scroll').evaluate((el) => ({
    width: window.getComputedStyle(el, '::-webkit-scrollbar').width,
    thumb: window.getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
    buttons: window.getComputedStyle(el, '::-webkit-scrollbar-button').display,
  }));
  assert.equal(scroll.width, '10px');
  assert.equal(scroll.buttons, 'none');
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      { ok: true, padding, scroll, keyboard: true, fullscreen: true, screenshots: 10 },
      null,
      2,
    ),
  );
  console.log(
    'Desktop controls acceptance passed: padding, themed pickers, mouse/keyboard, Escape, fullscreen and scrollbars.',
  );
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
}
