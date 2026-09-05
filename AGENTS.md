# Project instructions

## Design workflow

- Approved workflow: `design-from-constraints` leads constraints and alternative prototypes; after the user explicitly confirms a direction, `impeccable` leads implementation, refinement, and polish.
- Current stage: implementation. Leading skill: `impeccable`. On 2026-09-05 the user confirmed layout A (video with a collapsible subtitle sidebar) and explicitly approved this handoff.
- Preserve that confirmed direction and the established Warm Paper brand. Visual decisions and constraints are recorded in [DESIGN.md](DESIGN.md#desktop-workspace). Do not restart design exploration or change the workflow without the user's decision.

## Git delivery

- After completing changes and the relevant validation, automatically commit and push them to the configured remote branch unless the user explicitly asks otherwise.
- This also applies to workspace cleanup: preserve existing work by committing it; do not discard changes to obtain a clean status.
- Keep secrets, local user data, caches, and generated build or acceptance artifacts out of commits. Report any validation or push blocker accurately.

## Automated media checks

- During rapid iteration, do not build installers unless the user explicitly requests one. Validate with development/production builds and silent app acceptance instead. Requested on 2026-09-05.

- Run automated playback and acceptance tests with audio output muted. Preserve normal interactive playback volume; do not change the user's system volume. The user requested silent tests on 2026-09-05.
