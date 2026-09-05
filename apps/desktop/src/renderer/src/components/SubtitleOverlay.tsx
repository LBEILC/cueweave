import type { CSSProperties } from 'react';
import type { SubtitleAppearance } from '../../../shared/subtitle-appearance';

export function SubtitleOverlay({
  source,
  translation = '',
  appearance,
}: {
  source: string;
  translation?: string;
  appearance: SubtitleAppearance;
}) {
  const hasTranslation = Boolean(translation);
  const showSource = appearance.displayMode !== 'translation' || !hasTranslation;
  const showTranslation = appearance.displayMode !== 'source' && hasTranslation;
  const bilingual = showSource && showTranslation;
  const lines = [
    showSource && (
      <span
        key="source"
        className="caption-line"
        style={{ fontSize: bilingual ? `${appearance.sourceSizePercent}%` : undefined }}
      >
        {source}
      </span>
    ),
    showTranslation && (
      <span key="translation" className="caption-line">
        {translation}
      </span>
    ),
  ];
  if (appearance.bilingualOrder === 'translation-first') lines.reverse();
  const style = {
    bottom: `${appearance.positionPercent}%`,
    '--caption-scale': appearance.sizePercent / 100,
    '--caption-background': `rgb(0 0 0 / ${appearance.backgroundEnabled ? appearance.backgroundOpacityPercent / 100 : 0})`,
    textShadow: appearance.shadowEnabled
      ? `0 2px 5px rgb(0 0 0 / ${appearance.shadowStrengthPercent / 100}), 0 0 2px rgb(0 0 0 / ${appearance.shadowStrengthPercent / 100})`
      : 'none',
  } as CSSProperties;
  return source || translation ? (
    <div className="subtitle-overlay" style={style}>
      {lines}
    </div>
  ) : null;
}
