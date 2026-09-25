---
name: canvas-harness
description: Use the Canvas Workspace harness in apps/canvas-workspace to launch the real Electron app with controlled profiles, inspect the renderer through CDP, capture screenshots, operate UI controls, collect logs, and clean up sessions. Use for Canvas smoke checks, visual verification, debugging, and agent-operated app validation.
---

# Canvas Harness

## Overview

Use the harness as the default agent-facing entrypoint for operating `apps/canvas-workspace`. It wraps the real Electron app without adding harness code to the main process, starts it with a controlled `HOME`, exposes Chrome DevTools Protocol operations, and writes artifacts under `apps/canvas-workspace/.harness/runs/<session-id>/`.

Prefer this over `dev:temp-home` when the task needs repeatable launch, renderer inspection, screenshots, UI actions, logs, or cleanup.

## Quick start (default entry, including fresh cloud containers)

```bash
pnpm --filter canvas-workspace harness:up           # dev mode (default): ~19s to a settled UI
pnpm --filter canvas-workspace harness:up --built   # production bundle: +~67s app build when stale
pnpm --filter canvas-workspace harness:down         # close session + stop mock LLM
```

Dev mode runs `electron-vite dev --watch` behind the same CDP session:
renderer edits hot-update in place (~2s, no page reload), and main/preload
edits rebuild and restart Electron (~12s) on the same CDP port, so
harness commands keep working without re-running `harness:up`. Use `--built`
for performance, bundle, or packaging-sensitive checks; it rebuilds the app
after a dev session because dev writes dev bundles into `dist/main` and
`dist/preload`. Engine/agent-teams/canvas-cli are consumed from their `dist`,
so after editing them, re-run `harness:up` (it rebuilds the stale chain).

`harness:up` is idempotent and skips satisfied steps: apt-installs Xvfb/certutil
when root on display-less Linux, runs `pnpm install` when dependencies, the
Electron binary, or node-pty are missing, rebuilds stale workspace packages
(storage → engine → agent-teams → canvas-cli) plus canvas-cli's Electron SQLite
binding (`prepare-sqlite-native.mjs`, GitHub prebuild when Electron headers
are blocked),
starts `harness/mock-llm.mjs` unless a model key is set, then runs `start`
with `--headless` (Linux without DISPLAY or as root) and `--ca-cert` (behind
an HTTPS proxy, reusing NODE_EXTRA_CA_CERTS). It returns once first-paint
content has settled (see `start` readiness below), so an immediate screenshot is
complete. A fresh container costs about 2-4 minutes more for
dependency download. Defaults to profile `demo`; `--profile`, `--no-mock-llm`,
`--no-ca`, `--skip-build`, and other `start` options (for example
`--route /chat`) pass through. Then continue with steps 4-7 below.

## Workflow

Run from the repository root unless the user asks otherwise. Use this manual
sequence when you need control that `harness:up` does not expose.

1. Build before launch when code changed or `dist/` may be stale:

```bash
pnpm --filter canvas-workspace build
```

2. Start a session. Use `temp` for safe first-run checks, `demo` for a stable harness-owned fixture, `clone` to copy a real workspace into a disposable home, and `real` only when the user explicitly wants real data writes.

```bash
pnpm --filter canvas-workspace harness start --profile temp --force --json
pnpm --filter canvas-workspace harness start --profile demo --reset --force --json
pnpm --filter canvas-workspace harness start --profile clone --workspace <workspace-id> --force --json
pnpm --filter canvas-workspace harness start --profile real --workspace <workspace-id> --allow-real-writes --force --json
```

3. Confirm the app is alive and CDP is ready:

```bash
pnpm --filter canvas-workspace harness status --json
```

4. Observe or operate the UI:

```bash
pnpm --filter canvas-workspace harness snapshot-ui --json
pnpm --filter canvas-workspace harness eval-renderer "document.body.innerText"
pnpm --filter canvas-workspace harness click --text "Settings"
pnpm --filter canvas-workspace harness click --selector ".some-selector"
pnpm --filter canvas-workspace harness fill --selector "input[name=q]" "hello"
pnpm --filter canvas-workspace harness press "Escape"
```

5. Capture visual evidence. Let `auto` use CDP first; only force `system` when CDP cannot capture the page and macOS screenshot permissions are acceptable.

```bash
pnpm --filter canvas-workspace harness screenshot --json
pnpm --filter canvas-workspace harness screenshot --method cdp --json
```

A successful screenshot command only proves that an image was written. Before
accepting, uploading, or sharing it, open or analyze that exact file and verify:

- the intended app, workspace, Dock tab, component, and interaction state are visible;
- the image contains enough surrounding context to identify what it demonstrates;
- icons retain their intended size and hit area rather than appearing compressed;
- spacing, text truncation, overlap, clipping, popover placement, and overflow are
  visually acceptable at the tested width;
- no unrelated page, stale build, tooltip-only state, or hidden target was captured.

If the image is wrong or reveals a visual defect, correct the app state or UI and
capture it again. Keep claims narrower than the evidence: an entry-point screenshot
does not prove a complete create/rename/delete workflow, and behavior or filesystem
claims still require corresponding runtime assertions. Before publishing externally,
check for sensitive information, verify the uploaded URL, and describe only what is
actually visible.

6. Collect logs when startup, navigation, or rendering looks wrong:

```bash
pnpm --filter canvas-workspace harness logs --lines 120
```

7. Always close disposable sessions when finished:

```bash
pnpm --filter canvas-workspace harness close --cleanup
```

## Profiles

- `temp`: fresh temporary `HOME`; safest default for smoke checks and first-run behavior.
- `demo`: stable harness-owned home under `.harness/demo-home`; use `--reset` to recreate.
- `clone`: copies one real workspace into a temporary `HOME`; use when debugging user data without mutating it.
- `real`: uses the user real `HOME`; require `--allow-real-writes` and mention the risk before use.

## Interpretation Rules

- Treat CDP readiness and screenshot success as harness health signals.
- Treat visible content as product state. If the screenshot shows an old onboarding or different workspace, first check whether the current branch or built output actually contains the expected product change.
- If `dist/` is missing or stale, rebuild or start with `--build`.
- If a session is already running, use `--force` to replace it or `close --cleanup` to stop it.
- `start` returns after React replaces the boot splash and first-paint content settles (lazy node bodies, file previews, chat history, webview loads; `src/readiness.mjs`). Settling is best effort: after 15s it warns with what is still pending instead of failing.
- Relative `--output` / `--ca-cert` paths resolve from where you ran pnpm (`INIT_CWD`), not the app directory.
- Do not leave temporary sessions running after a verification task.
