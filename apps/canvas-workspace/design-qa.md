# Scheduled task controls — design QA

- Source visual truth: the two annotated Scheduled screenshots supplied with this task (`codex-clipboard-115a…png` and `codex-clipboard-080a…png`).
- Implementation screenshots: `.harness/runs/harness-2026-07-26T14-19-05-735Z/screenshot-1785075550477.png` (list) and `.harness/runs/harness-2026-07-26T14-17-02-942Z/screenshot-1785075444011.png` (Chat).
- Full-view comparisons: `scheduled-list-comparison.png` beside the final list screenshot, plus `scheduled-chat-comparison.png` beside the Chat screenshot.
- Source pixels: 3024 × 1898. Implementation pixels: 2400 × 1544.
- Implementation CSS viewport: 1200 × 772 at device scale factor 2.
- Density normalization: both sides were downsampled to 900 pixels high before side-by-side review.
- State: the source uses a completed real task; the disposable demo profile has no model credentials or run history. Data-state differences were not treated as visual regressions. The comparison targets are the list controls and removal of the duplicate Chat header card.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: all action names are now visible at 11px with the existing Canvas button weight; no icon requires guessing.
- Spacing and layout rhythm: the whole task row shares one hover surface and baseline. The former grey task block/white action-strip split is gone.
- Colors and visual tokens: buttons, borders, task states, and hover treatment reuse existing Canvas tokens and the blessed Button component.
- Image quality and asset fidelity: no new imagery is required. Phosphor icons remain sharp at 2× density; no handcrafted assets were added.
- Copy and content: the row exposes `Resume`/`Pause`, `Run now`, and `Edit task`; user-created tasks additionally expose `Delete task`. Clicking the task body opens its Chat.
- Task Chat: the duplicate definition/cadence/actions card is absent. Existing automation messages and results remain owned by the durable chat history; the demo capture is empty only because the reset profile has no prior run.

The two full-view comparisons keep the controls legible, so a separate crop was not needed.

## Comparison history

1. User capture showed an ambiguous chat icon plus unlabeled play/edit icons, and hover styling split one row into two surfaces.
2. Replaced the mixed controls with persistent text-labelled actions and made the row hover treatment continuous.
3. User capture showed duplicated task definition above the same definition in chat history.
4. Removed the fixed Chat banner and captured the dedicated task Chat with only its title, conversation area, and follow-up composer.

## Primary interactions checked

- Opened the stable Scheduled tab in the native Electron harness.
- Verified the task body remains the dedicated Chat entry point.
- Verified Resume, Run now, and Edit task are separately focusable, labelled controls.
- Opened the task Chat and confirmed the duplicate top card is absent.
- Focused Scheduled component tests passed; renderer and main TypeScript checks passed.
- The disposable profile has no configured model, so a new live task run was not sent.

## Follow-up polish

- P3: if task rows become substantially denser, secondary actions can move into an overflow menu while keeping Run now visible.

final result: passed
