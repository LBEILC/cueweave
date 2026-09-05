---
version: 1
slug: 'apps-desktop-src-renderer-src-app-tsx'
primary_target: 'apps/desktop/src/renderer/src/App.tsx'
related_targets: ['apps/desktop/src/renderer/src/style.css']
---

# Desktop shell

Mode: Operate. Scope: the Electron application shell, empty workspace, and About page. Follow docs/DESKTOP.md for desktop product requirements and DESIGN.md for the established visual system.

## Direction contract

THESIS: A quiet host for subtitle work; application information stays in About.

OWN-WORLD: Inherit Warm Paper, neutral dark surfaces, original MiSans assets, the quote mark, and Phosphor controls. No new visual identity.

STORY: The workspace shows its empty state; About retrieves the installed app version and opens the bundled font license. Returning restores keyboard focus.

FIRST VIEWPORT: Native window frame; compact header with brand left and About right. The empty workspace occupies the remaining area. About is a readable single column with a back control, version rows, and license notices.

FORM: Direct implementation of the narrowly scoped host foundation; no concept seed or raster comp required. Dark and light themes follow the system. Narrow windows scroll vertically.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
