import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import process from 'node:process';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(desktop, '../..');
const output = join(root, '.impeccable/review/desktop-online');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'cueweave-online-ui-'));
const fixtureHost = join(root, '.fixtures/desktop/online-acceptance-host.cjs');
await build({
  entryPoints: [join(desktop, 'scripts/online-acceptance-host.ts')],
  outfile: fixtureHost,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3'],
});
const sourceLines = [
  'Every story begins with a voice.',
  'Keep the original timing.',
  'Do not leave anyone behind.',
  'Again, again.',
  'The train arrives at nine.',
];
const chinese = [
  '每个故事，都始于一个声音。',
  '保留原有的时间。',
  '不要落下任何人。',
  '再来，再来。',
  '列车九点到站。',
];
const time = (ms) =>
  `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
const content =
  'WEBVTT\n\n' +
  Array.from(
    { length: 90 },
    (_, i) => `${time(i * 5000)} --> ${time(i * 5000 + 4900)}\n${sourceLines[i % 5]}\n`,
  ).join('\n');
const requests = [];
let failure = '';
let hold = false;
const held = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  const prompt = data.messages?.at(-1)?.content ?? data.input?.at(-1)?.content;
  const cues = JSON.parse(String(prompt).split('待翻译字幕：')[1].split('\n')[0]);
  requests.push({ ids: cues.map((c) => c.id), path: req.url });
  assert.equal(req.headers.authorization, 'Bearer online-local-test-key');
  const send = () => {
    if (failure === 'auth') {
      res.writeHead(401).end('{"error":"online-local-test-key"}');
      return;
    }
    const output =
      failure === 'invalid'
        ? '{"cues":[]}'
        : JSON.stringify({
            cues: cues.map((c) => ({
              id: c.id,
              translation: chinese[sourceLines.indexOf(c.text)],
            })),
          });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url.endsWith('/responses')
          ? { status: 'completed', output_text: output }
          : { choices: [{ finish_reason: 'stop', message: { content: output } }] },
      ),
    );
  };
  if (hold) held.push(send);
  else setTimeout(send, 200);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application, page;
const errors = [];
async function launch() {
  const env = { ...process.env, CUEWEAVE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({
    args: [
      desktop,
      '--hidden',
      '--mute-audio',
      ...(process.env.CUEWEAVE_TEST_DISABLE_GPU_SANDBOX === '1' ? ['--disable-gpu-sandbox'] : []),
    ],
    env,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
    ),
    true,
  );
  await page
    .getByLabel('选择视频文件')
    .setInputFiles(join(root, '.fixtures/desktop/D0 中文 sample.mp4'));
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('video').evaluate((v) => v.pause());
  const videoUrl = await page.locator('video').getAttribute('src');
  await application.evaluate(
    async (_, args) => {
      await process
        .getBuiltinModule('node:module')
        .createRequire(args.fixtureHost)(args.fixtureHost)
        .install(args.videoUrl, args.content);
    },
    { fixtureHost, videoUrl, content },
  );
}
async function open(url = 'https://www.youtube.com/watch?v=onlinefirst') {
  await page.getByRole('button', { name: '打开其他视频', exact: true }).click();
  await page.getByLabel('视频链接').fill(url);
  await page.getByRole('button', { name: '读取链接', exact: true }).click();
  await page.getByRole('button', { name: '在线播放', exact: true }).click();
  await page.getByRole('button', { name: '开启翻译', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.subtitle-row').length === 90);
  await page.locator('video').evaluate((v) => {
    v.pause();
    v.currentTime = 0.2;
  });
  assert.equal(await page.getByLabel('在线字幕', { exact: true }).count(), 0);
  assert.equal(
    await page.locator('.subtitle-source-options summary').innerText(),
    'English（自动）',
  );
}
async function settings(protocol = 'chat-completions', model = 'online-test') {
  const result = await page.evaluate(
    async (provider) =>
      window.cueweave.settingsCommand({ action: 'save', provider, key: 'online-local-test-key' }),
    { baseUrl, model, protocol },
  );
  assert.equal(result.ok, true);
}
async function ready() {
  await page.getByText(/当前位置已就绪/).waitFor();
}
async function capture(name, width, height, theme) {
  await page.evaluate(
    (theme) => window.cueweave.settingsCommand({ action: 'theme', theme }),
    theme,
  );
  await application.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(width, height),
    { width, height },
  );
  await page.waitForFunction(
    (dark) => window.matchMedia('(prefers-color-scheme: dark)').matches === dark,
    theme === 'dark',
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, `${name}.png`) });
}
try {
  await launch();
  await open();
  await page.getByRole('button', { name: '开启翻译', exact: true }).click();
  await page
    .getByText('请先在设置中填写并保存 AI 服务、模型和 API Key。', { exact: true })
    .waitFor();
  assert.equal(requests.length, 0);
  await settings();
  await page.getByRole('button', { name: '开启翻译', exact: true }).click();
  await ready();
  await page.locator('.subtitle-overlay').getByText(chinese[0], { exact: true }).waitFor();
  assert.ok(requests.every((r) => r.ids.every((id) => Number(id) <= 19)));
  assert.ok(requests.every((r) => r.ids.length <= 8));
  const beforeQuality = requests.length;
  await page.getByLabel('清晰度', { exact: true }).selectOption('720');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('.subtitle-overlay').getByText(chinese[0], { exact: true }).waitFor();
  assert.equal(requests.length, beforeQuality);
  const beforePlayback = await page.locator('video').evaluate((v) => {
    v.play();
    return v.currentTime;
  });
  await page.waitForFunction(
    (before) => document.querySelector('video').currentTime > before + 0.2,
    beforePlayback,
  );
  await page.locator('video').evaluate((v) => {
    v.pause();
    v.currentTime = 0.2;
  });
  for (const theme of ['light', 'dark']) {
    await capture(`online-${theme}`, 1280, 782, theme);
    await capture(`online-narrow-${theme}`, 640, 480, theme);
    await page.locator('.subtitle-panel').evaluate((p) => {
      p.scrollTop = p.scrollHeight;
    });
    await capture(`online-narrow-list-${theme}`, 640, 480, theme);
    await page.locator('.subtitle-panel').evaluate((p) => {
      p.scrollTop = 0;
    });
  }
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
  );
  await page.getByRole('button', { name: '暂停翻译', exact: true }).click();
  const cachedCount = requests.length;
  await page.getByRole('button', { name: '继续翻译', exact: true }).click();
  await ready();
  assert.equal(requests.length, cachedCount);
  await page.getByRole('button', { name: '暂停翻译', exact: true }).click();
  await page.getByLabel('在线翻译目标语言').selectOption('ja');
  assert.equal(await page.locator('.cue-translation').count(), 0);
  await page.getByLabel('在线翻译目标语言').selectOption('zh-CN');
  await page.getByRole('button', { name: '开启翻译', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: '暂停翻译', exact: true }).click();
  failure = 'auth';
  await settings('responses', 'failure-test');
  await page.getByRole('button', { name: '继续翻译', exact: true }).click();
  await page.getByText(/认证失败，请在设置中检查 API Key/).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('online-local-test-key'));
  await capture('online-error-light', 1280, 782, 'light');
  failure = '';
  await settings('responses');
  await page.getByRole('button', { name: '继续翻译', exact: true }).click();
  await ready();
  assert.ok(requests.some((r) => r.path.endsWith('/responses')));
  await page.getByRole('button', { name: '暂停翻译', exact: true }).click();
  await settings('responses', 'cancel-test');
  hold = true;
  await page.getByRole('button', { name: '继续翻译', exact: true }).click();
  await page.getByText(/正在翻译当前位置/).waitFor();
  await page.getByRole('button', { name: '暂停翻译', exact: true }).click();
  hold = false;
  held.splice(0).forEach((send) => send());
  assert.equal(await page.locator('.cue-translation').count(), 0);
  await open('https://www.youtube.com/watch?v=onlinesecond');
  assert.equal(await page.locator('.cue-translation').count(), 0);
  await settings('chat-completions');
  await application.evaluate(({ app }) => app.exit());
  await application.close();
  application = undefined;
  const beforeRestart = requests.length;
  await launch();
  await open();
  await page.getByRole('button', { name: '开启翻译', exact: true }).click();
  await ready();
  assert.equal(requests.length, beforeRestart);
  const files = await readdir(join(userData, 'online-translation-cache'));
  for (const name of files)
    assert.ok(
      !(await readFile(join(userData, 'online-translation-cache', name), 'utf8')).includes(
        'online-local-test-key',
      ),
    );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'acceptance.json'),
    JSON.stringify(
      {
        passed: true,
        requests,
        screenshots: [
          'online-light',
          'online-dark',
          'online-narrow-light',
          'online-narrow-dark',
          'online-error-light',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `Online acceptance passed: ${requests.length} local mock requests; auto-source, live bilingual playback, pause/resume, cache/restart, auth failure and stale source isolation.\n`,
  );
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit()).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  server.close();
}
