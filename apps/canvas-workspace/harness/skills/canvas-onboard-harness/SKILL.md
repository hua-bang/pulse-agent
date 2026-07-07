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
pnpm --filter canvas-workspace harness eval-renderer "(() => { const text = document.body.innerText || ''; return { title: document.title, hasWelcome: text.includes('Welcome to Pulse Canvas') || text.includes('欢迎使用 Pulse Canvas'), frames: ['01 ·','02 ·','03 ·','04 ·','05 ·'].every(n => text.includes(n)), layers: (text.match(/LAYERS\n(\d+)/) || [])[1], sample: text.slice(0, 800) }; })()" --json
```

Adjust the text probes to the expected onboarding for the current branch. The current seed is a five-frame course canvas (`01 · Welcome` … `05 · Power Workflow`, zh: `01 · 欢迎` … `05 · 进阶工作流`) with 30 nodes narrated by a guide character (Riley / 小舟); the welcome note keeps the stable id `node-welcome-note` and heading `Welcome to Pulse Canvas` / `欢迎使用 Pulse Canvas`. Older seed code shows only 3 nodes (welcome note, download iframe, detail note). Seed language follows `app.getLocale()` (zh → Chinese, otherwise English), so a headless Linux container normally renders the English content.

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
- If the onboard target opens a non-empty welcome workspace, that can be correct for branches that still seed welcome content.
- If the expected first-run workspace does not appear, check the current `HOME` and use a fresh `temp` profile; do not reuse an old seeded home.
- If the user asks to test real user data, use `clone` first. Use `real --allow-real-writes` only after explicit confirmation.

## Report Format

Report these items succinctly:

- whether the app opened and CDP was ready;
- what onboarding text or frame titles were detected;
- screenshot path and capture method;
- whether the result matches the expected branch state;
- whether the harness session was closed and cleaned.
