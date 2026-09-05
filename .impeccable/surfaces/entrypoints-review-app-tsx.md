---
version: 1
slug: 'entrypoints-review-app-tsx'
primary_target: 'apps/extension/entrypoints/review/App.tsx'
related_targets: ['apps/extension/entrypoints/popup/App.tsx']
---

# 字幕工作台与 Popup

## Scope

Mode: Operate. Use existing video reports and actions. Build a runnable code-led preview, as approved in conversation; no standing build-path preference is recorded. This brief covers review and Popup; settings extends the same visual system under [its own brief](entrypoints-options-app-tsx.md). Player presentation is a separate surface.

## Direction contract

THESIS: A calm subtitle editing desk: corrections and their application status lead, with terminology within reach.

OWN-WORLD: User-pinned openhanako Warm Paper; #F8F4ED ground, near-white surfaces, vivid-orange actions, MiSans, fine borders, modest rounded controls. User-selected dark mode uses neutral graphite backgrounds and panels without a broad color cast. No decorative stripes or numbered kickers.

STORY: See translation readiness, inspect what changed, confirm names, export the permitted content. Signature interaction: filtering applied versus recorded suggestions reveals their distinct meaning in place.

FIRST VIEWPORT: Compact identity/navigation bar; video title and progress across the top; corrections at left, terminology at right. Export is available from the top bar. Popup shares the same controls and surfaces at 360px.

FORM: User-pinned reference overrides the random assignment; seed 6ad1a495, assigned index 6. Approved two-column workbench and compact Popup.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Reference

Local reference: E:/AIProject/openhanako/.github/assets/screenshot-main.jpg and desktop/src/themes/warm-paper.css. This is a style reference, not a pixel-matched composition or an asset-copy request. The palette and brand mark follow DESIGN.md.

## Confirmed palette and logo

User selected vivid orange and the B “引语” logo. Its neutral graphite dark canvas and panel colors, orange accents in both modes, and warm-paper light ground are applied to the workbench and Popup. Source values live in src/ui/theme.css. The shared Brand component uses apps/extension/public/cueweave-mark-paper.svg, with the solid double-quotation silhouette adapting to light and dark modes. Other logo concepts at `/logos` remain comparison-only.

## States and boundaries

Partial, working, complete, empty, source unavailable, provider unconfigured, translation failure; 360px Popup and 390px/760px/desktop workbench. Preserve API contracts, glossary invalidation, original transcripts, and export completeness requirements. Demonstration values exist only in the isolated preview server.

Popup provides a three-choice language selector below the subtitle switch. A successful change saves and broadcasts the display mode while retaining all other preferences. Pending changes disable the selector; failed changes retain the previous selection and show a retry message. English sources use “仅英文”; other known source languages use “仅原文”.

Popup status descriptions use the full content width. Reserve wrapping space so progress and standard error states fit without scrolling or truncating their text.
