---
name: extend-blessed-ui
description: Use when adding a component/hook to the blessed components/ui/ set or migrating feature code onto it. Encodes the ratchet-interaction landmines learned across four expansion rounds. Deliberately contains ZERO baseline numbers — live values live in the governance test's own comments.
---

# Extend the Blessed UI Set

Thin by design: the procedure and five landmines only. The current counters, baselines, and their histories live in `src/main/__tests__/ui-reuse-governance.test.ts`'s comments (that file is the SSOT — it churns often, so numbers written here would rot); the blessed-set inventory lives in `harness/knowledge/conventions/frontend.md`.

## Procedure

1. Build the piece in `components/ui/<Name>/` matching the set's style: `ui-*` class prefix, JSDoc stating exactly which element `className` lands on, tokens for radius/colors/shadows (all three are gated), canonical hooks only (no hand-rolled ESC/click-outside/keydown), barrel export in `ui/index.ts`.
2. Migrate at least one exemplar caller (proves the API; moves the ratchet).
3. Write behavioral tests in `ui/__tests__/` (happy-dom pragma + createRoot/act pattern — copy a sibling). Every prior piece has them; don't be the exception.
4. Run `pnpm --filter canvas-workspace test`, read the governance failures, and update baselines per the landmines below — in the SAME commit.
5. Update `conventions/frontend.md`'s blessed list + do-NOT-hand-roll list.

## The five landmines

1. **The ratchet fails in BOTH directions.** Improving a counter without lowering its baseline fails CI just like growth does — wins must be locked in the same PR. Read the failure message; it tells you which way to move.
2. **Your new ui/ piece counts against the counter it drains.** A ui/Button contains a `<button>`; a ui/TextField contains an `<input>`; a portal-using shell adds a `createPortal` file. Expect +1 from the blessed piece itself and plan an exemplar migration to offset it — or record the reason if net-positive is genuinely right.
3. **Shells can flatten their own cost.** When a new shell would raise a counter (its own portal/element), check whether routing it through an existing blessed primitive keeps the count flat — ui/Modal and ui/Drawer render through ui/Portal instead of calling createPortal themselves precisely for this.
4. **Tag counters are comment-stripped and test-files are excluded.** Doc prose mentioning `<button>` doesn't count; test harnesses may use natural markup. Don't contort code to dodge a counter — if a count seems wrong, check these two filters before touching baselines.
5. **Canonical primitives are exempt from the keydown counter by an explicit allowlist** (in the test). If you add a new blessed KEYBOARD hook, add its file to that allowlist — otherwise the blessed implementation itself inflates the number it exists to reduce.

## Done when

Piece + tests + exemplar in; every moved counter's baseline updated same-commit with a one-line cause in the test's comment trail; conventions list updated; `typecheck` + full renderer suite + governance test green.
