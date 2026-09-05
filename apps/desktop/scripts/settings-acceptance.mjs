import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(desktop, '../../.impeccable/review/desktop-settings');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), 'cueweave-settings-ui-'));
const requests = [];
let leakedRedirect = false;
const server = createServer(async (req, res) => {
  if (req.url === '/redirect-target') {
    leakedRedirect = true;
    res.end('{}');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  requests.push({
    path: req.url,
    payload,
    authenticated: req.headers.authorization === 'Bearer settings-test-only-key',
  });
  if (payload.model === 'slow-test') return;
  if (payload.model === 'redirect-test') {
    res.writeHead(307, { Location: `http://localhost:${server.address().port}/redirect-target` });
    res.end();
    return;
  }
  if (payload.model === 'auth-test') {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'settings-test-only-key MUST NOT be shown' }));
    return;
  }
  if (payload.model === 'invalid-test') {
    res.end('{}');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify(
      req.url.endsWith('/responses')
        ? { output_text: 'READY' }
        : { choices: [{ message: { content: 'READY' } }] },
    ),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application;
let page;
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
  // Playwright otherwise forces a light color scheme over Electron's nativeTheme.
  await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isAudioMuted(),
    ),
    true,
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).waitFor();
}
async function close() {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await application.close();
  application = undefined;
}
async function saveModel(model, protocol = 'chat-completions') {
  await page.getByLabel('模型名称', { exact: true }).fill(model);
  await page.getByLabel('接口协议', { exact: true }).selectOption(protocol);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('AI 配置已保存。', { exact: true }).waitFor();
}
async function capture(name, width, height, bottom = false) {
  await application.evaluate(
    ({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(width, height),
    { width, height },
  );
  await page
    .locator('.settings-scroll')
    .evaluate((el, bottom) => (el.scrollTop = bottom ? el.scrollHeight : 0), bottom);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > window.innerWidth ||
        document.documentElement.scrollHeight > window.innerHeight,
    ),
    false,
  );
  await page.screenshot({ path: join(output, `${name}.png`) });
}
try {
  await launch();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.waitForFunction(() => !window.matchMedia('(prefers-color-scheme: dark)').matches);
  await capture('settings-light-empty', 1280, 782);
  await page.getByLabel('服务地址', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill('settings-test-only-key');
  await saveModel('fixture-model');
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  const stored = await readFile(join(userData, 'settings.json'), 'utf8');
  assert.ok(!stored.includes('settings-test-only-key'));
  assert.ok(JSON.parse(stored).encryptedKey);
  const snapshot = await page.evaluate(() => window.cueweave.settingsCommand({ action: 'read' }));
  assert.equal(snapshot.value.settings.keyStatus, 'saved');
  assert.ok(!JSON.stringify(snapshot).includes('settings-test-only-key'));
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功，模型已返回有效响应。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  await capture('settings-dark-configured', 1280, 782);
  await capture('settings-dark-narrow', 640, 480);
  await capture('settings-dark-narrow-form', 640, 480, true);
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.waitForFunction(() => !window.matchMedia('(prefers-color-scheme: dark)').matches);
  await capture('settings-light-narrow', 640, 480);
  await capture('settings-light-narrow-form', 640, 480, true);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 782),
  );
  await saveModel('responses-fixture', 'responses');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功，模型已返回有效响应。', { exact: true }).waitFor();
  await saveModel('auth-test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('认证失败，请检查 API Key。', { exact: true }).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('settings-test-only-key'));
  await capture('settings-light-error', 1280, 782);
  await saveModel('redirect-test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('无法连接模型服务，请检查网络、地址和接口协议。', { exact: true }).waitFor();
  assert.equal(leakedRedirect, false);
  await saveModel('invalid-test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page
    .getByText('服务未返回有效模型响应，请检查接口协议和服务地址。', { exact: true })
    .waitFor();
  await saveModel('slow-test');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByRole('button', { name: '取消测试', exact: true }).click();
  await page.getByText('连接测试已取消。', { exact: true }).waitFor();
  await saveModel('restored-model');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByText('外观已保存。', { exact: true }).waitFor();
  await close();
  await launch();
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'restored-model');
  assert.equal(
    await page.getByRole('button', { name: '深色', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches),
    true,
  );
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功，模型已返回有效响应。', { exact: true }).waitFor();
  await page.getByLabel('模型名称', { exact: true }).fill('unsaved-model');
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(640, 480),
  );
  await page.locator('.settings-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByText('设置尚未保存，要放弃这次修改吗？', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('继续编辑'));
  assert.ok(
    await page.getByRole('button', { name: '继续编辑', exact: true }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 150 && box.bottom < window.innerHeight - 70;
    }),
  );
  await page.screenshot({ path: join(output, 'settings-narrow-leave-mouse.png') });
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.settings-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: '返回工作台', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('继续编辑'));
  assert.ok(
    await page.getByRole('button', { name: '继续编辑', exact: true }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 150 && box.bottom < window.innerHeight - 70;
    }),
  );
  await page.screenshot({ path: join(output, 'settings-narrow-leave-keyboard.png') });
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await application.evaluate(({ dialog, BrowserWindow }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async () => {
      dialog.showMessageBox = original;
      return { response: 0, checkboxChecked: false };
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'unsaved-model');
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改并返回', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).waitFor();
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'restored-model');
  await page.getByRole('button', { name: '移除密钥', exact: true }).click();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('AI 配置已保存。', { exact: true }).waitFor();
  await page.getByText('尚未保存密钥', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '测试连接', exact: true }).isDisabled(),
    true,
  );
  assert.ok(!JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')).encryptedKey);
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.getByText('外观已保存。', { exact: true }).waitFor();
  assert.equal(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  assert.ok(requests.some((r) => r.path === '/v1/responses'));
  assert.ok(requests.every((r) => r.authenticated));
  assert.ok(requests.every((r) => !JSON.stringify(r.payload).includes('subtitle-file')));
  assert.deepEqual(errors, []);
  await close();
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        requests: requests.length,
        encryptedPersistence: true,
        restart: true,
        cancel: true,
        redirectBlocked: true,
        themes: ['light', 'dark', 'system'],
        screenshots: 9,
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop settings acceptance passed: themes, encrypted restart, protocols, errors, cancellation, redirect isolation and draft protection.',
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
