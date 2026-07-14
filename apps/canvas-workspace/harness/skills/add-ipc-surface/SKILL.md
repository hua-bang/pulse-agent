---
name: add-ipc-surface
description: Use when adding or extending a capability that spans main + preload + renderer (a new IPC domain or new channels on an existing one). Covers the shared-contract placement trap, the per-file boundary allowlist, the streaming pattern, the bootstrap wire describe-canvas cannot see, and the lockstep rename rule.
---

# Add a Cross-Process IPC Surface

An ordered procedure. Gives the SEQUENCE and the landmines; FACTS live in the
sources it points to — do not restate them here. The `artifacts` domain is the
cleanest complete worked example of the whole chain: `src/shared/artifacts.ts`
→ `src/main/artifacts/{store,ipc}.ts` → `src/preload/bridge/artifacts.ts` →
renderer via `window.canvasWorkspace.artifacts`.

## Steps

1. **Snapshot the contract first.** `node harness/tools/describe-canvas.mjs`
   (from the app dir) — the IPC section is your baseline; re-run at the end
   and the diff is exactly the contract surface you added.

2. **Contract before implementation.** Put the JSON-safe data shapes in
   `src/shared/<domain>.ts` (runtime-neutral: no Electron/Node/process
   imports — `architecture-boundaries.md` rules are test-enforced). Defining
   the promise-returning Api interface up front lets main, preload, and
   renderer be written independently against it.

3. **THE PLACEMENT TRAP — where the Api interface goes.** Existing Api
   interfaces (e.g. `ArtifactsApi`) live in `src/renderer/src/types/<domain>.ts`
   and preload imports them through a **per-file** allowlist in
   `import-boundaries.test.ts` (`ALLOWED_PRELOAD_BOUNDARY_IMPORTS`, one entry
   per bridge file). Do NOT copy that: a NEW bridge file importing
   `../../renderer/src/types` fails the boundary test, and adding an
   allowlist entry moves against the migration the test itself documents.
   For a new domain, define the Api interface in `src/shared/<domain>.ts`
   next to the data shapes, import it in the bridge from there
   (preload→shared is legal), and re-export it from the
   `src/renderer/src/types.ts` barrel for renderer consumers. No bridge does
   this yet — you are creating the copy-reference. (Extending an EXISTING
   domain through its existing files is fine; its allowlist entry already
   covers it.)

4. **Main side: domain folder + documented channel surface.**
   `src/main/<domain>/` with `ipc.ts` (all `ipcMain.handle` for the domain)
   plus `service.ts`/`store.ts` (lazy singleton accessor, not a module-level
   instance — `conventions/backend.md`). Channel names are `domain:action`.
   List every channel in a header comment at the top of `ipc.ts` —
   `src/main/agent/ipc.ts` is the canonical example.

5. **Streaming has a fixed pattern — don't invent one.** Fast `invoke`
   returns `{ ok, sessionId }`; events push on channels suffixed with the id
   (`canvas-agent:text-delta:{sessionId}`); aborts/answers route back through
   an explicit map (`sessionScopeMap` in `src/main/agent/ipc.ts`). NOTE:
   describe-canvas skips dynamic channel names entirely, so per-session
   channels are invisible to the parity check — the `ipc.ts` header comment
   is their ONLY registry. Document them there or they exist nowhere.

6. **Wire the bootstrap — describe-canvas CANNOT catch this.** Register the
   domain's ipc setup in `src/main/app/bootstrap.ts` (see `setupArtifactIpc`
   there). describe-canvas scans source statically: an `ipc.ts` whose setup
   function is never called still shows green handle↔invoke parity while
   being dead at runtime. The bootstrap call is on you; prove it live if in
   doubt (`harness/skills/canvas-harness/SKILL.md`).

7. **Preload: thin bridge only.** `src/preload/bridge/<domain>.ts` exporting
   `create<Domain>Api(ipcRenderer)` — one-line `invoke` per call, events via
   `subscribe` from `bridge/ipc.ts` (returns an `Unsubscribe`; renderer calls
   it in effect cleanup). Add the field to the `canvasWorkspace` object in
   `src/preload/index.ts` and to `CanvasWorkspaceApi`
   (`src/renderer/src/types/workspace-api.ts`). No logic in the bridge —
   policy stays in main.

8. **Renderer consumes `window.canvasWorkspace` only.** Never import
   main/preload/Electron from renderer code (test-enforced).

9. **Channel names and payload shapes are a compatibility contract.**
   `harness/knowledge/main-domain-modules.md` Compatibility Rules: renaming
   an existing channel or reshaping its payload is a breaking change
   requiring main + preload + renderer in lockstep — during refactors move
   files first with names intact, split after green.

10. **Verify.** Re-run describe-canvas (invoke↔handle parity, exit 1 on a
    broken invoke); `pnpm --filter canvas-workspace typecheck && pnpm
    --filter canvas-workspace test` (boundary + file-size governance run
    here; new files ≤ 500 lines, aim ≤ 300).

## Done when

describe-canvas shows exactly the intended new channels and no broken
invokes; new contracts live in `src/shared/` with no new boundary-allowlist
entries; the `ipc.ts` header comment lists every channel including dynamic
ones; the bootstrap wire exists; typecheck + test green.
