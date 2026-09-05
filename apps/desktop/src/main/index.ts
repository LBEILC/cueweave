import { app, BrowserWindow, dialog, Menu, nativeTheme, net, protocol, session } from 'electron';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAppIpc } from './ipc';
import { contentSecurityPolicy, getRendererUrl, resolveAppAsset } from './security';
import { MediaRegistry } from './media';
import { DesktopServiceHost } from './service-host';
import { SiteAuthManager } from './site-auth';

const mainDirectory = fileURLToPath(new URL('.', import.meta.url));
const rendererDirectory = join(mainDirectory, '../renderer');
const hidden = process.argv.includes('--hidden');
const d0Check = process.argv.includes('--d0-check');
const linkCheck =
  hidden &&
  process.argv.includes('--link-check') &&
  typeof process.env.CUEWEAVE_TEST_USER_DATA === 'string' &&
  process.env.CUEWEAVE_TEST_USER_DATA.length > 0;
let service: DesktopServiceHost | null = null;
let shuttingDown = false;

app.setName('CueWeave');
if (hidden || d0Check || linkCheck) app.disableHardwareAcceleration();
if (process.env.CUEWEAVE_TEST_USER_DATA && (!app.isPackaged || d0Check || linkCheck)) {
  app.setPath('userData', process.env.CUEWEAVE_TEST_USER_DATA);
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'cueweave-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'cueweave-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

app
  .whenReady()
  .then(async () => {
    const media = new MediaRegistry();
    const serviceDirectory = join(app.getPath('userData'), 'service');
    await mkdir(serviceDirectory, { recursive: true });
    const toolsDirectory = app.isPackaged
      ? join(process.resourcesPath, 'tools')
      : join(mainDirectory, '../../resources/tools/bin');
    service = new DesktopServiceHost({
      servicePath: join(mainDirectory, 'service.js'),
      databasePath: join(serviceDirectory, 'd0.sqlite3'),
      packaged: app.isPackaged,
      toolsDirectory,
      downloadsDirectory: join(app.getPath('userData'), 'downloads'),
      allowPrivateNetwork: linkCheck,
    });
    const rendererUrl = getRendererUrl(
      app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
    );
    const csp = contentSecurityPolicy(rendererUrl);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const rendererOrigin = new URL(rendererUrl).origin;
      if (
        !details.url.startsWith('cueweave-app://app/') &&
        !details.url.startsWith(`${rendererOrigin}/`)
      ) {
        callback({});
        return;
      }
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      });
    });
    protocol.handle('cueweave-app', async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const asset = resolveAppAsset(request.url, rendererDirectory);
      if (!asset) return new Response(null, { status: 404 });
      try {
        const response = await net.fetch(pathToFileURL(asset).href, { method: request.method });
        return new Response(request.method === 'HEAD' ? null : response.body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), 'Content-Security-Policy': csp },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    protocol.handle('cueweave-media', (request) => media.handle(request));

    const acceptanceOutput = d0Check ? join(app.getPath('userData'), 'd0-acceptance.json') : null;
    const acceptanceInputs = process.argv
      .filter((value) => value.startsWith('--d0-check-input='))
      .map((value) => value.slice(17));
    if (acceptanceOutput && acceptanceInputs[0]) {
      await service.start();
      const registered = await media.register(acceptanceInputs[0]);
      if (!registered) throw new Error('D0 media registration failed');
      const rangeCases = [
        { name: 'full', method: 'GET', range: undefined },
        { name: 'first', method: 'GET', range: 'bytes=0-63' },
        { name: 'open', method: 'GET', range: 'bytes=64-' },
        { name: 'suffix', method: 'GET', range: 'bytes=-32' },
        { name: 'multi', method: 'GET', range: 'bytes=0-1,4-5' },
        { name: 'outside', method: 'GET', range: `bytes=${registered.size}-` },
        { name: 'head', method: 'HEAD', range: undefined },
      ];
      const ranges = [];
      for (const rangeCase of rangeCases) {
        const response = await media.handle(
          new Request(registered.url, {
            method: rangeCase.method,
            ...(rangeCase.range ? { headers: { Range: rangeCase.range } } : {}),
          }),
        );
        ranges.push({
          name: rangeCase.name,
          status: response.status,
          length: (await response.arrayBuffer()).byteLength,
          contentLength: response.headers.get('content-length'),
          contentRange: response.headers.get('content-range'),
        });
      }
      const first = await service.health();
      const storage = await service.storageCheck();
      const probes = [];
      for (const inputPath of acceptanceInputs) {
        try {
          probes.push({
            name: inputPath.split(/[\\/]/).at(-1),
            ok: true,
            value: await service.probeMedia(inputPath),
          });
        } catch {
          probes.push({ name: inputPath.split(/[\\/]/).at(-1), ok: false });
        }
      }
      const extractedPath = join(serviceDirectory, 'd0-extracted.wav');
      await service.extractAudio(acceptanceInputs[0], extractedPath);
      const extractedBytes = (await stat(extractedPath)).size;
      await rm(extractedPath, { force: true });
      const cancellation = await service.cancellationCheck();
      const restarted = await service.crashAndReconnectForTest();
      await writeFile(
        acceptanceOutput,
        `${JSON.stringify({ first, storage, probes, ranges, extractedBytes, cancellation, restarted, packaged: app.isPackaged }, null, 2)}\n`,
      );
      await service.stop();
      service = null;
      app.quit();
      return;
    }

    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({
      title: '句织 · CueWeave',
      width: 1120,
      height: 760,
      minWidth: 640,
      minHeight: 480,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f8f4ed',
      webPreferences: {
        preload: join(mainDirectory, '../preload/index.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('render-process-gone', (_event, details) => {
      if (!app.isPackaged) console.error('[CueWeave] Renderer exited:', details);
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-frame-navigate', (details) => details.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    const auth = new SiteAuthManager(hidden);
    const disposeIpc = registerAppIpc({
      window,
      rendererUrl,
      appInfo: { name: app.getName(), version: app.getVersion() },
      fontLicensePath: join(
        process.env.ELECTRON_RENDERER_URL && !app.isPackaged
          ? join(mainDirectory, '../../resources/public')
          : rendererDirectory,
        'fonts/MiSans-LICENSE.pdf',
      ),
      media,
      service,
      auth,
    });
    let closingWindow = false;
    window.on('close', (event) => {
      if (closingWindow || !service) return;
      event.preventDefault();
      closingWindow = true;
      const closingService = service;
      service = null;
      void closingService?.stop().finally(() => {
        if (!window.isDestroyed()) window.destroy();
        app.quit();
      });
    });
    window.on('closed', () => {
      auth.dispose();
      disposeIpc();
    });
    window.once('ready-to-show', () => {
      if (!hidden) window.show();
    });
    await window.loadURL(rendererUrl);
  })
  .catch((error: unknown) => {
    if (!app.isPackaged) console.error('[CueWeave] Desktop startup failed:', error);
    if (!hidden) dialog.showErrorBox('无法打开句织', '桌面窗口加载失败，请关闭应用后重试。');
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (shuttingDown || !service) return;
  event.preventDefault();
  shuttingDown = true;
  void service?.stop().finally(() => {
    service = null;
    app.quit();
  });
});
