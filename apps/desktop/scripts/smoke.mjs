import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import process from 'node:process';
import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { resolveConfig } from 'electron-vite';

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDirectory = join(desktopDirectory, '../../.impeccable/review/desktop-smoke');
await mkdir(outputDirectory, { recursive: true });
const manifest = JSON.parse(await readFile(join(desktopDirectory, 'package.json'), 'utf8'));
const packagedExecutable = process.env.CUEWEAVE_SMOKE_EXECUTABLE;
const results = [];
const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');
const fixtureDirectory = join(desktopDirectory, '../../.fixtures/desktop');
const fixturePaths = [
  join(fixtureDirectory, 'D0 中文 sample.mp4'),
  join(fixtureDirectory, 'D0 中文 sample.webm'),
];
await mkdir(fixtureDirectory, { recursive: true });
const fixturesReady = await Promise.all(
  fixturePaths.map((path) =>
    stat(path).then(
      (value) => value.size > 0,
      () => false,
    ),
  ),
);
if (!fixturesReady.every(Boolean)) {
  await promisify(execFile)(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      '3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      fixturePaths[0],
    ],
    { windowsHide: true },
  );
  await promisify(execFile)(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      '3',
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-c:a',
      'libopus',
      fixturePaths[1],
    ],
    { windowsHide: true },
  );
}

async function check(mode, rendererUrl) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  if (rendererUrl) env.ELECTRON_RENDERER_URL = rendererUrl;
  env.CUEWEAVE_TEST_USER_DATA = await mkdtemp(join(tmpdir(), `cueweave-smoke-${mode}-`));
  const application = await electron.launch({
    ...(mode === 'packaged' && packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: [
      ...(mode === 'packaged' && packagedExecutable ? [] : [desktopDirectory]),
      '--hidden',
      '--mute-audio',
      ...(process.env.CUEWEAVE_TEST_DISABLE_GPU_SANDBOX === '1' ? ['--disable-gpu-sandbox'] : []),
    ],
    env,
    timeout: 30000,
  });
  const errors = [];
  try {
    const page = await application.firstWindow({ timeout: 15000 });
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('heading', { name: '打开一个视频开始工作' }).waitFor();
    assert.equal(
      await application.evaluate(
        ({ app, BrowserWindow }) =>
          app.commandLine.hasSwitch('mute-audio') &&
          BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
      ),
      true,
    );
    if (mode !== 'packaged') {
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(outputDirectory, `${mode}-empty.png`) });
      await page.getByRole('button', { name: '读取链接', exact: true }).click();
      await page.getByText('请输入视频链接。', { exact: true }).waitFor();
      await page.screenshot({ path: join(outputDirectory, `${mode}-import-error.png`) });
    }
    const exposed = await page.evaluate(() => ({
      methods: Object.keys(window.cueweave).sort(),
      require: typeof window.require,
      process: typeof window.process,
    }));
    assert.deepEqual(exposed, {
      methods: [
        'cancelLinkImport',
        'clearSiteLogin',
        'getAppInfo',
        'getSiteLoginStatus',
        'inspectLink',
        'loadOnlineSubtitle',
        'onLinkImportEvent',
        'onlineTranslation',
        'openFontLicense',
        'openSiteLogin',
        'pickMedia',
        'pickPlayerSubtitle',
        'probeMedia',
        'projectCommand',
        'registerDroppedMedia',
        'settingsCommand',
        'startLinkImport',
      ],
      require: 'undefined',
      process: 'undefined',
    });
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.webviewTag, false);
    const info = await page.evaluate(() => window.cueweave.getAppInfo());
    assert.deepEqual(info, { ok: true, value: { name: 'CueWeave', version: manifest.version } });
    const injectedCookies = await application.evaluate(async ({ session }) => {
      const cookies = session.fromPartition('persist:cueweave-site-login').cookies;
      await cookies.set({
        url: 'https://www.bilibili.com/',
        path: '/',
        name: 'SESSDATA',
        value: 'smoke-session',
        secure: true,
        httpOnly: true,
      });
      return cookies.get({ url: 'https://www.bilibili.com/' });
    });
    assert.ok(injectedCookies.some((cookie) => cookie.name === 'SESSDATA'));
    assert.deepEqual(await page.evaluate(() => window.cueweave.getSiteLoginStatus('bilibili')), {
      ok: true,
      value: { site: 'bilibili', signedIn: true },
    });
    await page.getByLabel('视频链接').fill('https://www.bilibili.com/video/BV1qNtd6sEai/');
    await page.getByLabel('网站账号').selectOption('app');
    await page.getByText('已登录 · 哔哩哔哩', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除登录' }).click();
    await page.getByText('未登录 · 哔哩哔哩', { exact: true }).waitFor();
    await page.getByLabel('网站账号').selectOption('none');
    await page.getByLabel('视频链接').fill('');
    const media = [];
    for (const fixturePath of fixturePaths) {
      const name = fixturePath.split(/[\\/]/).at(-1);
      await page.getByLabel('选择视频文件').setInputFiles(fixturePath);
      await page.getByRole('heading', { name }).waitFor();
      await page.waitForFunction(() => {
        const control = document.querySelector('input[aria-label="播放进度"]');
        return (
          control instanceof window.HTMLInputElement &&
          !control.disabled &&
          Number(control.max) > 2.5
        );
      });
      await page.locator('video').evaluate((video) => {
        video.currentTime = 1;
      });
      await page.waitForFunction(() => {
        const control = document.querySelector('input[aria-label="播放进度"]');
        return control instanceof window.HTMLInputElement && Number(control.value) >= 0.9;
      });
      const observed = await page.getByLabel('播放进度').evaluate((control) => ({
        duration: Number(control.max),
        currentTime: Number(control.value),
      }));
      assert.ok(observed.duration > 2.5);
      assert.ok(observed.currentTime >= 0.9);
      media.push({ name, ...observed });
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    // The desktop workspace must fit the window, including controls, at every supported size.
    for (const [width, height] of [
      [1120, 720],
      [960, 640],
      [640, 480],
    ]) {
      await application.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
        [width, height],
      );
      await page.waitForFunction(() => {
        const rect = document.querySelector('.player-controls').getBoundingClientRect();
        return rect.height > 0 && rect.bottom <= window.innerHeight;
      });
      assert.deepEqual(
        await page.evaluate(() => ({
          horizontal: document.documentElement.scrollWidth > window.innerWidth,
          vertical: document.documentElement.scrollHeight > window.innerHeight,
          controlsVisible: [
            ...document.querySelectorAll(
              '.player-controls button, .player-controls input, .player-controls select',
            ),
          ].every((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= window.innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight
            );
          }),
        })),
        { horizontal: false, vertical: false, controlsVisible: true },
      );
    }
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1120, 720),
    );
    await page.locator('video').evaluate((video) => {
      video.pause();
      video.currentTime = 1;
      video.dataset.continuity = 'same-element';
    });
    const subtitlePath = join(fixtureDirectory, 'D1 layout subtitles.vtt');
    await writeFile(
      subtitlePath,
      'WEBVTT\n\n00:00.000 --> 00:00.800\nFirst subtitle.\n\n00:00.800 --> 00:01.800\nA longer subtitle with enough text to verify wrapping inside the panel.\n\n00:01.800 --> 00:03.000\n最后一句字幕，用于检查中文显示和点击定位。\n' +
        Array.from(
          { length: 500 },
          (_, index) =>
            `\n00:${String(Math.floor((index + 4) / 60)).padStart(2, '0')}:${String((index + 4) % 60).padStart(2, '0')}.000 --> 00:${String(Math.floor((index + 5) / 60)).padStart(2, '0')}:${String((index + 5) % 60).padStart(2, '0')}.000\nLayout fixture ${index + 4}: this is a deliberately long subtitle to exercise independent scrolling.\n`,
        ).join(''),
    );
    await application.evaluate(({ dialog }, path) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [path] };
      };
    }, subtitlePath);
    await page.getByRole('button', { name: '字幕', exact: true }).click();
    await page.getByRole('button', { name: '加载字幕', exact: true }).click();
    await page.getByLabel('搜索字幕').fill('最后一句');
    await page.locator('.subtitle-row').click();
    assert.ok(
      await page
        .locator('video')
        .evaluate((video) => video.currentTime >= 1.8 && video.currentTime < 2),
    );
    await page.getByLabel('搜索字幕').fill('');
    await page.getByRole('button', { name: '定位当前句', exact: true }).click();
    assert.equal(await page.locator('.subtitle-row[aria-current="true"]').count(), 1);
    await page.locator('.subtitle-list').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollTop), 0);
    await page.getByRole('button', { name: '定位当前句', exact: true }).click();
    await page.getByRole('button', { name: '打开其他视频', exact: true }).click();
    await page.getByRole('dialog', { name: '打开视频', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('video').evaluate((video) => video.dataset.continuity),
      'same-element',
    );
    assert.ok(
      await page.locator('video').evaluate((video) => video.paused && video.currentTime >= 1.8),
    );
    if (mode !== 'packaged') {
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        await page.screenshot({ path: join(outputDirectory, `${mode}-subtitles-${theme}.png`) });
      }
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
      );
      await page.screenshot({ path: join(outputDirectory, `${mode}-subtitles-narrow.png`) });
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('.player-controls').getBoundingClientRect().bottom <=
            window.innerHeight,
        ),
        true,
      );
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1120, 720),
      );
    }
    if (mode !== 'packaged')
      await page.screenshot({
        path: join(outputDirectory, `${mode}-workspace.png`),
        fullPage: true,
      });
    await page.getByRole('button', { name: '关于', exact: true }).click();
    await page.getByText(manifest.version, { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.activeElement === document.querySelector('dialog h1'),
    );
    assert.equal(
      await page
        .getByRole('dialog')
        .locator('h1')
        .evaluate((element) => element === document.activeElement),
      true,
    );
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      if (mode !== 'packaged')
        await page.screenshot({
          path: join(outputDirectory, `${mode}-about-${theme}.png`),
          fullPage: true,
        });
    }
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
    );
    if (mode !== 'packaged')
      await page.screenshot({
        path: join(outputDirectory, `${mode}-about-narrow.png`),
        fullPage: true,
      });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.getByRole('button', { name: '返回工作台' }).click();
    assert.equal(
      await page.locator('video').evaluate((video) => video.dataset.continuity),
      'same-element',
    );
    assert.ok(
      await page.locator('video').evaluate((video) => video.paused && video.currentTime >= 1.8),
    );
    assert.equal(
      await page
        .getByRole('button', { name: '关于', exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '跟随系统', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    assert.equal(
      await page.locator('video').evaluate((video) => video.dataset.continuity),
      'same-element',
    );
    assert.ok(
      await page.locator('video').evaluate((video) => video.paused && video.currentTime >= 1.8),
    );
    assert.ok(
      await page
        .getByRole('button', { name: '设置', exact: true })
        .evaluate((element) => element === document.activeElement),
    );
    const windowCount = (await application.windows()).length;
    await page.evaluate(() => window.open('https://example.invalid/'));
    assert.equal((await application.windows()).length, windowCount);
    assert.deepEqual(errors, []);
    const exited = once(application.process(), 'exit');
    await application.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 0);
    });
    const timer = setTimeout(() => application.process().kill(), 10000);
    const [code, signal] = await exited;
    clearTimeout(timer);
    assert.equal(code, 0, `Window close failed: ${signal}`);
    results.push({
      mode,
      appInfo: info.value,
      media,
      sandbox: true,
      nodeIntegration: false,
      cleanExit: true,
    });
  } finally {
    await application.close().catch(() => {});
  }
}

if (packagedExecutable) {
  await check('packaged');
} else {
  await check('production');
  const resolved = await resolveConfig({ root: desktopDirectory }, 'serve');
  assert.ok(resolved.config?.renderer);
  const server = await createServer({
    ...resolved.config.renderer,
    configFile: false,
    server: { ...resolved.config.renderer.server, port: 0, strictPort: false },
  });
  try {
    await server.listen();
    await check('development', server.resolvedUrls.local[0]);
  } finally {
    await server.close();
  }
}
await writeFile(join(outputDirectory, 'result.json'), `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(
  packagedExecutable
    ? 'Desktop smoke passed: packaged app; unified playback, isolated IPC, UI, and window exit.\n'
    : 'Desktop smoke passed: production and development; unified playback, isolated IPC, UI, and window exit.\n',
);
