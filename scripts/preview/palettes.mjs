// Palette proposals stay in the preview until the user chooses a direction.
import { orangePalettes } from './orange-palettes.mjs';

const previousPalettes = {
  warm: {
    name: 'A · 暖墨',
    description: '暖炭底与浅麦金。温润、安静，延续浅色界面的书页感。',
    tokens: {
      paper: '#211f1c',
      surface: '#2b2824',
      'surface-muted': '#37322c',
      ink: '#eee7dd',
      'ink-secondary': '#bfb4a6',
      line: '#454038',
      'line-strong': '#928575',
      accent: '#d8ba8a',
      'accent-hover': '#e6cea8',
      'accent-wash': '#403529',
      'on-accent': '#292319',
      success: '#b5cca9',
      'success-wash': '#30392c',
      warning: '#e4c28b',
      'warning-wash': '#453727',
      danger: '#e8b0a2',
      'danger-wash': '#48322c',
      focus: '#d8ba8a',
    },
  },
  graphite: {
    name: 'B · 石墨',
    description: '中性炭灰与雾蓝。背景更克制，颜色集中在操作和状态上。',
    tokens: {
      paper: '#191b1e',
      surface: '#23262b',
      'surface-muted': '#2e3238',
      ink: '#e7e9ed',
      'ink-secondary': '#b2b9c3',
      line: '#3d424b',
      'line-strong': '#808995',
      accent: '#aac0df',
      'accent-hover': '#c7d7ed',
      'accent-wash': '#2c384b',
      'on-accent': '#1e2a3a',
      success: '#b1ceb8',
      'success-wash': '#2c3b32',
      warning: '#dfc18f',
      'warning-wash': '#413727',
      danger: '#e4b1ae',
      'danger-wash': '#463131',
      focus: '#aac0df',
    },
  },
  pine: {
    name: 'C · 夜松',
    description: '深松绿与浅玉色。低饱和的绿调，让夜间界面多一点自然感。',
    tokens: {
      paper: '#19231f',
      surface: '#222f29',
      'surface-muted': '#2d3c34',
      ink: '#e4eae3',
      'ink-secondary': '#b4c2b7',
      line: '#405047',
      'line-strong': '#83998a',
      accent: '#aad2bf',
      'accent-hover': '#c7e5d6',
      'accent-wash': '#2d4339',
      'on-accent': '#1b3026',
      success: '#c7d4a2',
      'success-wash': '#36422d',
      warning: '#e2c492',
      'warning-wash': '#453c2b',
      danger: '#e6b8a8',
      'danger-wash': '#483a31',
      focus: '#aad2bf',
    },
  },
};

export const palettes = { ...previousPalettes, ...orangePalettes };

export function paletteCss(theme) {
  if (!Object.hasOwn(palettes, theme)) return '';
  const scheme = palettes[theme].scheme ?? 'dark';
  const brand = Object.hasOwn(orangePalettes, theme)
    ? `.cw-brand img{content:url('/preview-mark.svg?theme=${theme}');}`
    : '';
  return `:root{color-scheme:${scheme};${Object.entries(palettes[theme].tokens)
    .map(([key, value]) => `--${key}:${value};`)
    .join('')}}${brand}`;
}

export const themesPage = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>句织 · 深色配色候选</title><style>
@font-face{font-family:MiSans;src:url('/fonts/MiSans-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:MiSans;src:url('/fonts/MiSans-Semibold.woff2') format('woff2');font-weight:600;font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#151618;color:#e9e7e1;font:14px/1.6 MiSans,system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px 24px}h1{font-size:25px;font-weight:600;letter-spacing:-.02em;margin:0 0 8px}header>p{color:#b8b9bd;margin:0;max-width:65ch}nav{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0 28px}a{color:#cfdae7;text-underline-offset:4px}nav a{padding:7px 12px;border:1px solid #4b4d52;border-radius:6px;text-decoration:none}.schemes{display:grid;grid-template-columns:repeat(3,360px);justify-content:center;gap:24px}article{min-width:0;scroll-margin-top:20px}h2{font-size:20px;line-height:1.4;margin:0 0 6px;color:var(--tint);font-weight:600}article p{color:#b8b9bd;min-height:46px;margin:0 0 14px;font-size:13px}.swatches{display:flex;gap:6px;margin-bottom:16px}.swatches span{height:16px;width:34px;background:var(--swatch);border:1px solid #ffffff26;border-radius:4px}.preview-frame{outline:1px solid #42454a;outline-offset:-1px;border-radius:12px;overflow:hidden;background:var(--ground)}iframe{display:block;width:100%;height:580px;border:0;color-scheme:dark}.inspect{display:block;text-align:center;border:1px solid #53565c;border-radius:7px;padding:10px;margin-top:14px;text-decoration:none;color:var(--tint)}.inspect:hover{background:#292b2f}.inspect:focus-visible,nav a:focus-visible{outline:2px solid #ddd;outline-offset:4px}footer{color:#afb1b5;font-size:12px;padding-top:24px}@media(max-width:1175px){.schemes{grid-template-columns:360px;justify-content:center;gap:36px}article p{min-height:0}}@media(max-width:410px){main{padding:24px 12px}.schemes{grid-template-columns:360px;justify-content:start}h1{font-size:22px}}
</style></head><body><main><header><h1>选一个舒服的深色</h1><p>同一个弹窗，三种配色。下方可打开完整工作台，查看修正记录、输入框和操作按钮。</p><nav aria-label="配色方案">${Object.entries(
  previousPalettes,
)
  .map(([key, value]) => `<a href="#${key}">${value.name}</a>`)
  .join(
    '',
  )}<a href="/?surface=popup&theme=dark">当前深色</a><a href="/?surface=review&theme=light">浅色参照</a></nav></header><div class="schemes">${Object.entries(
  previousPalettes,
)
  .map(
    ([key, value]) =>
      `<article id="${key}" style="--tint:${value.tokens.accent};--ground:${value.tokens.paper}"><h2>${value.name}</h2><p>${value.description}</p><div class="swatches" aria-label="底色、面板、强调色和文字">${['paper', 'surface', 'accent', 'ink'].map((role) => `<span title="${role} ${value.tokens[role]}" style="--swatch:${value.tokens[role]}"></span>`).join('')}</div><div class="preview-frame"><iframe title="${value.name}弹窗预览" src="/popup.html?theme=${key}&state=partial"></iframe></div><a class="inspect" href="/?surface=review&theme=${key}&state=partial">查看${value.name.slice(4)}工作台</a></article>`,
  )
  .join(
    '',
  )}</div><footer>历史配色候选 · 合成示例数据 · 当前界面使用石墨与活力橙</footer></main></body></html>`;
