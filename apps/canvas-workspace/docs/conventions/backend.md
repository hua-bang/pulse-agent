# Backend (Main Process) Conventions

Applies to `src/main/**` (and `src/plugins/main/**`). This is the privileged
Electron main process. See [`architecture-boundaries.md`](./architecture-boundaries.md)
for import rules and `docs/main-domain-modules.md` for the full module map.

## Domain modules

`src/main` is organized by **product domain**, not by technical layer:

```
src/main/
  index.ts            # main entry / bootstrap wiring
  app/                # Electron lifecycle: window, protocol, link-policy, logging, menu, updates
  agent/              # Canvas Agent (engine-backed chat): service, ipc, sessions, context, model
  agent-teams/        # Multi-agent teams integration (pulse-coder-agent-teams)
  artifacts/          # Artifact persistence + IPC
  canvas/             # Canvas persistence: store, storage, migration, broadcast, welcome workspace
  files/              # File read/write/dialog IPC + filesystem watcher
  generation/         # HTML generation + streaming IPC
  runtime/            # Runtime control server, MCP helpers
  settings/           # App/model/plugin settings persistence + IPC
  terminal/           # node-pty session management
  webview/            # Embedded webview registry, CDP helpers, page reader
```

Rules:

- **Prefer domain folders** over `services/`, `utils/`, or a global `ipc/`
  bucket. Create a shared folder only when a file is genuinely cross-domain.
- **Keep IPC handlers inside the domain they expose** (`<domain>/ipc.ts`).
- **Keep app-lifecycle code (`app/`) separate** from product capability domains.

## Typical files per domain

| File | Responsibility |
|------|----------------|
| `service.ts` | Core logic, usually a class (e.g. `CanvasAgentService`) |
| `ipc.ts` | `ipcMain.handle`/`on` registrations for the domain's channels |
| `store.ts` / `storage.ts` | In-memory state and on-disk persistence |
| `types.ts` | Domain-internal types (cross-process contracts go in `src/shared/*`) |

## IPC conventions

- **Channel names are namespaced `domain:action`**, kebab inside segments —
  e.g. `canvas-agent:chat`, `canvas-agent:abort`, `canvas-agent:status`.
- **Streaming** uses a fast `invoke` that returns `{ ok, sessionId }`, then
  pushes events on **per-session channels suffixed with the id**:
  `canvas-agent:text-delta:{sessionId}`, `:tool-call:{sessionId}`,
  `:chat-complete:{sessionId}`, `:clarify-request:{sessionId}`, etc.
- **Document the channel surface** in a header comment at the top of `ipc.ts`
  (see `src/main/agent/ipc.ts` for the canonical example).
- **Channel names and payload shapes are a public contract** with preload +
  renderer. Preserve them across refactors; when you change one, update the
  matching `src/preload/bridge/<domain>.ts` and renderer types in lockstep.

## Services & lifecycle

- Expose domain services via a **lazy singleton accessor**
  (`let service: Foo | null; export function getFoo() { ... }`), not a
  module-level instance constructed at import time.
- Persist per-workspace/session state under the user data dir (e.g.
  `~/.pulse-coder/canvas/**`); never write into the repo tree at runtime.
- Route aborts/clarifications back to the correct instance via explicit maps
  (e.g. `sessionScopeMap`) rather than global mutable state.

## Preload bridge

`src/preload/bridge/<domain>.ts` is the **only** place IPC channels are mapped to
the renderer-facing API. Bridge modules:

- are thin: `ipcRenderer.invoke(channel, payload)` for calls, and a `subscribe`
  helper for events that returns an unsubscribe function;
- must **not** import `main` or `renderer` implementation (only shared/contract
  types — currently `renderer/src/types` via the documented allowlist, pending
  migration to `src/shared/*`).

## Tests

- Domain tests live in `src/main/__tests__/` on **vitest**
  (`pnpm --filter canvas-workspace test`).
- The boundary and file-size governance suites also live here and gate CI — keep
  them green.
