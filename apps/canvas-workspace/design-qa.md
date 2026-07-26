# Scheduled task chat — design QA

- Source visual truth: `/var/folders/47/8lvrntxs52xdcrv32zkfrwww0000gn/T/codex-clipboard-03b64e28-fc68-4a9a-b9a3-ba0bb533b8f2.png`
- Implementation screenshot: `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/runs/harness-2026-07-26T13-34-08-800Z/screenshot-1785072861101.png`
- Combined comparison: `/Users/jasperhu/project/pulse-agent/apps/canvas-workspace/.harness/runs/harness-2026-07-26T13-34-08-800Z/scheduled-reference-comparison.png`
- Source pixels: 2486 × 2146
- Implementation pixels: 2400 × 1544
- Implementation CSS viewport: 1200 × 772 at device scale factor 2
- Density normalization: both images were compared at their native pixels in one side-by-side canvas. The source has a taller crop, so vertical whitespace was not treated as a fidelity difference.
- State: task definition, completed assistant result, and persistent follow-up composer. The implementation uses a harness-seeded successful result because the disposable demo profile intentionally has no model credentials.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation keeps Pulse Canvas's existing monospace product typography rather than copying Codex's sans-serif typography. Hierarchy, readable line length, weights, wrapping, and truncation are coherent with the host app.
- Spacing and layout rhythm: the task definition, result, and composer follow the same vertical sequence as the source. The persistent Canvas sidebar is an intentional product-shell difference and leaves the conversation column readable.
- Colors and visual tokens: neutral task card, white conversation surface, blue primary state, borders, radii, and focus treatment all use existing Canvas tokens and components.
- Image quality and asset fidelity: no source imagery is required. Existing Pulse Canvas brand and Phosphor icons remain crisp at 2× density; no placeholder or handcrafted replacement assets were introduced.
- Copy and content: the automatic run records task name, ID, cadence, instructions, assistant result, and a task-specific follow-up placeholder. Canvas does not expose a filesystem “automation memory” line because continuity is stored as the task's Agent chat session instead.

Focused-region comparison was not needed after the full-view comparison: the only fidelity-critical region is the task card/result/composer column, and all text and controls are legible in the native-size combined image.

## Comparison history

1. Initial direct deep link rendered the task definition without its component stylesheet. The empty conversation also showed Canvas quick actions and the generic “Ask about this canvas” placeholder. The cadence dropdown opened over the modal actions.
2. Fixed the direct-route stylesheet import, suppressed unrelated empty-state actions, added a task-specific follow-up placeholder, and opened the cadence menu upward.
3. Captured the post-run state with an automation message, assistant result, and follow-up composer. No P0/P1/P2 issue remained in the combined comparison.

## Primary interactions checked

- Opened the stable Scheduled sidebar tab.
- Created a user task with the minimum 30-minute cadence.
- Opened the task's dedicated Chat route.
- Verified the completed result is restored from the isolated task session.
- Focused the composer and entered a follow-up message.
- Checked application logs; no renderer or main-process error was reported. Sending a live follow-up was not attempted because the disposable harness profile has no configured model.

## Follow-up polish

- P3: a future task-details menu could move pause/edit controls out of the task definition card after the first successful run, matching the source's quieter header.

final result: passed
