import type { SubtitlePreferences } from '../settings/subtitle';
import { subtitleTextShadow } from './subtitle-style';

export interface SubtitleOverlay {
  host: HTMLDivElement;
  caption: HTMLDivElement;
  translation: HTMLDivElement;
  source: HTMLDivElement;
  action: HTMLButtonElement;
  fit: () => void;
  dispose: () => void;
}

const fontLoads = new Set<string>();

function loadFont(url: string, weight: string): void {
  if (fontLoads.has(url)) return;
  fontLoads.add(url);
  // Chromium does not register @font-face rules inside a shadow root.
  const font = new FontFace('MiSans', `url("${url}")`, { weight, display: 'swap' });
  document.fonts.add(font);
  void font.load().catch(() => fontLoads.delete(url));
}

export function applyOverlayPreferences(
  overlay: SubtitleOverlay,
  preferences: SubtitlePreferences,
): void {
  overlay.host.style.setProperty('--cueweave-position', `${preferences.positionPercent}%`);
  overlay.host.style.setProperty('--cueweave-font-scale', String(preferences.sizePercent / 100));
  overlay.host.style.setProperty(
    '--cueweave-source-font-scale',
    String(preferences.sourceSizePercent / 100),
  );
  overlay.host.style.setProperty(
    '--cueweave-caption-background-opacity',
    preferences.backgroundEnabled ? String(preferences.backgroundOpacityPercent / 100) : '0',
  );
  overlay.caption.dataset.mode = preferences.displayMode;
  overlay.host.style.setProperty('--cueweave-caption-shadow', subtitleTextShadow(preferences));
  overlay.caption.dataset.order = preferences.bilingualOrder;
  overlay.caption.dataset.backing = String(preferences.backgroundEnabled);
  overlay.fit();
}

export function createSubtitleOverlay(fonts: {
  regular: string;
  semibold: string;
}): SubtitleOverlay {
  loadFont(fonts.regular, '400');
  loadFont(fonts.semibold, '600');
  const host = document.createElement('div');
  host.style.cssText =
    'position:absolute;inset:0;pointer-events:none;z-index:60;container-type:inline-size;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --cueweave-ink: #eeeeee;
      --cueweave-secondary: #d5d5d5;
      --cueweave-accent: #ff9859;
      --cueweave-action-ink: #202020;
      font-size: 16px;
      color-scheme: dark;
    }
    .cueweave-caption {
      position: absolute;
      bottom: var(--cueweave-position, 9%);
      left: 50%;
      transform: translateX(-50%);
      display: none;
      box-sizing: border-box;
      width: max-content;
      max-width: 90%;
      padding: 0.4em 0.7em 0.45em;
      border: 0;
      border-radius: 8px;
      color: var(--cueweave-ink);
      background: rgb(26 26 26 / var(--cueweave-caption-background-opacity, 0.8));
      font-family: "MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: calc(clamp(16px, 2.5cqi, 32px) * var(--cueweave-font-scale, 1) * var(--cueweave-fit-scale, 1));
      font-weight: 600;
      line-height: 1.42;
      text-align: center;
      text-wrap: balance;
      overflow-wrap: anywhere;
      text-shadow: var(--cueweave-caption-shadow, none);
    }
    .cueweave-caption[data-backing="false"] {
      -webkit-text-stroke: 1px rgb(0 0 0 / 85%);
      paint-order: stroke fill;
    }
    :host-context(.html5-video-player:not(.ytp-autohide)) .cueweave-caption {
      bottom: max(var(--cueweave-position, 9%), 60px);
    }
    .cueweave-caption[data-visible="true"] {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.2em;
    }
    .cueweave-translation { display: none; }
    .cueweave-caption[data-translated="true"] .cueweave-translation { display: block; }
    .cueweave-caption[data-translated="true"] .cueweave-source {
      color: var(--cueweave-secondary);
      font-size: calc(1em * var(--cueweave-source-font-scale, 0.68));
      font-weight: 400;
      line-height: 1.4;
    }
    .cueweave-caption[data-mode="translation"] .cueweave-source { display: none; }
    .cueweave-caption[data-mode="source"] .cueweave-translation { display: none; }
    .cueweave-caption[data-mode="source"] .cueweave-source {
      color: inherit;
      font-size: inherit;
      font-weight: inherit;
      line-height: inherit;
    }
    .cueweave-caption[data-mode="bilingual"][data-order="source-first"] .cueweave-source { order: -1; }
    .cueweave-translate-action {
      display: none;
      align-items: center;
      justify-content: center;
      align-self: center;
      box-sizing: border-box;
      min-height: 32px;
      max-width: 100%;
      margin: 6px 0 0;
      padding: 6px 12px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: var(--cueweave-accent);
      color: var(--cueweave-action-ink);
      font: 600 13px/1.4 "MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      text-shadow: none;
      -webkit-text-stroke: 0;
      pointer-events: auto;
      cursor: pointer;
      transition: background-color 160ms ease-out;
    }
    .cueweave-caption[data-action="true"] .cueweave-translate-action { display: inline-flex; }
    .cueweave-translate-action:hover:not(:disabled) { background: #ffb184; }
    .cueweave-translate-action:active:not(:disabled) { background: #ff9859; }
    .cueweave-translate-action:focus-visible {
      outline: 2px solid var(--cueweave-accent);
      outline-offset: 3px;
    }
    .cueweave-translate-action:disabled {
      color: var(--cueweave-secondary);
      border-color: #898989;
      background: #303030;
      cursor: default;
    }
    @media (prefers-reduced-motion: reduce) {
      .cueweave-translate-action { transition: none; }
    }
    @media (forced-colors: active) {
      .cueweave-caption { background: Canvas; color: CanvasText; text-shadow: none; }
      .cueweave-caption .cueweave-source { color: CanvasText; }
      .cueweave-translate-action { border-color: ButtonText; }
    }
  `;
  const caption = document.createElement('div');
  caption.className = 'cueweave-caption';
  caption.dataset.visible = 'false';
  const translation = document.createElement('div');
  translation.className = 'cueweave-translation';
  const source = document.createElement('div');
  source.className = 'cueweave-source';
  const action = document.createElement('button');
  action.className = 'cueweave-translate-action';
  action.type = 'button';
  action.addEventListener('pointerdown', (event) => event.stopPropagation());
  // Space/Enter on the action must not toggle YouTube playback as well.
  action.addEventListener('keydown', (event) => event.stopPropagation());
  action.addEventListener('keyup', (event) => event.stopPropagation());
  caption.append(translation, source, action);
  shadow.append(style, caption);
  let frame = 0;
  const fit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!host.isConnected) return;
      caption.style.removeProperty('--cueweave-fit-scale');
      if (!caption.offsetHeight) return;
      const available = host.clientHeight - parseFloat(getComputedStyle(caption).bottom) - 8;
      if (available <= 0 || caption.offsetHeight <= available) return;
      // Preserve both languages and their ratio when a long cue exceeds a small player.
      let low = 0.2;
      let high = 1;
      for (let i = 0; i < 7; i += 1) {
        const scale = (low + high) / 2;
        caption.style.setProperty('--cueweave-fit-scale', String(scale));
        if (caption.offsetHeight > available) high = scale;
        else low = scale;
      }
      caption.style.setProperty('--cueweave-fit-scale', String(low));
    });
  };
  const resize = new ResizeObserver(fit);
  resize.observe(host);
  const text = new MutationObserver(fit);
  text.observe(caption, { childList: true, subtree: true, characterData: true });
  // YouTube toggles its controls without resizing the player.
  const controls = new MutationObserver(fit);
  queueMicrotask(() => {
    if (host.parentElement)
      controls.observe(host.parentElement, { attributes: true, attributeFilter: ['class'] });
  });
  void document.fonts.ready.then(fit);
  return {
    host,
    caption,
    translation,
    source,
    action,
    fit,
    dispose: () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      text.disconnect();
      controls.disconnect();
      host.remove();
    },
  };
}
