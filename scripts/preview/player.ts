import '../../apps/extension/src/ui/theme.css';
import './player.css';
import {
  createSubtitleOverlay,
  applyOverlayPreferences,
} from '../../apps/extension/src/ui/player-overlay';
import { DEFAULT_SUBTITLE_PREFERENCES } from '../../apps/extension/src/settings/subtitle';

document.querySelector<HTMLDivElement>('#root')!.innerHTML = `
  <main class="player-preview">
    <header class="player-preview-heading">
      <h1>播放器字幕</h1>
      <p>示例画面与字幕 · 使用实际播放器组件 · 不连接模型</p>
    </header>
    <div class="html5-video-player ytp-autohide" id="stage" aria-label="示例播放器">
      <span class="sample-label">示例画面</span>
      <div class="sample-controls"><span>02:14 / 12:38</span><span>播放器控制区</span></div>
    </div>
    <form class="player-preview-controls">
      <label>字幕状态<select id="caption-state">
        <option value="ready">双语字幕</option><option value="working">正在翻译</option>
        <option value="retry">翻译失败</option><option value="configure">尚未配置模型</option>
        <option value="empty">没有字幕</option><option value="disabled">字幕关闭</option>
      </select></label>
      <label>显示语言<select id="display-mode"><option value="bilingual">中英双语</option><option value="translation">仅中文</option><option value="source">仅原文</option></select></label>
      <label>双语顺序<select id="order"><option value="translation-first">中文在上</option><option value="source-first">原文在上</option></select></label>
      <label>画面明暗<select id="scene"><option value="dark">暗色画面</option><option value="light">明亮画面</option></select></label>
      <label>字幕大小 <output id="size-value">100%</output><input id="size" aria-label="字幕大小" type="range" min="75" max="150" value="100"></label>
      <label>原文字号比例 <output id="ratio-value">68%</output><input id="ratio" aria-label="原文字号比例" type="range" min="50" max="150" value="68"></label>
      <label>字幕位置 <output id="position-value">9%</output><input id="position" aria-label="字幕位置" type="range" min="4" max="28" value="9"></label>
      <label>背景不透明度 <output id="opacity-value">80%</output><input id="opacity" aria-label="背景不透明度" type="range" min="10" max="95" step="5" value="80"></label>
      <label class="check-field"><input id="backing" type="checkbox" checked>字幕背景</label>
      <label>阴影强度 <output id="shadow-strength-value">80%</output><input id="shadow-strength" aria-label="字幕阴影强度" type="range" min="0" max="100" step="5" value="80"></label>
      <label class="check-field"><input id="shadow" type="checkbox" checked>字幕阴影</label>
      <label class="check-field"><input id="controls" type="checkbox">显示播放器控制区</label>
      <label class="check-field"><input id="long-text" type="checkbox">长句示例</label>
      <button type="button" id="fullscreen">进入全屏预览</button>
    </form>
    <p class="player-preview-note" role="status" id="preview-note">可切换画面明暗，检查字幕可读性。</p>
  </main>`;

const stage = document.querySelector<HTMLDivElement>('#stage')!;
const overlay = createSubtitleOverlay({
  regular: '/fonts/MiSans-Regular.woff2',
  semibold: '/fonts/MiSans-Semibold.woff2',
});
stage.append(overlay.host);
overlay.host.id = 'cueweave-subtitle-overlay';
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

function render(): void {
  const mode = field('display-mode').value as 'bilingual' | 'translation' | 'source';
  const status = field('caption-state').value;
  const ready = status === 'ready';
  const sourceOnly = mode === 'source';
  const long = field('long-text').checked;
  applyOverlayPreferences(overlay, {
    ...DEFAULT_SUBTITLE_PREFERENCES,
    displayMode: mode,
    bilingualOrder: field('order').value as 'translation-first' | 'source-first',
    sizePercent: Number(field('size').value),
    sourceSizePercent: Number(field('ratio').value),
    positionPercent: Number(field('position').value),
    backgroundEnabled: field('backing').checked,
    backgroundOpacityPercent: Number(field('opacity').value),
    shadowEnabled: field('shadow').checked,
    shadowStrengthPercent: Number(field('shadow-strength').value),
  });
  for (const id of ['size', 'ratio', 'position', 'opacity', 'shadow-strength']) {
    document.getElementById(`${id}-value`)!.textContent = `${field(id).value}%`;
  }
  field('ratio').disabled = mode !== 'bilingual';
  field('order').disabled = mode !== 'bilingual';
  field('opacity').disabled = !field('backing').checked;
  field('shadow-strength').disabled = !field('shadow').checked;
  stage.classList.toggle('ytp-autohide', !field('controls').checked);
  stage.dataset.scene = field('scene').value;
  overlay.caption.dataset.visible = String(status !== 'empty' && status !== 'disabled');
  overlay.caption.dataset.translated = String(ready);
  overlay.translation.textContent = ready
    ? long
      ? '理解一句话，需要看见它前后的语境，而不只是逐个翻译词语。'
      : '让每一句话，完整地表达。'
    : '';
  overlay.source.textContent = long
    ? 'Understanding a sentence means seeing its context, not simply translating each word.'
    : 'Let every sentence tell the whole story.';
  overlay.caption.dataset.action = String(!ready && !sourceOnly);
  overlay.action.disabled = status === 'working';
  overlay.action.textContent =
    status === 'working'
      ? '正在翻译此处'
      : status === 'configure'
        ? '配置模型后翻译'
        : '重试翻译此处';
}

document.querySelector('form')!.addEventListener('input', render);
document.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault());
overlay.action.addEventListener('click', () => {
  if (field('caption-state').value === 'configure') {
    location.href = `/options.html${location.search}`;
    return;
  }
  field('caption-state').value = 'working';
  render();
  window.setTimeout(() => {
    field('caption-state').value = 'ready';
    render();
  }, 900);
});
document.getElementById('fullscreen')!.addEventListener('click', () => {
  void stage.requestFullscreen().catch(() => {
    document.getElementById('preview-note')!.textContent =
      '当前预览不支持全屏，请在独立浏览器窗口中打开。';
  });
});
render();
