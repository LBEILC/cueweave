---
version: 1
slug: 'entrypoints-options-app-tsx'
primary_target: 'apps/extension/entrypoints/options/App.tsx'
related_targets:
  ['apps/extension/entrypoints/popup/App.tsx', 'apps/extension/entrypoints/review/App.tsx']
---

# 设置页

## Scope

Mode: Operate. Extend the approved Warm Paper / neutral graphite system to the existing options page. Preserve model settings, provider permissions and test flow, subtitle preference persistence and live application, and cache management. Use the shared Brand and theme. Remove the visible font attribution from Popup and workbench; retain font assets and distribution notices.

## Direction contract

THESIS: A quiet configuration desk with three easy-to-find tasks: connect a model, adjust subtitles, manage cached translations.

OWN-WORLD: Inherit DESIGN.md: MiSans, warm-paper light ground, neutral graphite dark surfaces, vivid-orange actions, the solid quotation brand mark, fine borders, modest rounded controls. No striped background, colored rail or numbered headings.

FIRST VIEWPORT: Compact shared brand bar, narrow section navigation, and the complete provider form with a clear save-and-test action. Navigation becomes horizontal on narrow screens; fields stack without horizontal overflow.

STORY: Connect the model first, see how display preferences change subtitle reading, save the preferences, then manage reusable translations when needed. Keep each save action with its own form and result.

FORM: Preserve the incumbent options page's three ordered task groups and form controls; extend the approved shared shell with section navigation. This is an existing-surface migration under the settled visual world, not a new concept deal. No new seed was drawn. The incumbent capture is .impeccable/review/options-before.png.

SIGNATURE INTERACTION: A labeled example subtitle preview changes with language, order, overall size, source-to-translation size ratio, position, background and shadow preferences before saving. Shadow has an independent switch and strength control. The ratio control appears only in bilingual mode and follows the language, not its vertical position. Saving still uses the existing extension message flow.

STATES: Provider testing, success and failure; display save success and failure; bilingual-only order control; disabled background-opacity slider; cache loading, populated, empty and failure. Verify desktop, 760px and 390px in light/dark using isolated synthetic preview data.

BUILD PATH: Code-led continuation of the user-selected visual system.

## Boundary

Actual YouTube overlay styling follows the [player surface contract](entrypoints-youtube-content-index-ts.md). The in-page sample groups both languages on a neutral backing and gives source text secondary weight and ink only in bilingual mode; it demonstrates display preferences without connecting to a real provider.
