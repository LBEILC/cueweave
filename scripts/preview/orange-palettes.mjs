import { logoConcepts } from './logos.mjs';

const dark = {
  paper: '#1a1a1a',
  surface: '#242424',
  'surface-muted': '#303030',
  ink: '#eeeeee',
  'ink-secondary': '#b9b9b9',
  line: '#414141',
  'line-strong': '#898989',
  'accent-wash': '#303030',
  'on-accent': '#202020',
  success: '#b9c8bb',
  'success-wash': '#2d322e',
  warning: '#dbc59e',
  'warning-wash': '#34312b',
  danger: '#deb4ad',
  'danger-wash': '#382d2b',
};
const light = {
  paper: '#f8f4ed',
  surface: '#fffdf9',
  'surface-muted': '#eeeae4',
  ink: '#383838',
  'ink-secondary': '#69645e',
  line: '#dedbd5',
  'line-strong': '#8e8982',
  'accent-wash': '#eeeae4',
  'on-accent': '#ffffff',
  success: '#496750',
  'success-wash': '#eaf0e9',
  warning: '#7b6037',
  'warning-wash': '#f2eadb',
  danger: '#925448',
  'danger-wash': '#f4e9e5',
};

export const orangePalettes = {
  'copper-dark': {
    name: '铜橙 · 深色',
    scheme: 'dark',
    tokens: { ...dark, accent: '#d6a27d', 'accent-hover': '#e6bb99', focus: '#d6a27d' },
  },
  'copper-light': {
    name: '铜橙 · 浅色',
    scheme: 'light',
    tokens: { ...light, accent: '#a4512c', 'accent-hover': '#914423', focus: '#a4512c' },
  },
  'orange-dark': {
    name: '活力橙 · 深色',
    scheme: 'dark',
    tokens: { ...dark, accent: '#ff9859', 'accent-hover': '#ffb184', focus: '#ff9859' },
  },
  'orange-light': {
    name: '活力橙 · 浅色',
    scheme: 'light',
    tokens: { ...light, accent: '#b6450f', 'accent-hover': '#a73c09', focus: '#b6450f' },
  },
};

export function previewMark(theme) {
  const palette = orangePalettes[theme];
  if (!palette) return undefined;
  const { accent, 'on-accent': ink } = palette.tokens;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style="color:${ink}"><rect width="64" height="64" rx="16" fill="${accent}"/>${logoConcepts.quote.paths}</svg>`;
}

const choices = [
  {
    id: 'copper',
    name: 'A · 铜橙',
    description: '橙色更柔和，接近铜与陶土的色调。适合想让内容安静占据主导的界面。',
  },
  {
    id: 'orange',
    name: 'B · 活力橙',
    description: '橙色更清晰、饱满。按钮更容易被注意到，背景和面板仍保持中性。',
  },
];
export const orangePage = `<!doctype html><html lang="zh-CN" data-mode="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>句织 · 石墨与橙色</title><style>
@font-face{font-family:MiSans;src:url('/fonts/MiSans-Regular.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:MiSans;src:url('/fonts/MiSans-Semibold.woff2') format('woff2');font-weight:600;font-display:swap}
:root{color-scheme:dark;--ground:#171717;--ink:#eeeeee;--secondary:#bdbdbd;--line:#555555;--selected:#3c3c3c}[data-mode=light]{color-scheme:light;--ground:#eaeaea;--ink:#333333;--secondary:#606060;--line:#909090;--selected:#ffffff}*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 MiSans,system-ui,sans-serif}main{max-width:808px;margin:auto;padding:28px 24px}h1{font-size:24px;line-height:1.4;margin:0 0 8px;font-weight:600}header p{margin:0;color:var(--secondary)}.tools{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:20px 0 26px}.mode{display:flex;border:1px solid var(--line);border-radius:8px;padding:3px;gap:3px}button{font:inherit;color:var(--secondary);border:0;background:transparent;border-radius:5px;padding:6px 18px;cursor:pointer}button[aria-pressed=true]{color:var(--ink);background:var(--selected);font-weight:600}a{color:var(--secondary);text-underline-offset:4px}button:focus-visible,a:focus-visible{outline:2px solid var(--ink);outline-offset:4px}.schemes{display:grid;grid-template-columns:repeat(2,360px);gap:32px;justify-content:center}article{min-width:0;scroll-margin-top:16px}h2{margin:0 0 8px;font-size:20px;font-weight:600}article p{margin:0 0 18px;min-height:44px;font-size:13px;color:var(--secondary)}.frame{outline:1px solid var(--line);outline-offset:-1px;overflow:hidden;border-radius:12px}iframe{display:block;width:360px;height:600px;border:0}.workbench{display:block;margin-top:12px;padding:10px;border:1px solid var(--line);border-radius:7px;text-align:center;color:var(--ink);text-decoration:none}.workbench:hover{background:var(--selected)}footer{margin-top:24px;font-size:12px;color:var(--secondary)}@media(max-width:799px){.schemes{grid-template-columns:360px;gap:32px}}@media(max-width:399px){main{padding:20px 12px}}
</style></head><body><main><header><h1>石墨打底，橙色点睛</h1><p>深色背景与面板统一为中性灰。切换浅色，比较同一套橙色如何适配暖纸底。</p><div class="tools"><div class="mode" role="group" aria-label="预览明暗模式"><button type="button" data-mode="dark" aria-pressed="true">深色</button><button type="button" data-mode="light" aria-pressed="false">浅色</button></div><a href="/themes">上一轮配色</a></div></header><div class="schemes">${choices.map((value) => `<article id="${value.id}"><h2>${value.name}</h2><p>${value.description}</p><div class="frame"><iframe title="${value.name}弹窗" data-choice="${value.id}" src="/popup.html?theme=${value.id}-dark&state=partial"></iframe></div><a class="workbench" data-choice="${value.id}" href="/?surface=review&theme=${value.id}-dark">查看完整工作台</a></article>`).join('')}</div><footer>活力橙已选定并应用；铜橙保留作对照。预览使用合成示例数据。</footer></main><script>
const controls=Array.from(document.querySelectorAll('button[data-mode]'));
for(const frame of document.querySelectorAll('iframe[data-choice]'))frame.addEventListener('load',()=>{const doc=frame.contentDocument;doc.fonts.ready.then(()=>{frame.style.height=Math.ceil(doc.body.getBoundingClientRect().height)+2+'px';});});
function setMode(mode){document.documentElement.dataset.mode=mode;for(const button of controls)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));for(const frame of document.querySelectorAll('iframe[data-choice]')){frame.style.colorScheme=mode;frame.src='/popup.html?theme='+frame.dataset.choice+'-'+mode+'&state=partial';}for(const link of document.querySelectorAll('a[data-choice]'))link.href='/?surface=review&theme='+link.dataset.choice+'-'+mode;history.replaceState(null,'','/orange?mode='+mode+location.hash);}
for(const button of controls)button.addEventListener('click',()=>setMode(button.dataset.mode));setMode(new URLSearchParams(location.search).get('mode')==='light'?'light':'dark');
</script></body></html>`;
