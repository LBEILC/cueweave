---
version: 1
slug: 'apps-desktop-src-renderer-src-components-settingspage-tsx'
primary_target: 'apps/desktop/src/renderer/src/components/SettingsPage.tsx'
related_targets:
  ['apps/desktop/src/renderer/src/App.tsx', 'apps/desktop/src/renderer/src/style.css']
---

# Desktop settings

Mode: Operate. Scope: desktop appearance and one AI service configuration. Product behavior and credential boundaries belong to docs/DESKTOP_SETTINGS.md; visual authority remains DESIGN.md#desktop-workspace.

THESIS: Adjust appearance or connect a model service, then return to the preserved subtitle workspace.

OWN-WORLD: Retain Warm Paper, neutral graphite dark surfaces, bundled MiSans Regular/Semibold and Phosphor. Flat surfaces, fine dividers and orange actions inherit the confirmed desktop world.

STORY: Enter from the header and pause the mounted player. Choose an immediately applied, persistent theme; edit and save service address, model, protocol and key; test saved configuration and read the result. Saved keys show status only. Return restores entry focus. An unsaved AI draft offers continue editing or discard; the safe continue action receives focus and reveals the prompt even after scrolling.

FIRST VIEWPORT: Retained brand header, return control and settings heading, appearance section, then AI service fields. The settings heading and result region sit outside the independently scrolling form. At wide sizes the sections use a 180px label column and flexible form column with a 32px gap and a 960px content limit. At <=760px labels stack above forms with 16px gaps and 24px horizontal padding. The full form remains reachable at 640×480 without root scrolling.

FORM: A precise extension of the user-confirmed A workspace, implemented under Impeccable after the approved design-from-constraints handoff. No new visual world, concept tournament or assets. Three theme buttons use visible labels, Phosphor icons, orange selected border/text and aria-pressed. Fields retain visible labels and 40px height; model and protocol share a row. Save uses the established white-on-dark-orange primary button; test/cancel is secondary. Result text remains outside form scrolling and can itself scroll when long.

QUALITY BAR: Light/dark parity; visible return and feedback; independently scrollable narrow form; preserved paused media and editor state; keyboard-safe fields; safe focus on dirty return; credential status without saved-key echo. Connection testing uses saved configuration and communicates pending, cancellation and failure. Do not infer completed subtitle translation or ASR from this configuration surface.

EVIDENCE: Nine accepted captures in the ignored .impeccable/review/desktop-settings/ directory cover wide light/dark/error, narrow top/bottom and mouse/keyboard dirty return. Functional acceptance scope and isolated local-service fixtures are described in docs/DESKTOP_SETTINGS.md. Test model/auth/address values are not shipping defaults; initial production provider fields are empty. Automated media checks stay muted.

FINISH: Independent finish review found an offscreen dirty-return prompt. Focusing the safe continue action resolved that finding; the verdict pass scored that finding resolved with disposition ship, limited to that fix. This is a UI verdict, not an expansion of functional or security claims. No new motion beyond the existing reduced-motion-aware loading spinner, and no new raster assets.
