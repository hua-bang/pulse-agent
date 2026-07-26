# Scheduled task controls — design QA

- Source visual truth: the two annotated Scheduled screenshots supplied with this task (`codex-clipboard-115a…png` and `codex-clipboard-080a…png`).
- Implementation screenshots: `docs/design-qa-assets/scheduled-controls-list.png` (list) and `docs/design-qa-assets/scheduled-controls-chat.png` (Chat).
- Full-view comparisons: `docs/design-qa-assets/scheduled-controls-list-comparison.png` and `docs/design-qa-assets/scheduled-controls-chat-comparison.png`.
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

---

# Scheduled run feedback and dock-responsive rows — design QA

- Source visual truth: the annotated follow-up screenshot `codex-clipboard-54a8…png`.
- Implementation capture: native Electron harness session `harness-2026-07-26T14-59-06-100Z`, at a 1200 × 772 CSS viewport and 2× device scale.
- Review method: the source and implementation captures were normalized to the same height and inspected in one side-by-side comparison.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- Opening Pulse AI now switches the Scheduled list to a dock-aware compact row layout. Task metadata stays with the task body and the labelled actions move onto their own line, so controls no longer overlap.
- Run now immediately disables itself and changes to a spinning `Running…` state, preventing duplicate launches.
- The scheduled Pulse AI conversation shows a running status strip until the background turn finishes. A failed run exposes its error in the same location and through the existing app notification.
- While a run is pending, the message stream also shows a lightweight Pulse AI reply with animated dots and explicit progress copy in the spot where the result will appear.
- When the run finishes, the conversation remounts from durable scheduled history so the result and follow-up composer are visible.
- The implementation reuses the shared spinner keyframe, design tokens, Button component, and Phosphor icons.

## Primary interactions checked

- Seeded two tasks in the disposable demo profile and opened Scheduled.
- Clicked Run now and confirmed the right-dock Pulse AI tab opened a fresh scheduled conversation.
- Confirmed the narrow Scheduled list kept both task rows and all actions readable with no overlap.
- Confirmed the in-conversation progress reply remains aligned with ordinary assistant messages and disappears when the pending state ends.
- Confirmed the completed turn appeared in Pulse AI and remained available for follow-up.
- Focused Scheduled/service/governance tests, TypeScript checks, and the production build passed.

final result: passed

---

# Scheduled Pulse AI handoff and prompt generation — design QA

- Source visual truth: the two annotated screenshots supplied for the follow-up (`codex-clipboard-a141…png` and `codex-clipboard-4435…png`).
- Implementation screenshots: `docs/design-qa-assets/scheduled-pulse-ai-list.png` (Scheduled list), `docs/design-qa-assets/scheduled-pulse-ai-editor.png` (task editor), and `docs/design-qa-assets/scheduled-pulse-ai-run-now.png` (Run now in Pulse AI).
- Combined comparisons: `docs/design-qa-assets/scheduled-pulse-ai-list-comparison.png` and `docs/design-qa-assets/scheduled-pulse-ai-editor-comparison.png`.
- Implementation CSS viewport: 1200 × 772 at device scale factor 2.

## Findings

No actionable P0, P1, or P2 visual differences remain.

- The redundant bottom-right Pulse AI launcher is no longer rendered on Scheduled; Pulse AI remains available through Run now.
- Run now expands the existing right-dock Pulse AI tab and displays the scheduled task's dedicated conversation rather than navigating to a second chat page.
- The editor preserves the existing field rhythm. `Write with AI` sits on the Instructions label row, uses the shared Button and Phosphor Sparkle icon, and keeps generated copy editable.
- Empty task name/instructions correctly disables AI generation and Save; generated text is returned to the existing textarea.
- No new image assets, custom SVGs, color values, or radius values were introduced.

## Primary interactions checked

- Opened Scheduled in the native Electron harness and confirmed the floating launcher is absent.
- Opened Create task and confirmed AI generation is discoverable without increasing modal width.
- Clicked Run now and confirmed Pulse AI opens as a dock tab with the scheduled task prompt, result, session controls, and follow-up composer.
- Focused Scheduled/RightDock tests, renderer/main TypeScript checks, and the production build passed.

final result: passed
