import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(desktop, '../..');
const output = join(root, '.impeccable/review/desktop-translation');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'cueweave-d2-ui-'));
const userData = join(temporary, 'user-data');
const media = join(temporary, '字幕翻译验收.mp4');
await copyFile(join(root, '.fixtures/desktop/D0 中文 sample.mp4'), media);
const directory = join(temporary, '双语校对.cueweave');
const subtitle = join(temporary, '来源字幕.srt');
const sampleLines = [
  'Every story begins with a voice.',
  'Keep the original timing.',
  'Do not leave anyone behind.',
  'Again, again.',
  'The train arrives at nine.',
];
const timestamp = (ms) =>
  `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
await writeFile(
  subtitle,
  Array.from(
    { length: 25 },
    (_, i) =>
      `${i + 1}\n${timestamp(i * 110)} --> ${timestamp(i * 110 + 100)}\n${sampleLines[i % sampleLines.length]}\n`,
  ).join('\n'),
);
let holdLastWindow = true;
let failure = '';
let redirectReached = false;
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/redirect-target') {
    redirectReached = true;
    res.end('{}');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  const prompt = payload.messages?.at(-1)?.content ?? payload.input?.at(-1)?.content;
  const units = JSON.parse(String(prompt).split('待翻译字幕：')[1].split('\n')[0]);
  requests.push({
    ids: units.map((u) => u.id),
    path: req.url,
    authenticated: req.headers.authorization === 'Bearer d2-local-test-only-key',
  });
  if (holdLastWindow && units.length === 5) return;
  if (failure === 'auth') {
    res.writeHead(401);
    res.end('{"error":"d2-local-test-only-key must not leak"}');
    return;
  }
  if (failure === 'redirect') {
    res.writeHead(307, { Location: `http://127.0.0.1:${server.address().port}/redirect-target` });
    res.end();
    return;
  }
  const content =
    failure === 'invalid'
      ? '{"cues":[]}'
      : JSON.stringify({
          cues: units.map((u) => ({
            id: u.id,
            translation: `译文：${u.text === sampleLines[0] ? '每个故事，都始于一个声音。' : u.text === sampleLines[1] ? '保留原有的时间。' : u.text === sampleLines[2] ? '不要落下任何人。' : u.text === sampleLines[3] ? '再来，再来。' : '列车九点到站。'}`,
          })),
        });
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify(
      req.url.endsWith('/responses')
        ? { status: 'completed', output_text: content }
        : { choices: [{ finish_reason: 'stop', message: { content } }] },
    ),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application;
let page;
const errors = [];
const screenshots = [];
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
  await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
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
  application = undefined;
}
async function snapshot() {
  return page.evaluate(async () => {
    const id = document.documentElement.dataset.projectId;
    const result = await window.cueweave.projectCommand({
      action: 'refresh',
      projectId: id,
      baseRevision: 0,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.project;
  });
}
async function capture(name, width = 1280, height = 782) {
  await application.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(width, height),
    { width, height },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () =>
      document.documentElement.scrollWidth <= window.innerWidth &&
      document.documentElement.scrollHeight <= window.innerHeight,
  );
  await page.screenshot({ path: join(output, `${name}.png`) });
  screenshots.push(name);
}
async function setTheme(theme) {
  const result = await page.evaluate(
    (theme) => window.cueweave.settingsCommand({ action: 'theme', theme }),
    theme,
  );
  assert.equal(result.ok, true);
  await page.waitForFunction(
    (dark) => window.matchMedia('(prefers-color-scheme: dark)').matches === dark,
    theme === 'dark',
  );
}
async function openTranslation() {
  await page.locator('.translation-tools details').evaluate((el) => {
    el.open = true;
  });
}
async function start() {
  await openTranslation();
  await page.getByRole('button', { name: '翻译当前字幕', exact: true }).click();
}
try {
  await launch();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '字幕显示', exact: true }).waitFor();
  await page.getByLabel('服务地址', { exact: true }).fill(baseUrl);
  await page.getByLabel('模型名称', { exact: true }).fill('d2-fixture');
  await page.getByLabel('接口协议', { exact: true }).selectOption('chat-completions');
  await page.getByLabel('API Key', { exact: true }).fill('d2-local-test-only-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('AI 配置已保存。', { exact: true }).waitFor();
  await page.getByLabel('字幕大小', { exact: true }).focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByLabel('字幕大小', { exact: true }).inputValue(), '125');
  await page.getByLabel('双语顺序', { exact: true }).selectOption('source-first');
  await page.getByLabel('字幕底板', { exact: true }).uncheck();
  assert.equal(await page.getByLabel('底板不透明度', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('设置尚未保存，要放弃这次修改吗？', { exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存字幕样式', exact: true }).click();
  await page.getByText('字幕样式已保存。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByLabel('选择视频文件').setInputFiles(media);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await choose('save', directory);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: '导入字幕', exact: true }).waitFor();
  await choose('open', subtitle);
  await page.getByRole('button', { name: '导入字幕', exact: true }).click();
  await page.getByRole('button', { name: '编辑第 25 条字幕', exact: true }).waitFor();
  await start();
  await page.getByText('20 / 25', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑第 1 条字幕', exact: true }).click();
  await page.getByRole('button', { name: '译文', exact: true }).click();
  await page.getByLabel('译文文本', { exact: true }).fill('人工校对：每个故事，都始于一个声音。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('button', { name: '取消翻译', exact: true }).click();
  await page.getByText('翻译已取消 · 简体中文', { exact: true }).waitFor();
  let p = await snapshot();
  const firstId = p.cues[0].id;
  assert.equal(p.translation.completed, 20);
  assert.equal(p.translation.cues[firstId], '人工校对：每个故事，都始于一个声音。');
  await page.locator('.project-export').evaluate((el) => {
    el.open = true;
  });
  await page.getByLabel('导出内容', { exact: true }).selectOption('translation');
  assert.equal(
    await page.getByRole('button', { name: '导出文件', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel(/仅导出已完成部分/).check();
  const partial = join(temporary, '译文-部分.srt');
  await choose('save', partial);
  await page.getByRole('button', { name: '导出文件', exact: true }).click();
  await page.getByText('已导出 译文-部分.srt', { exact: true }).waitFor();
  assert.equal((await readFile(partial, 'utf8')).split('-->').length - 1, 20);
  await page.locator('.project-export').evaluate((el) => {
    el.open = false;
  });
  await setTheme('light');
  await capture('translation-partial-light');
  holdLastWindow = false;
  await page.getByRole('button', { name: '继续剩余字幕', exact: true }).click();
  await page.getByText('翻译已完成 · 简体中文', { exact: true }).waitFor();
  assert.deepEqual(
    requests.map((r) => r.ids.length),
    [20, 5, 5],
  );
  await page.getByRole('button', { name: '撤销译文修改', exact: true }).click();
  assert.notEqual((await snapshot()).translation.cues[firstId], p.translation.cues[firstId]);
  await page.getByRole('button', { name: '重做译文修改', exact: true }).click();
  p = await snapshot();
  assert.equal(p.translation.cues[firstId], '人工校对：每个故事，都始于一个声音。');
  const completedRequests = requests.length;
  await start();
  await page.getByText('翻译已完成 · 简体中文', { exact: true }).waitFor();
  assert.equal(requests.length, completedRequests);
  await page.locator('.project-export').evaluate((el) => {
    el.open = true;
  });
  await page.getByLabel('导出内容', { exact: true }).selectOption('bilingual');
  for (const format of ['srt', 'vtt']) {
    await page.getByLabel('导出格式', { exact: true }).selectOption(format);
    const target = join(temporary, `双语.${format}`);
    await choose('save', target);
    await page.getByRole('button', { name: '导出文件', exact: true }).click();
    await page.getByText(`已导出 双语.${format}`, { exact: true }).waitFor();
    const content = await readFile(target, 'utf8');
    assert.equal(content.split('-->').length - 1, 25);
    assert.ok(
      content.includes('Every story begins with a voice.\n人工校对：每个故事，都始于一个声音。'),
    );
  }
  await page.locator('.project-export').evaluate((el) => {
    el.open = false;
  });
  await page.locator('.subtitle-row').first().click();
  await page.locator('video').evaluate((video) => {
    video.currentTime = 0.04;
    video.pause();
  });
  await page.waitForFunction(() =>
    document.querySelector('.subtitle-overlay')?.textContent?.includes('人工校对'),
  );
  const style = await page.locator('.subtitle-overlay').evaluate((el) => ({
    scale: window.getComputedStyle(el).getPropertyValue('--caption-scale').trim(),
    background: window.getComputedStyle(el.querySelector('.caption-line')).backgroundColor,
  }));
  assert.equal(style.scale, '1.25');
  assert.equal(style.background, 'rgba(0, 0, 0, 0)');
  await capture('translation-complete-light');
  await setTheme('dark');
  await capture('translation-complete-dark');
  await page.getByRole('button', { name: '编辑第 1 条字幕', exact: true }).click();
  await page.getByRole('button', { name: '译文', exact: true }).click();
  await capture('translation-editor-dark');
  await capture('translation-editor-narrow-dark', 640, 480);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '字幕显示', exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '保存字幕样式', exact: true }).click();
  await page.getByText('字幕样式已保存。', { exact: true }).waitFor();
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    await page
      .locator('.subtitle-settings')
      .evaluate((el) => el.parentElement.scrollIntoView({ block: 'start' }));
    await capture(`subtitle-settings-${theme}`);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
    );
    await page
      .locator('.subtitle-settings')
      .evaluate((el) => el.parentElement.scrollIntoView({ block: 'start' }));
    await capture(`subtitle-settings-narrow-${theme}`, 640, 480);
    await page.getByRole('button', { name: '保存字幕样式', exact: true }).scrollIntoViewIfNeeded();
    await capture(`subtitle-settings-options-narrow-${theme}`, 640, 480);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
    );
  }
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await close();
  await launch();
  await page.getByText('翻译已完成 · 简体中文', { exact: true }).waitFor();
  assert.equal(
    (await snapshot()).translation.cues[firstId],
    '人工校对：每个故事，都始于一个声音。',
  );
  assert.equal(requests.length, completedRequests);
  // A changed source invalidates this run. Kill the worker during a new second window.
  await page.getByRole('button', { name: '编辑第 1 条字幕', exact: true }).click();
  await page.getByLabel('字幕文本', { exact: true }).fill('An edited source sentence.');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  assert.equal((await snapshot()).translation, null);
  holdLastWindow = true;
  await start();
  await page.getByText('20 / 25', { exact: true }).waitFor();
  await application.evaluate(({ app }) => {
    const child = app.getAppMetrics().find((m) => m.name === 'CueWeave Background Service');
    if (!child) throw new Error('Service missing');
    process.kill(child.pid);
  });
  await page.getByText('翻译已中断 · 简体中文', { exact: true }).waitFor();
  const beforeResume = requests.length;
  await close();
  await launch();
  await page.getByText('翻译已中断 · 简体中文', { exact: true }).waitFor();
  assert.equal(requests.length, beforeResume);
  holdLastWindow = false;
  await page.getByRole('button', { name: '继续剩余字幕', exact: true }).click();
  await page.getByText('翻译已完成 · 简体中文', { exact: true }).waitFor();
  assert.equal(requests.at(-1).ids.length, 5);
  // New target language gives an uncached task; malformed output cannot be exported as complete.
  failure = 'invalid';
  await openTranslation();
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('en');
  await start();
  await page.getByText('翻译未完成 · English', { exact: true }).waitFor();
  assert.equal((await snapshot()).translation.completed, 0);
  await capture('translation-error-light');
  assert.ok(!(await page.locator('body').innerText()).includes('d2-local-test-only-key'));
  failure = 'auth';
  await page.getByRole('button', { name: '继续剩余字幕', exact: true }).click();
  await page.getByText('认证失败，请在设置中检查 API Key 后继续。', { exact: true }).waitFor();
  failure = 'redirect';
  await page.getByRole('button', { name: '继续剩余字幕', exact: true }).click();
  await page.getByText('模型请求未完成，请检查网络和服务配置后继续。', { exact: true }).waitFor();
  assert.equal(redirectReached, false);
  failure = '';
  // Changing protocol creates a new cache identity; Responses uses the same cue validation.
  const saved = await page.evaluate(() => window.cueweave.settingsCommand({ action: 'read' }));
  await page.evaluate(
    (provider) =>
      window.cueweave.settingsCommand({
        action: 'save',
        provider: { ...provider, protocol: 'responses' },
      }),
    saved.value.settings.provider,
  );
  await start();
  await page.getByText('翻译已完成 · English', { exact: true }).waitFor();
  assert.ok(requests.some((r) => r.path.endsWith('/responses')));
  assert.ok(requests.every((r) => r.authenticated));
  assert.deepEqual(errors, []);
  await close();
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        requests: requests.length,
        screenshots,
        subtitleStyles: true,
        persistedCheckpoints: true,
        cancelResume: true,
        manualEdits: true,
        workerCrash: true,
        restartDoesNotBill: true,
        exportReadback: true,
        protocols: ['chat-completions', 'responses'],
      },
      null,
      2,
    ),
  );
  console.log(
    'D2 desktop acceptance passed: subtitle styles, real provider jobs, manual edits, cancel/resume, checkpoint recovery, protocols, errors, cache reuse and bilingual export.',
  );
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
