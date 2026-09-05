import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { build } from 'esbuild';
import { paletteCss, palettes, themesPage } from './preview/palettes.mjs';
import { orangePage, previewMark } from './preview/orange-palettes.mjs';
import { logoConcepts, logoCss, logosPage, logoSvg } from './preview/logos.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.CUEWEAVE_PREVIEW_PORT ?? 4178);
const assets = new Map();
for (const surface of ['review', 'popup', 'options', 'player']) {
  const result = await build({
    stdin: {
      contents:
        surface === 'player'
          ? "import './scripts/preview/player.ts';"
          : `import './scripts/preview/browser.ts'; import './apps/extension/entrypoints/${surface}/main.tsx';`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outdir: '/memory',
    entryNames: surface,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    external: ['/fonts/*'],
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  for (const output of result.outputFiles)
    assets.set('/' + output.path.split(/[\\/]/u).at(-1), output.contents);
}
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
const framePage = (surface, theme, logo) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>句织 · ${surface === 'review' ? '字幕工作台' : surface === 'options' ? '设置' : surface === 'player' ? '播放器字幕' : '扩展弹窗'}</title><link rel="stylesheet" href="/${surface}.css"><style>${paletteCss(theme)}${logoCss(logo, theme)}</style></head><body><div id="root"></div><script src="/${surface}.js"></script></body></html>`;
const previewPage = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>句织 · 界面预览</title><style>
body{margin:0;background:#e8e7e3;font:13px system-ui,sans-serif;color:#343c41}header{padding:12px 18px;display:flex;align-items:center;flex-wrap:wrap;gap:12px;background:#fffdf9;border-bottom:1px solid #ccc}label{display:flex;gap:6px;align-items:center}select{padding:5px;border:1px solid #aaa;border-radius:5px;background:white;color:#343c41}header small{margin-left:auto;color:#606971}iframe{display:block;border:0;margin:0 auto;max-width:100%;background:transparent}a{color:#486f87}#frame{overflow:auto}
</style></head><body><header><strong>句织 · 界面预览</strong><a href="/logos">Logo 方案</a><a href="/orange">橙色对比</a><label>页面<select id="surface"><option value="review">字幕工作台</option><option value="popup">扩展弹窗</option><option value="options">设置</option><option value="player">播放器字幕</option></select></label><label>主题<select id="theme"><option value="light">暖纸 · 活力橙</option><option value="dark">石墨 · 活力橙</option>${Object.entries(
  palettes,
)
  .map(([key, value]) => `<option value="${key}">${value.name}</option>`)
  .join(
    '',
  )}</select></label><label>宽度<select id="width"><option value="fluid">跟随窗口</option><option value="1280">1280 px</option><option value="760">760 px</option><option value="390">390 px</option></select></label><label>状态<select id="state"><option value="partial">部分完成</option><option value="complete">全部完成</option><option value="empty">暂无修正</option><option value="failure">翻译失败</option><option value="disconnected">没有视频</option><option value="disabled">字幕关闭</option></select></label><small>合成示例 · 不连接模型 · 更改仅保留在当前预览</small></header><div id="frame"><iframe title="句织界面" id="app" allow="fullscreen"></iframe></div><script>
const logoSelect=document.createElement('select');logoSelect.id='logo';logoSelect.innerHTML='<option value="">当前标志</option>${Object.entries(
  logoConcepts,
)
  .map(([id, value]) => `<option value="${id}">${value.name}</option>`)
  .join(
    '',
  )}';const logoLabel=document.createElement('label');logoLabel.textContent='Logo ';logoLabel.append(logoSelect);document.querySelector('header').insertBefore(logoLabel,document.querySelector('header small'));
const params=new URLSearchParams(location.search),fields=['surface','theme','width','state','logo'];
for(const key of fields){const el=document.getElementById(key);if(params.has(key)&&Array.from(el.options).some(o=>o.value===params.get(key)))el.value=params.get(key);el.addEventListener('change',render);}
function render(){const values=Object.fromEntries(fields.map(k=>[k,document.getElementById(k).value]));const app=document.getElementById('app');app.style.colorScheme=values.theme==='light'||values.theme.endsWith('-light')?'light':'dark';app.style.width=values.surface==='popup'?'360px':values.width==='fluid'?'100%':values.width+'px';app.style.height='calc(100vh - 61px)';app.src='/'+values.surface+'.html?state='+values.state+'&theme='+values.theme+'&logo='+values.logo;history.replaceState(null,'','/?'+new URLSearchParams(values));}
render();
</script></body></html>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  try {
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/logos') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(logosPage);
      return;
    }
    if (url.pathname === '/logo-concept.svg') {
      const mark = logoSvg(
        url.searchParams.get('id'),
        url.searchParams.get('mode'),
        url.searchParams.get('tile') === '1',
        url.searchParams.get('mono') === '1',
      );
      response.setHeader('Content-Type', 'image/svg+xml');
      response.writeHead(mark ? 200 : 404);
      response.end(mark ?? 'Not found');
      return;
    }
    if (url.pathname === '/orange') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(orangePage);
      return;
    }
    if (url.pathname === '/preview-mark.svg') {
      const mark = previewMark(url.searchParams.get('theme'));
      response.setHeader('Content-Type', 'image/svg+xml');
      response.writeHead(mark ? 200 : 404);
      response.end(mark ?? 'Not found');
      return;
    }
    if (url.pathname === '/themes') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(themesPage);
      return;
    }
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(previewPage);
      return;
    }
    if (
      url.pathname === '/review.html' ||
      url.pathname === '/popup.html' ||
      url.pathname === '/options.html' ||
      url.pathname === '/player.html'
    ) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        framePage(
          url.pathname.slice(1, -5),
          url.searchParams.get('theme'),
          url.searchParams.get('logo'),
        ),
      );
      return;
    }
    if (assets.has(url.pathname)) {
      response.setHeader('Content-Type', mime[extname(url.pathname)]);
      response.end(assets.get(url.pathname));
      return;
    }
    if (
      url.pathname === '/cueweave-mark-paper.svg' ||
      url.pathname === '/cueweave-mark.svg' ||
      /^\/fonts\/[a-zA-Z0-9_./-]+\.(woff2?|ttf)$/u.test(url.pathname)
    ) {
      const publicRoot = resolve(root, 'apps/extension/public');
      const path = resolve(publicRoot, '.' + url.pathname);
      if (!path.startsWith(publicRoot + '\\') && !path.startsWith(publicRoot + '/'))
        throw new Error('Invalid asset path');
      response.setHeader('Content-Type', mime[extname(path)]);
      response.end(await readFile(path));
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`CueWeave UI preview: http://127.0.0.1:${port} (synthetic data, no model calls)`),
);
