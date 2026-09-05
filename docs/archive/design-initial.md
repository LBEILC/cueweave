> 历史设计记录。产品上下文由 [PRODUCT.md](../../PRODUCT.md) 维护，已确认的视觉规则由 [DESIGN.md](../../DESIGN.md) 维护。下文工业风、石墨色与琥珀色方向已被用户指定的暖纸风方向取代，保留供追溯。

## Design Context

### Users

CueWeave serves people watching interviews, lectures, talks, and other captioned YouTube videos who want complete, natural bilingual subtitles instead of fragmented line-by-line translation. They configure the extension briefly, then spend most of their time focused on the video rather than the extension UI.

### Brand Personality

Restrained, precise, immersive. The interface should feel dependable and quietly technical without role-playing as a terminal. It should reduce the effort of reading and configuring subtitles, then recede behind the content.

### Aesthetic Direction

Use a quiet industrial aesthetic inspired by the material character of `chronos---immersive-memory-timeline`: graphite-tinted surfaces, warm amber accents, squared controls, disciplined spacing, and small monospaced metadata. Reinterpret the accent as a semantic thread that connects caption fragments into a complete sentence.

Body copy and subtitles use highly legible proportional type. Avoid full-screen CRT scanlines, neon glow, all-monospace typography, decorative system codes, fake terminal language, mechanical sound effects, glassmorphism, and modal-heavy settings. Support the browser theme; the dark graphite theme is the primary visual expression, not the only accessible mode.

### Design Principles

1. Readability outranks atmosphere, especially over moving video and at extension-popup widths.
2. One warm amber semantic thread carries brand emphasis; other colors communicate status only.
3. Keep the Popup focused on current-video state and one primary action; reveal technical settings progressively on the Options page.
4. Use proportional text for reading and monospaced text only for timestamps, model names, track identifiers, and compact diagnostics.
5. Meet WCAG AA contrast, provide visible keyboard focus, label every icon and switch, and honor reduced-motion preferences.
6. Player controls and subtitle overlays remain calmer than management surfaces so CueWeave never competes with the video.
