---
name: add-builtin-main-plugin
description: Use when adding a built-in main-process canvas plugin (the channel / dynamic-app / webview-page-control shape) — especially one gated by an experimental flag. Covers the registration points and the flag-timing landmine that has been copy-pasted three times instead of documented.
---

# Add a Built-in Main Plugin

An ordered procedure. Sequence + landmines only; read the three existing plugins for working precedent (`src/plugins/main/channel/`, `dynamic-app/`, `webview-page-control/`).

## Steps

1. **Implement `MainCanvasPlugin`** (`src/plugins/types.ts`) in a new `src/plugins/main/<name>/index.ts`. If the plugin registers node capabilities, that contract is `harness/knowledge/plugin-node-mf2.md`; this skill is about the PLUGIN shell, not the node contract.

2. **Register in `BUILT_IN_MAIN_PLUGINS`** (`src/plugins/main/built-in.ts`) — the array is the activation list; not being in it means the plugin never runs.

3. **THE flag-timing landmine (the reason this skill exists).** If the plugin is gated by an experimental flag via `enabledWhen`, that predicate runs at plugin REGISTRATION time in the main process — **before the renderer exists**, so it cannot round-trip through IPC. It must read the persisted flags file synchronously from disk. All three existing plugins carry the identical hand-copied warning comment about this (`channel/index.ts`, `dynamic-app/index.ts`, `webview-page-control/index.ts` — the same lesson was re-learned three times, which is why it now lives here). Copy the sync-read helper pattern from any of them; do NOT invent an async/IPC-based gate — it will race the registration.

4. **Add the flag to the registry** in `src/shared/experimental-features.ts` — that file's own header JSDoc is the complete runbook for the flag side (registry entry, persisted path, reload-to-apply). Do not duplicate its content anywhere.

5. **Inert-by-default posture.** Follow the channel plugin's precedent (`AGENTS.md` Local Constraints): a built-in plugin that talks to external services should be inert unless its flag AND its config are both present. Credentials live in local settings/env, never in source — and note the secrets landmine: `channel/config.ts` and `settings/built-in-tools-config.ts` currently each carry their own encrypt/decrypt with the same Electron-safeStorage/Keychain workaround; if you need secret storage, reuse one of those rather than writing a third copy (extract a shared helper if you're the third consumer — rule of three).

6. **Verify.** `pnpm --filter canvas-workspace typecheck && pnpm --filter canvas-workspace test`; if the plugin registers agent-visible tools, also re-run `describe-canvas.mjs` (registry + name collisions).

## Done when

Plugin in the array; flag in the registry; `enabledWhen` reads flags synchronously (no IPC); inert without flag+config; secrets (if any) reuse an existing helper; checks green.
