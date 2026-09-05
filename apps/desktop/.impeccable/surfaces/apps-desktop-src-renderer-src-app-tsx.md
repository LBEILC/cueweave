---
version: 1
slug: 'apps-desktop-src-renderer-src-app-tsx'
primary_target: 'apps/desktop/src/renderer/src/App.tsx'
related_targets: ['apps/desktop/src/renderer/src/style.css']
---

# Desktop shell

Mode: Operate. Scope: the Electron application shell, persistent media player, subtitle sidebar, import flow, and About overlay. Follow docs/DESKTOP.md for desktop product requirements and DESIGN.md#desktop-workspace for the user-confirmed direction.

## Direction contract

THESIS: A window-bound subtitle workspace: watching and reading stay together, and playback controls never scroll away.

OWN-WORLD: Inherit Warm Paper, neutral dark surfaces, original MiSans assets, the quote mark, and Phosphor controls. No new visual identity.

STORY: Open a file or link, watch, load subtitles, search or click a cue to locate playback. Collapse the subtitle panel for watching. Import and About retain the media element and return focus to their trigger. Source settings fold away once a track is loaded.

FIRST VIEWPORT: Native window frame; compact application header, current media row, video with optional right subtitle panel, fixed transport, and task status strip. The video fits remaining space. At 900px and below, the subtitle panel overlays the video area without covering playback controls. Minimum application window is 640×480. Empty/import/About content scrolls within its own region.

FORM: Code-led implementation of the user-confirmed A wireframe from design-from-constraints. The user explicitly approved impeccable for this implementation stage; do not reroll the visual direction. Existing Warm Paper, MiSans and Phosphor remain authoritative. The comparison is a structural reference, not a pixel-perfect image comp. No new raster assets.

QUALITY BAR: No root scroll or clipped transport at 1120×720, 960×640, and 640×480; readable long subtitles with independent scrolling; preserved media element and paused position across overlays; discoverable source controls, keyboard-safe form input, current-cue indication, light/dark parity. No fake project, translation, ASR, or export buttons. D1 persistence/editing remains out of scope.

EVIDENCE: Deterministic MP4/WebM and a 503-cue VTT fixture in isolated Electron user data. The acceptance screenshots live in .impeccable/review/desktop-smoke/, the A/B/C comparison in .impeccable/review/desktop-redesign/. These are test fixtures, never shipped defaults. Automated media output must be muted.

FINISH: On 2026-09-05 the independent finish reviewer returned `ship` with no material fixes within the bounded production-screenshot and code review. Built values and local video/shadow/scrim exceptions are recorded in DESIGN.md#desktop-workspace; the shared sidecar retains extension examples and adds desktop primitives. No new shipping raster assets were introduced. Validation evidence is maintained in docs/desktop/2026-09-05-workspace-acceptance.md; the review does not imply completion of D1 editing/persistence or later product milestones.

BUILT DETAILS: The viewport grid uses a 52px header and 30px status strip; media heading is at least 44px. Wide sidebar width is clamp(280px, 29vw, 380px); at <=900px it becomes a min(360px, 70%) overlay within the video region, with a local boundary shadow. At <=680px horizontal header/control padding is 12px and video inset is 8px. Dialog width is min(720px, calc(100vw - 40px)) with a 40px viewport height allowance. Controls use 8px corners, compact subtitle selects 5px, dialogs/import previews 14px. Loaded source controls collapse in a details disclosure; current cues have aria-current, a text marker, orange time, neutral selected background, and semibold text. Long lists use native scrolling and content-visibility, not a fixed-row virtualizer.
