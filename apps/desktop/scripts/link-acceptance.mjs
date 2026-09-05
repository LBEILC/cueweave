import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearInterval, setInterval } from 'node:timers';
import { _electron as electron } from 'playwright';

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = join(desktopDirectory, '../../.impeccable/review/desktop-links');
const fixture = join(desktopDirectory, '../../.fixtures/desktop/D0 H264 AAC 中文.mp4');
const fixtureStat = await stat(fixture);
const fixtureBytes = await readFile(fixture);
await mkdir(evidenceDirectory, { recursive: true });

const server = createServer((request, response) => {
  if (request.url === '/redirect.mp4') {
    response.writeHead(302, { Location: '/no-head.mp4' });
    response.end();
    return;
  }
  if (
    request.url !== '/video.mp4' &&
    request.url !== '/no-head.mp4' &&
    request.url !== '/slow.mp4'
  ) {
    response.writeHead(404).end();
    return;
  }
  if (request.url === '/no-head.mp4' && request.method === 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
  const start = range ? Number(range[1]) : 0;
  response.writeHead(range ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
    'Content-Length': fixtureStat.size - start,
    ...(range
      ? { 'Content-Range': `bytes ${start}-${fixtureStat.size - 1}/${fixtureStat.size}` }
      : {}),
  });
  if (request.method === 'HEAD') {
    response.end();
  } else if (request.url === '/slow.mp4') {
    let offset = start;
    const timer = setInterval(() => {
      if (offset >= fixtureBytes.length) {
        clearInterval(timer);
        response.end();
        return;
      }
      const end = Math.min(offset + 8192, fixtureBytes.length);
      response.write(fixtureBytes.subarray(offset, end));
      offset = end;
    }, 50);
    response.once('close', () => clearInterval(timer));
  } else createReadStream(fixture, { start }).pipe(response);
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const directUrl = `http://127.0.0.1:${address.port}/redirect.mp4`;

async function waitForPlayer(page, minimumDuration = 0) {
  await page.waitForFunction((minimum) => {
    const control = document.querySelector('input[aria-label="播放进度"]');
    return (
      control instanceof window.HTMLInputElement &&
      !control.disabled &&
      Number(control.max) > minimum
    );
  }, minimumDuration);
  return page.getByLabel('播放进度').evaluate((control) => ({
    duration: Number(control.max),
    currentTime: Number(control.value),
  }));
}

async function muteApplication(application) {
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
  });
}

async function check(name, url, expectedTitle) {
  const testUserData = await mkdtemp(join(tmpdir(), `cueweave-link-${name}-`));
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: testUserData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executable = process.env.CUEWEAVE_LINK_EXECUTABLE;
  const application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: executable
      ? ['--hidden', '--link-check', '--mute-audio']
      : [desktopDirectory, '--hidden', '--link-check', '--mute-audio'],
    env,
    timeout: 30_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 20_000 });
    await muteApplication(application);
    page.setDefaultTimeout(name === 'youtube' ? 180_000 : 30_000);
    await page.getByLabel('视频链接').fill(url);
    await page.getByRole('button', { name: '读取链接' }).click();
    await page.getByText(expectedTitle, { exact: false }).first().waitFor();
    if (name === 'direct') {
      await page.getByRole('button', { name: '在线播放' }).click();
      await waitForPlayer(page);
      assert.equal(await page.locator('video').count(), 1);
      assert.equal(await page.locator('iframe').count(), 0);
      await page.getByRole('button', { name: '打开其他视频' }).click();
    }
    await page.getByRole('button', { name: '下载', exact: true }).click();
    const observed = await waitForPlayer(page);
    assert.ok(Number.isFinite(observed.duration) && observed.duration > 0);
    const downloads = join(testUserData, 'downloads');
    const downloaded = await readdir(downloads);
    assert.ok(downloaded.some((file) => /\.(mp4|webm|mkv|mov)$/i.test(file)));
    if (!executable)
      await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
    return { name, url, observed, downloaded: downloaded.map((file) => basename(file)) };
  } finally {
    await application.close().catch(() => {});
  }
}

async function checkCancelAndResume() {
  const testUserData = await mkdtemp(join(tmpdir(), 'cueweave-link-resume-'));
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: testUserData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executable = process.env.CUEWEAVE_LINK_EXECUTABLE;
  const application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: executable
      ? ['--hidden', '--link-check', '--mute-audio']
      : [desktopDirectory, '--hidden', '--link-check', '--mute-audio'],
    env,
    timeout: 30_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 20_000 });
    await muteApplication(application);
    page.setDefaultTimeout(30_000);
    await page.getByLabel('视频链接').fill(`http://127.0.0.1:${address.port}/slow.mp4`);
    await page.getByRole('button', { name: '读取链接' }).click();
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await page.getByText('正在下载视频…').waitFor();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '取消下载' }).click();
    const downloads = join(testUserData, 'downloads');
    await page.waitForTimeout(300);
    const partial = await readdir(downloads);
    assert.ok(partial.some((file) => file.endsWith('.part')));
    assert.ok(!partial.some((file) => /\.(mp4|webm|mkv|mov)$/i.test(file)));
    await page.getByRole('button', { name: '下载', exact: true }).click();
    await waitForPlayer(page);
    const files = await readdir(downloads);
    assert.ok(files.some((file) => file.endsWith('.mp4')));
    assert.ok(!files.some((file) => file.endsWith('.part')));
    return { name: 'cancel-resume', partialRetained: true, completedAfterRetry: true };
  } finally {
    await application.close().catch(() => {});
  }
}

async function checkYoutubeStreaming() {
  const name = 'youtube-streaming';
  const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const testUserData = await mkdtemp(join(tmpdir(), 'cueweave-link-large-metadata-'));
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: testUserData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executable = process.env.CUEWEAVE_LINK_EXECUTABLE;
  const application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: executable
      ? ['--hidden', '--link-check', '--mute-audio']
      : [desktopDirectory, '--hidden', '--link-check', '--mute-audio'],
    env,
    timeout: 30_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 20_000 });
    await muteApplication(application);
    page.setDefaultTimeout(180_000);
    await page.getByLabel('视频链接').fill(url);
    await page.getByRole('button', { name: '读取链接' }).click();
    await page.getByText('Me at the zoo', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: '下载', exact: true }).waitFor();
    await page.getByRole('button', { name: '在线播放' }).click();
    await page.getByRole('button', { name: '静音' }).click();
    const qualityOptions = await page.getByLabel('清晰度').locator('option').allTextContents();
    assert.ok(qualityOptions.some((label) => label.includes('240p')));
    assert.ok(qualityOptions.some((label) => label.includes('144p')));
    await page.getByRole('button', { name: '字幕', exact: true }).click();
    const subtitleOptions = await page.getByLabel('在线字幕').locator('option').allTextContents();
    assert.ok(subtitleOptions.includes('English（人工）'));
    assert.ok(subtitleOptions.includes('en（自动）'));
    await page.getByLabel('在线字幕').selectOption({ label: 'English（人工）' });
    await page.locator('.subtitle-overlay').waitFor();
    await page.locator('.subtitle-source-options > summary').click();
    await page.getByLabel('在线字幕').selectOption({ label: 'en（自动）' });
    await page.locator('.subtitle-overlay').waitFor({ state: 'hidden' });
    await page.locator('.subtitle-overlay').waitFor();
    await page.waitForTimeout(8_000);
    await waitForPlayer(page, 10);
    const mediaDiagnostics = await page.locator('video, audio').evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName,
        currentTime: element.currentTime,
        duration: element.duration,
        paused: element.paused,
        readyState: element.readyState,
        networkState: element.networkState,
        error: element.error ? { code: element.error.code, message: element.error.message } : null,
        videoWidth: element instanceof window.HTMLVideoElement ? element.videoWidth : undefined,
        videoHeight: element instanceof window.HTMLVideoElement ? element.videoHeight : undefined,
      })),
    );
    const videoDiagnostic = mediaDiagnostics.find((item) => item.tag === 'VIDEO');
    const audioDiagnostic = mediaDiagnostics.find((item) => item.tag === 'AUDIO');
    assert.ok(videoDiagnostic && videoDiagnostic.readyState >= 2 && videoDiagnostic.videoWidth > 0);
    assert.ok(audioDiagnostic && audioDiagnostic.readyState >= 2);
    assert.ok(Math.abs(videoDiagnostic.currentTime - audioDiagnostic.currentTime) < 0.35);
    await page.waitForFunction(() => {
      const control = document.querySelector('input[aria-label="播放进度"]');
      return control instanceof window.HTMLInputElement && Number(control.value) > 0;
    });
    const videoState = await waitForPlayer(page, 10);
    assert.ok(videoState.currentTime > 0);
    assert.ok(Number.isFinite(videoState.duration) && videoState.duration > 10);
    assert.equal(await page.locator('video').count(), 1);
    assert.equal(await page.locator('audio').count(), 1);
    assert.equal(await page.locator('iframe').count(), 0);
    if (!executable)
      await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
    return {
      name,
      url,
      title: 'Me at the zoo',
      durationSeconds: 19,
      playerState: videoState,
      qualityOptions,
      subtitleOptions,
      mediaDiagnostics,
    };
  } finally {
    await application.close().catch(() => {});
  }
}

async function checkYoutubeHighResolution() {
  const name = 'youtube-4k-streaming';
  const url = 'https://www.youtube.com/watch?v=LXb3EKWsInQ';
  const testUserData = await mkdtemp(join(tmpdir(), 'cueweave-link-youtube-4k-'));
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: testUserData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executable = process.env.CUEWEAVE_LINK_EXECUTABLE;
  const application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: executable
      ? ['--hidden', '--link-check', '--mute-audio']
      : [desktopDirectory, '--hidden', '--link-check', '--mute-audio'],
    env,
    timeout: 30_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 20_000 });
    await muteApplication(application);
    page.setDefaultTimeout(180_000);
    await page.getByLabel('视频链接').fill(url);
    await page.getByRole('button', { name: '读取链接' }).click();
    await page.getByRole('button', { name: '在线播放' }).waitFor();
    await page.getByRole('button', { name: '在线播放' }).click();
    const qualityOptions = await page.getByLabel('清晰度').locator('option').allTextContents();
    assert.ok(qualityOptions.some((label) => label.includes('2160p（4K）')));
    assert.ok(qualityOptions.some((label) => label.includes('1440p（2K）')));
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return (
        video instanceof window.HTMLVideoElement &&
        video.videoWidth === 3840 &&
        video.videoHeight === 2160 &&
        video.readyState >= 2
      );
    });
    const diagnostic = await page.locator('video').evaluate((video) => ({
      currentTime: video.currentTime,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
    }));
    if (!executable)
      await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
    return { name, url, qualityOptions, diagnostic };
  } finally {
    await application.close().catch(() => {});
  }
}

async function checkBilibiliStreaming() {
  const name = 'bilibili-streaming';
  const url =
    'https://www.bilibili.com/video/BV1qNtd6sEai/?spm_id_from=333.1007.tianma.1-3-3.click&vd_source=b023077870314f86318148e1e6c43bb3';
  const testUserData = await mkdtemp(join(tmpdir(), 'cueweave-link-bilibili-'));
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: testUserData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const executable = process.env.CUEWEAVE_LINK_EXECUTABLE;
  const application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: executable
      ? ['--hidden', '--link-check', '--mute-audio']
      : [desktopDirectory, '--hidden', '--link-check', '--mute-audio'],
    env,
    timeout: 30_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 20_000 });
    await muteApplication(application);
    page.setDefaultTimeout(180_000);
    await page.getByLabel('视频链接').fill(url);
    await page.getByLabel('网站账号').selectOption('app');
    await page.getByText('未登录 · 哔哩哔哩', { exact: true }).waitFor();
    const loginWindowPromise = application.waitForEvent('window');
    await page.getByRole('button', { name: '打开登录窗口' }).click();
    const loginPage = await loginWindowPromise;
    await loginPage.waitForLoadState('domcontentloaded');
    assert.equal(new URL(loginPage.url()).hostname, 'passport.bilibili.com');
    const loginPreferences = await application.evaluate(({ BrowserWindow }) => {
      const loginWindow = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('passport.bilibili.com'),
      );
      return loginWindow?.webContents.getLastWebPreferences();
    });
    assert.equal(loginPreferences?.sandbox, true);
    assert.equal(loginPreferences?.contextIsolation, true);
    assert.equal(loginPreferences?.nodeIntegration, false);
    assert.equal(loginPreferences?.webviewTag, false);
    assert.equal(loginPreferences?.preload, undefined);
    await loginPage.close();
    await page.getByText('未登录 · 哔哩哔哩', { exact: true }).waitFor();
    await page.getByRole('button', { name: '读取链接' }).click();
    await page.getByRole('button', { name: '在线播放' }).waitFor();
    const title = await page.locator('.link-preview strong').innerText();
    assert.ok(!title.includes('�'));
    await page.getByRole('button', { name: '在线播放' }).click();
    await page.getByRole('button', { name: '静音' }).click();
    await page.waitForTimeout(8_000);
    const qualityOptions = await page.getByLabel('清晰度').locator('option').allTextContents();
    assert.ok(qualityOptions.some((label) => /1080p/i.test(label)));
    assert.ok(qualityOptions.some((label) => /720p/i.test(label)));
    const beforeSwitch = await page.locator('video').evaluate((video) => video.currentTime);
    const option720p = qualityOptions.find((label) => /720p/i.test(label));
    assert.ok(option720p);
    await page.getByLabel('清晰度').selectOption({ label: option720p });
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return (
        video instanceof window.HTMLVideoElement &&
        video.videoHeight === 720 &&
        video.readyState >= 2
      );
    });
    const afterSwitch = await page.locator('video').evaluate((video) => ({
      currentTime: video.currentTime,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    }));
    assert.equal(afterSwitch.videoHeight, 720);
    assert.ok(afterSwitch.currentTime >= beforeSwitch - 0.75);
    const mediaDiagnostics = await page.locator('video, audio').evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName,
        currentTime: element.currentTime,
        duration: element.duration,
        paused: element.paused,
        readyState: element.readyState,
        networkState: element.networkState,
        error: element.error ? { code: element.error.code, message: element.error.message } : null,
        videoWidth: element instanceof window.HTMLVideoElement ? element.videoWidth : undefined,
        videoHeight: element instanceof window.HTMLVideoElement ? element.videoHeight : undefined,
      })),
    );
    const videoDiagnostic = mediaDiagnostics.find((item) => item.tag === 'VIDEO');
    const audioDiagnostic = mediaDiagnostics.find((item) => item.tag === 'AUDIO');
    assert.ok(videoDiagnostic && videoDiagnostic.readyState >= 2 && videoDiagnostic.videoWidth > 0);
    assert.ok(audioDiagnostic && audioDiagnostic.readyState >= 2);
    assert.ok(Math.abs(videoDiagnostic.currentTime - audioDiagnostic.currentTime) < 0.35);
    await waitForPlayer(page, 300);
    await page.waitForFunction(() => {
      const control = document.querySelector('input[aria-label="播放进度"]');
      return control instanceof window.HTMLInputElement && Number(control.value) > 0;
    });
    const playerState = await waitForPlayer(page, 300);
    assert.equal(await page.locator('video').count(), 1);
    assert.equal(await page.locator('audio').count(), 1);
    assert.equal(await page.locator('iframe').count(), 0);
    if (!executable)
      await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
    await page.evaluate(() => window.scrollTo(0, Math.min(360, document.body.scrollHeight)));
    const scrolledBox = await page.locator('video').boundingBox();
    assert.ok(scrolledBox && scrolledBox.y < 220);
    if (!executable)
      await page.screenshot({ path: join(evidenceDirectory, `${name}-scrolled.png`) });
    return { name, url, title, playerState, qualityOptions, afterSwitch, mediaDiagnostics };
  } finally {
    await application.close().catch(() => {});
  }
}

try {
  const results = [];
  const record = async (label, operation) => {
    process.stdout.write(`Checking ${label}...\n`);
    const result = await operation();
    results.push(result);
    process.stdout.write(`Passed ${label}.\n`);
  };
  if (process.env.CUEWEAVE_LINK_ONLY === 'local') {
    await record('direct URL playback and download', () =>
      check('direct', directUrl, 'no-head.mp4'),
    );
    await record('download cancellation and resume', checkCancelAndResume);
  } else if (process.env.CUEWEAVE_LINK_ONLY === 'bilibili') {
    await record('Bilibili streaming', checkBilibiliStreaming);
  } else if (process.env.CUEWEAVE_LINK_ONLY === 'youtube') {
    await record('YouTube streaming', checkYoutubeStreaming);
  } else if (process.env.CUEWEAVE_LINK_ONLY === 'youtube-4k') {
    await record('YouTube 4K streaming', checkYoutubeHighResolution);
  } else {
    await record('direct URL playback and download', () =>
      check('direct', directUrl, 'no-head.mp4'),
    );
    await record('download cancellation and resume', checkCancelAndResume);
    await record('YouTube streaming', checkYoutubeStreaming);
    await record('YouTube 4K streaming', checkYoutubeHighResolution);
    await record('Bilibili streaming', checkBilibiliStreaming);
    await record('YouTube download', () =>
      check('youtube', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'Me at the zoo'),
    );
  }
  await writeFile(
    join(
      evidenceDirectory,
      process.env.CUEWEAVE_LINK_ONLY
        ? `acceptance-${process.env.CUEWEAVE_LINK_ONLY}.json`
        : 'acceptance.json',
    ),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  process.stdout.write(
    process.env.CUEWEAVE_LINK_ONLY
      ? `Video link acceptance passed: ${process.env.CUEWEAVE_LINK_ONLY} streaming.\n`
      : 'Video link acceptance passed: direct HTTP redirect, YouTube and Bilibili streaming, and YouTube download.\n',
  );
} finally {
  server.close();
}
