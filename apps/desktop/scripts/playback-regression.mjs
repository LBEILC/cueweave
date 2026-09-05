import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(desktop, '../../.impeccable/review/desktop-playback-regression');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  CUEWEAVE_TEST_USER_DATA: await mkdtemp(join(tmpdir(), 'cueweave-startup-')),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const application = await electron.launch({
  args: [
    desktop,
    '--hidden',
    '--mute-audio',
    ...(process.env.CUEWEAVE_TEST_DISABLE_GPU_SANDBOX === '1' ? ['--disable-gpu-sandbox'] : []),
  ],
  env,
});
const snapshots = [];
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(90000);
  await page.evaluate(() => {
    window.__mediaEvents = [];
    const original = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = function () {
      const record = {
        tag: this.tagName,
        at: window.performance.now(),
        time: this.currentTime,
        ready: this.readyState,
        paused: this.paused,
        muted: this.muted,
        status: 'pending',
      };
      window.__mediaEvents.push(record);
      if (window.__mediaEvents.length > 250) window.__mediaEvents.shift();
      return original.call(this).then(
        () => {
          record.status = 'ok';
        },
        (error) => {
          record.status = error.name + ': ' + error.message;
          throw error;
        },
      );
    };
  });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
    ),
    true,
  );
  await page.getByLabel('视频链接').fill('https://www.youtube.com/watch?v=VeizK1M7V7E');
  await page.getByRole('button', { name: '读取链接', exact: true }).click();
  await page.getByRole('button', { name: '在线播放', exact: true }).click();
  async function soundReady() {
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      const audio = document.querySelector('audio');
      return (
        video &&
        audio &&
        video.currentTime > 1 &&
        !video.paused &&
        !audio.paused &&
        !audio.muted &&
        audio.volume > 0 &&
        audio.readyState >= 3 &&
        !audio.seeking &&
        audio.webkitAudioDecodedByteCount > 0 &&
        Math.abs(audio.currentTime - video.currentTime) < 0.35
      );
    });
    snapshots.push(
      await page.locator('video,audio').evaluateAll((elements) =>
        elements.map((m) => ({
          tag: m.tagName,
          time: m.currentTime,
          paused: m.paused,
          muted: m.muted,
          volume: m.volume,
          ready: m.readyState,
          seeking: m.seeking,
          decoded: m.webkitAudioDecodedByteCount,
          width: m.videoWidth,
        })),
      ),
    );
  }
  // This assertion must pass before any quality change, otherwise it misses the startup regression.
  try {
    await soundReady();
  } catch (error) {
    const failure = {
      media: await page.locator('video,audio').evaluateAll((elements) =>
        elements.map((m) => ({
          tag: m.tagName,
          time: m.currentTime,
          paused: m.paused,
          muted: m.muted,
          volume: m.volume,
          ready: m.readyState,
          network: m.networkState,
          seeking: m.seeking,
          error: m.error?.message,
          decoded: m.webkitAudioDecodedByteCount,
          buffered: Array.from({ length: m.buffered.length }, (_, i) => [
            m.buffered.start(i),
            m.buffered.end(i),
          ]),
        })),
      ),
      events: await page.evaluate(() => window.__mediaEvents),
    };
    await writeFile(join(output, 'failure.json'), JSON.stringify(failure, null, 2));
    process.stdout.write(JSON.stringify(failure.media));
    throw error;
  }
  assert.equal(snapshots[0][0].width, 3840);
  await page.waitForFunction(() => document.querySelectorAll('.subtitle-row').length > 1000);
  const captions = await page.locator('.subtitle-row').count();
  await page.screenshot({ path: join(output, 'initial-4k-fixed.png') });
  const quality = page.getByLabel('清晰度', { exact: true });
  const original = await quality.inputValue();
  const lower = await quality.locator('option').evaluateAll((options) => options[1].value);
  await quality.selectOption(lower);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return (
      video &&
      video.currentSrc === video.src &&
      video.readyState >= 3 &&
      video.videoWidth > 0 &&
      video.videoWidth < 3840
    );
  });
  await soundReady();
  await quality.selectOption(original);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return (
      video && video.currentSrc === video.src && video.readyState >= 3 && video.videoWidth === 3840
    );
  });
  await soundReady();
  assert.equal(snapshots.at(-1)[0].width, 3840);
  const report = {
    passed: true,
    snapshots,
    captions,
    source: await page.locator('.subtitle-source-options summary').innerText(),
    playEvents: await page.evaluate(() => window.__mediaEvents),
  };
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: join(output, 'initial.png') });
  process.stdout.write(
    `Playback regression passed: ${captions} original cues; initial 4K audio decoded and synchronized before quality change; lower quality and 4K return retain audio.\n`,
  );
} finally {
  await application.evaluate(({ app }) => app.exit()).catch(() => {});
  await application.close().catch(() => {});
}
