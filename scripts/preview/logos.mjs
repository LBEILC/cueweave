export const logoConcepts = {
  link: {
    name: 'A · 连结',
    description: '把两段线索扣在一起。圆润、紧凑，偏独立工具品牌。',
    paths:
      '<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M24 35l-5-5a9.2 9.2 0 0 1 13-13l5 5"/><path d="M40 29l5 5a9.2 9.2 0 0 1-13 13l-5-5"/><path d="m25 25 14 14"/></g>',
  },
  quote: {
    name: 'B · 引语',
    description: '从双引号提炼实心轮廓。直接表达语言、引用和字幕。',
    paths:
      '<path fill="currentColor" d="M14 16h14v16c0 10-5 15-14 17v-7c5-2 7-5 7-9h-9V18a2 2 0 0 1 2-2Zm24 0h14v16c0 10-5 15-14 17v-7c5-2 7-5 7-9h-9V18a2 2 0 0 1 2-2Z"/>',
  },
  han: {
    name: 'C · 句印',
    description: '用「句」的折笔和留白形成小印记。中文辨识更强。',
    paths:
      '<g fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="m20 12-8 13M17 20h33v23c0 6-3 9-9 9h-6"/><path d="M21 29h15v13H21z"/></g>',
  },
  tracks: {
    name: 'D · 双轨',
    description: '两条字幕轨交换、交织。与「句织」的产品含义最贴近。',
    paths:
      '<defs><mask id="cross"><rect width="64" height="64" fill="white"/><path d="M10 45h10c12 0 12-26 24-26h10" fill="none" stroke="black" stroke-width="12"/></mask></defs><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path d="M10 19h10c12 0 12 26 24 26h10" mask="url(#cross)"/><path d="M10 45h10c12 0 12-26 24-26h10"/></g>',
  },
};

export function logoSvg(id, mode = 'light', tile = false, monochrome = false) {
  if (!Object.hasOwn(logoConcepts, id)) return undefined;
  const dark = mode === 'dark';
  const accent = dark ? '#ff9859' : '#b6450f';
  const ink = dark ? '#202020' : '#ffffff';
  const color = monochrome ? (dark ? '#eeeeee' : '#383838') : tile ? ink : accent;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style="color:${color}">${tile ? `<rect width="64" height="64" rx="16" fill="${accent}"/>` : ''}${logoConcepts[id].paths}</svg>`;
}

export function logoCss(id, theme) {
  if (!Object.hasOwn(logoConcepts, id)) return '';
  const mode = theme === 'dark' || theme?.endsWith('-dark') ? 'dark' : 'light';
  return `.cw-brand img{content:url('/logo-concept.svg?id=${id}&mode=${mode}&tile=1');}`;
}

const img = (id, mode, size, tile = false, mono = false) =>
  `<img width="${size}" height="${size}" alt="" src="/logo-concept.svg?id=${id}&mode=${mode}&tile=${tile ? 1 : 0}&mono=${mono ? 1 : 0}">`;
export const logosPage = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>句织 · Logo 方向</title><style>
@font-face{font-family:MiSans;src:url('/fonts/MiSans-Regular.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:MiSans;src:url('/fonts/MiSans-Semibold.woff2') format('woff2');font-weight:600;font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#ededeb;color:#333;font:14px/1.6 MiSans,system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:28px 24px}h1{font-size:25px;line-height:1.4;margin:0 0 8px;font-weight:600}header p{margin:0;color:#626262;max-width:75ch}.concepts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin-top:26px}article{min-width:0;background:#fbfaf7;border:1px solid #d2d2cf;border-radius:12px;padding:18px}h2{margin:0 0 6px;font-size:20px;font-weight:600}article>p{font-size:12px;color:#636363;min-height:58px;margin:0 0 16px}.hero{display:grid;grid-template-columns:1fr 1fr;border-radius:8px;overflow:hidden}.hero>div{display:grid;place-items:center;height:122px;background:#f2eee7}.hero>.dark{background:#1a1a1a}.legend{font-size:11px;color:#6a6a6a;margin:8px 0 18px}.sizes{display:flex;align-items:center;justify-content:space-between;min-height:55px;gap:12px}.sizes span{display:grid;gap:7px;justify-items:center;font-size:10px;color:#686868}.mono{margin:16px 0;display:flex;align-items:center;gap:12px;font-size:11px;color:#626262}.brand-sample{display:flex;align-items:center;gap:9px;padding:14px 10px;margin:18px 0;background:#f2eee7;border-radius:7px}.brand-sample strong{font-size:15px;font-weight:600}.brand-sample small{font-size:10px;color:#676767}nav{display:grid;grid-template-columns:1fr 1fr;gap:6px}a{font-size:12px;color:#784526;text-decoration:none;padding:8px 4px;border:1px solid #cfc4bb;border-radius:5px;text-align:center}a:hover{background:#eee7df}a:focus-visible{outline:2px solid #b6450f;outline-offset:3px}.download{display:block;border:0;margin-top:8px;text-decoration:underline;text-underline-offset:4px;color:#676767}footer{margin-top:24px;color:#636363;font-size:12px}@media(max-width:1100px){.concepts{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:570px){main{padding:20px 16px}.concepts{grid-template-columns:1fr}article>p{min-height:0}}
</style></head><body><main><header><h1>给「句织」换一个更好认的标志</h1><p>已采用 B「引语」与活力橙配色。其余方向保留作对照。</p></header><div class="concepts">${Object.entries(
  logoConcepts,
)
  .map(
    ([id, concept]) =>
      `<article id="${id}"><h2>${concept.name}</h2><p>${concept.description}</p><div class="hero"><div>${img(id, 'light', 88)}</div><div class="dark">${img(id, 'dark', 88)}</div></div><div class="legend">浅色 / 深色 · 独立标志</div><div class="sizes">${[16, 24, 32, 48].map((size) => `<span>${img(id, 'light', size, true)}${size} px</span>`).join('')}</div><div class="mono">${img(id, 'light', 24, false, true)}<span>单色轮廓</span></div><div class="brand-sample">${img(id, 'light', 30, true)}<strong>句织</strong><small>CueWeave</small></div><nav aria-label="${concept.name}界面预览"><a href="/?surface=review&theme=light&logo=${id}">浅色工作台</a><a href="/?surface=review&theme=dark&logo=${id}">深色工作台</a></nav><a class="download" href="/logo-concept.svg?id=${id}&mode=light&tile=1" download="cueweave-${id}.svg">下载 SVG 方案</a></article>`,
  )
  .join(
    '',
  )}</div><footer>工作台与 Popup 使用 B「引语」。16–48 px 为实际显示尺寸。</footer></main></body></html>`;
