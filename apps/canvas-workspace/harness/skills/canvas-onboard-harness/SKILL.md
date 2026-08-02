---
name: canvas-onboard-harness
description: Verify the Canvas Workspace onboarding case with the local harness. Use when asked to open or test onboard/onboarding/first-run Canvas behavior, capture CDP screenshots, inspect onboarding text or layers, compare the current branch against expected onboarding content, and close the disposable session afterward.
---

# Canvas Onboard Harness

## Overview

Use this skill for the specific onboarding case. The goal is to open Canvas in a clean first-run state, verify what onboarding content the current build actually renders, capture screenshot evidence through CDP, and distinguish product regressions from harness or build issues.

Use a disposable `temp` profile by default. Onboarding seed logic usually runs only when the store is empty, so reuse of an old `HOME` can hide first-run behavior.

## Standard Check

Run from the repository root.

1. Build current code before testing unless the user explicitly wants the existing build:

```bash
pnpm --filter canvas-workspace build
```

2. Open the app directly at the onboarding target with a fresh harness session:

```bash
pnpm --filter canvas-workspace harness start --target onboard --profile temp --force --json
```

3. Confirm CDP and target state:

```bash
pnpm --filter canvas-workspace harness status --json
```

Expect `alive: true`, `cdpReady: true`, and a `Pulse Canvas` page target.

4. Read the renderer text before judging the screenshot:

```bash
pnpm --filter canvas-workspace harness eval-renderer "(() => { const text = document.body.innerText || ''; return { title: document.title, hasPersistentWorkspace: text.includes('Persistent workspace'), actions: [...document.querySelectorAll('.canvas-empty-action')].map((node) => node.textContent?.trim()), layerCount: document.querySelectorAll('[data-node-id]').length, sample: text.slice(0, 800) }; })()" --json
```

The current first-run contract is an empty `Pulse Canvas` workspace with zero
seeded nodes and three ordered actions: connect a project, write the brief,
and start a coding agent. Older branches may still seed tutorial nodes; treat
that as legacy behavior rather than the current expected state.

5. Capture screenshot evidence through CDP:

```bash
pnpm --filter canvas-workspace harness screenshot --json
```

The expected method is `cdp-captureScreenshot`. Save or report the absolute screenshot path from the JSON output.

6. Snapshot the accessible UI tree when the screenshot and expected content disagree:

```bash
pnpm --filter canvas-workspace harness snapshot-ui --json
```

Use this to confirm layer count, visible node titles, toolbar state, and whether content exists offscreen.

7. Close and clean up:

```bash
pnpm --filter canvas-workspace harness close --cleanup
```

## Failure Triage

- If CDP is not ready, inspect `status --json` and `logs --lines 120`.
- If screenshot succeeds but content is old, verify the branch and rebuild. A successful harness can reveal that the product code was reverted or not present in the current checkout.
- If the onboard target opens a non-empty welcome workspace on the current branch, rebuild and confirm that the disposable profile is fresh. Non-empty tutorial seeding is only expected on older branches.
- If the expected first-run workspace does not appear, check the current `HOME` and use a fresh `temp` profile; do not reuse an old seeded home.
- If the user asks to test real user data, use `clone` first. Use `real --allow-real-writes` only after explicit confirmation.

## Report Format

Report these items succinctly:

- whether the app opened and CDP was ready;
- what onboarding text or frame titles were detected;
- screenshot path and capture method;
- whether the result matches the expected branch state;
- whether the harness session was closed and cleaned.
