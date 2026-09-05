---
version: 1
slug: 'entrypoints-youtube-content-index-ts'
primary_target: 'apps/extension/entrypoints/youtube.content/index.ts'
related_targets: ['apps/extension/src/ui/player-overlay.ts', 'scripts/preview/player.ts']
---

# 播放器字幕

Mode: Read. Migrate the existing subtitle overlay into the approved graphite / vivid-orange visual system. Preserve transcription, translation requests, timing, retries, settings and player input behavior.

## Direction contract

THESIS: Read complete bilingual sentences while the video remains the main content.

OWN-WORLD: Inherit DESIGN.md and the user's neutral graphite, vivid-orange actions and MiSans. Video captions keep a neutral dark background in both browser themes for contrast over moving footage.

FIRST VIEWPORT: Centered bilingual subtitles near the bottom of the player; translation leads, source follows the saved ratio and order. A quiet rounded graphite backing replaces the brown surface and gold border. Action text is legible independently of subtitle size.

STORY: Watch source captions while translation is pending, read translated sentences when ready, retry a failure or open configuration from the same location. Empty and disabled states leave the video unobstructed.

FORM: Preserve the existing player overlay and its inline action. This is an existing-surface migration under a user-selected world, not a new composition or identity exercise; no new seed or comp. Code-led build. Baseline: .impeccable/review/player-before.png.

SIGNATURE INTERACTION: Subtitle scale follows the player rather than the browser window; settings immediately update language, order, size ratio, position and backing without interrupting playback. Player controls have safe space when visible.

STATES: translated, original fallback, translating, retry, configure, empty, disabled; background on/off; narrow, desktop and fullscreen. Real extension checks use a fresh profile and no user credentials. Synthetic checks label their source and share the production overlay component.

## Quality bar

Neutral large surfaces, orange only for actions/focus. Visible keyboard focus and minimum 32px inline action target. No horizontal text overflow. No pointer interception outside the action. Source-only captions ignore the bilingual ratio. Font assets must actually load. No forced announcements on every changing subtitle.
