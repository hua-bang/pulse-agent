# Packaged CLI + skills tooling (`AgentToolingManager`)

Packaged builds bundle the existing `@pulse-coder/canvas-cli` under Electron
resources and install it as a versioned, self-contained payload into the
user's home directory, independent of any system Node or package manager.
Read this file before changing `src/main/files/agent-tooling-*`,
`src/main/files/skill-installer.ts`, `src/main/files/shell-path.ts`, or
anything that triggers a tooling install/repair/update.

## What gets installed, and where

On first launch and after app updates, the app idempotently installs:

- its versioned CLI files under `~/.pulse-coder/tooling/pulse-canvas/`
  (`toolingRoot()` in `src/main/files/agent-tooling-state.ts`:
  `join(installRoot, 'tooling', 'pulse-canvas')`, where `installRoot` is
  `~/.pulse-coder`);
- a no-system-Node wrapper under `~/.pulse-coder/bin/` (`unixWrapper`/
  `windowsWrapper` in `src/main/files/agent-tooling-files.ts` — a shell
  script or batch file that re-execs the packaged Electron host binary with
  `ELECTRON_RUN_AS_NODE=1`, so invoking the CLI never depends on a
  system-installed Node);
- all bundled skills into the Pulse/Codex/Claude global skill dirs
  (`SKILL_PARENT_DIRS` in `src/main/files/skill-installer.ts`:
  `~/.pulse-coder/skills`, `~/.claude/skills`, `~/.codex/skills`).

Treat the CLI + skills as one compatibility bundle: they are installed and,
on failure, rolled back together (see "Failure-atomic bundle activation"
below) — never ship a change that updates one without the other.

## Production installation must never depend on a source checkout

Development managers preserve a live canonical launcher owned by another
host: status validates its payload and executable without requiring the dev
Electron path, and repair/update/reconcile defer to the owning installed app.
Settings shows connection readiness first. Repair failures expose a short reason
and copyable diagnostics; versions and target checks are not rendered. Policy,
shell setup, updates, and legacy cleanup live in collapsed Advanced settings.

Production installation must never depend on a source checkout, `pnpm`, or a
global link. `resolveBundleRoot()` in `skill-installer.ts` enforces the
split: a packaged app (`app.isPackaged`) always resolves its bundle from
`process.resourcesPath` (`agent-tooling`); only an unpackaged dev run walks
upward from the app path looking for `pnpm-workspace.yaml` to find a source
checkout (`packages/canvas-cli`), and even that falls back to a bundled
`resources/agent-tooling` path if no checkout is found.

## Trigger points funnel through one shared manager

Keep startup, Settings repair, and experimental-trigger installs on the
shared `AgentToolingManager` (`createAgentToolingManager` in
`src/main/files/agent-tooling-manager.ts`). Concretely, three call sites feed
the same manager:

- **Startup**: `ensureAgentToolingAtStartup` (`skill-installer.ts`), called
  from `src/main/app/bootstrap.ts`, runs the `'reconcile'` action — but only
  when `app.isPackaged`. A packaged app treats first launch as its
  cross-platform install hook: macOS DMGs have no reliable post-install
  phase, so deployment happens here and repeats idempotently after every app
  update.
- **Settings repair**: the `skills:install` IPC handler calls `runInstall()`,
  which runs the `'repair'` action. The renderer's Settings → Agent section
  (`AgentSection.tsx`) defaults its install callback to this same `'repair'`
  action.
- **Experimental-trigger installs**: toggling the `agent-teams` experimental
  flag (`EXPERIMENTAL_FLAG_AGENT_TEAMS`) from off to on triggers a
  fire-and-forget `runInstall()` call from
  `src/main/settings/experimental-ipc.ts`'s `experimental:set` handler, so
  the bundled Canvas skills and CLI wrapper install/repair in the background
  as soon as the feature is enabled, without the user needing to separately
  visit the Agent repair button.

All three funnel into `createAgentToolingQueue`
(`src/main/files/agent-tooling-queue.ts`), a single-flight queue over
`AgentToolingManager.ensureInstalled({ action })`. Any new trigger must call
through this shared queue rather than `ensureInstalled` directly, or
concurrent triggers can race each other's installs.

## Update policy: `follow-app` (default) / `ask` / `pinned`

The persisted update policy under the tooling root
(`~/.pulse-coder/tooling/pulse-canvas/update-policy.json`, read/written by
`readUpdatePolicy`/`writeUpdatePolicy` in `agent-tooling-state.ts`) defaults
to following app updates (`'follow-app'`). `'ask'` and `'pinned'` retain the
active bundle until an explicit Settings update, while damage repair of that
active bundle remains automatic from its fingerprinted local payload cache
regardless of which policy is set — an `ask`/`pinned` policy opts out of
*upgrading* the active bundle, never out of *repairing* it back to what is
already active.

## Fingerprint-qualified, immutable runtime payload directories

Runtime payload directories are fingerprint-qualified and immutable across
updates, so a same-semver replacement cannot overwrite the CLI currently
referenced by the launcher. Concretely (`prepareCliPayload` in
`src/main/files/agent-tooling-deployment.ts`): each deployed bundle lives
under `<toolingRoot>/.cache/<fingerprint>/` and
`<toolingRoot>/.runtime/<fingerprint>/`, where `<fingerprint>` is a sha256
over the CLI entrypoint, every bundled skill's `SKILL.md`, and the paths and
contents of all `native/` payload files
(`fingerprintCliTree` in `agent-tooling-files.ts`). A new deployment writes a
new fingerprint directory instead of mutating an existing one, so the active
launcher keeps pointing at the fingerprint directory it was built against
until activation explicitly repoints it. `isBundleCurrent` validates a
fingerprint directory's on-disk marker (`BUNDLE_MARKER =
'.pulse-canvas-bundle.json'`) against a freshly recomputed fingerprint before
trusting that directory as the automatic-repair cache.

## Failure-atomic bundle activation

Bundle activation is failure-atomic: a skill, launcher, or active-state
write failure must restore the previously active set. `deployAgentTooling`
(`src/main/files/agent-tooling-deployment.ts`) snapshots the current
launcher wrapper and every skill file it is about to overwrite before
writing anything. If the wrapper write or the active-state write throws
after skills were already installed, the `catch` block restores the wrapper
snapshot, rolls back every snapshotted skill file, and restores the previous
`active.json` state (or clears it if there was none) — all via
`Promise.allSettled`, so one rollback failure does not block the others.

## Explicit shell-PATH setup is opt-in, never automatic

Settings may offer an explicit shell-PATH setup for zsh/bash/fish
(`configurePulseCanvasShellPath`/`inspectPulseCanvasShellPath` in
`src/main/files/shell-path.ts`, surfaced through the Settings UI). It
appends one marked `~/.pulse-coder/bin` entry (for example
`export PATH="$HOME/.pulse-coder/bin:$PATH"`, or `fish_add_path
"$HOME/.pulse-coder/bin"` for fish) only after a user click, never during
automatic install/update.

## Package workspace runtimes from fresh builds

Electron Builder packages the built `dist` entrypoints of workspace runtime
dependencies. Every `package:*` command must therefore run
`prepare:package`, which rebuilds `@pulse-coder/storage`, `pulse-coder-engine`,
`pulse-coder-agent-teams`, and the bundled Canvas CLI before Electron is
built. Skipping that preparation can ship an ignored, stale Engine `dist`
whose external imports no longer match current package metadata.

The packaged-tooling smoke imports the Engine entry directly from
`app.asar` with the packaged Electron runtime before launching the app. CI
runs that import preflight after building the macOS package, so a missing
runtime dependency fails with its exact module-resolution error instead of
surfacing later as a startup timeout.

## SQLite native runtime preparation

The CLI bundles the storage adapter and SQLite JavaScript, and carries native
bindings in `dist/native/<platform>-<arch>-<modules>.node`. The filename uses
the runtime's Node module ABI, not its major Node version. CLI `build` copies
and loads the installed Node binding; `prepare:agent-tooling` then runs
`scripts/setup/prepare-sqlite-native.mjs` to prepare Electron's separate ABI.
The Electron script copies the driver into a temporary directory before
rebuilding, smoke-loads the result in Electron, verifies the installed Node
binary did not change, and caches the result beneath the app's local
`node_modules/.cache/pulse-sqlite/`. It does not rebuild pnpm's shared driver.

The same preparation also replaces a dedicated `package-native/` staging
directory with only the current Electron ABI. Electron Builder copies that
single binding into `agent-tooling/canvas-cli/native/`; it does not package
the CLI's entire multi-ABI development tree. Development and standalone CLI
builds retain their Node binding and prepared Electron binding in `dist/native/`.
The app retains the SQLite JavaScript driver but excludes its `deps/`, `src/`,
and `build/` compilation trees, including the unused default Node binary.
Canvas and its managed CLI both use the explicit resource binding above;
a host that relies on the driver's default native lookup needs its own payload.

`resolveSqliteNativeBinding` in the CLI chooses only the matching ABI from
the bundled `native/` directory. An ordinary Node installation can fall back
to its installed `better-sqlite3` dependency. Electron cannot take that
fallback: a missing matching payload requires repair or another build.
Canvas main must explicitly pass the corresponding file beneath
`process.resourcesPath/agent-tooling/canvas-cli/native/` to the storage
factory in packaged builds; development uses the CLI's `dist/native/`.

Electron Builder has `npmRebuild: false`. The app's install and explicit
rebuild scripts run `scripts/setup/rebuild-native.mjs`, which uses
`electron-rebuild -f -o node-pty`; `-w` adds modules to the normal rebuild set
and would also overwrite SQLite's Node binary with the Electron ABI. When
Electron headers are unreachable it falls back to node-gyp inside node-pty only
(N-API, so the host-Node build loads in Electron). These build paths prepare the local runtime and
architecture; cross-platform native compilation is not established by this
workflow. The Electron Builder `beforePack` hook
(`scripts/setup/assert-packaged-native.mjs`) therefore refuses any target,
including `universal`, whose platform/arch differs from the single staged
binding, instead of emitting a package that quits at storage activation.
Native payloads are included in `extraResources` and the bundle
fingerprint, so missing or corrupt binaries trigger the existing repair path.

Electron Builder follows workspace links more broadly than package `files`.
The app therefore excludes the internal packages' source/tests, harness/docs,
build configuration, and TypeScript-only `.d.cts`/`.d.mts` declarations from
the installed artifact. Runtime `dist` entries and package export maps remain
available; packaged import and live CLI smoke checks validate that boundary.

## Key files

- `src/main/files/agent-tooling-manager.ts` — `AgentToolingManager` /
  `createAgentToolingManager`: `status()`, `ensureInstalled({ action })`,
  `setUpdatePolicy()`.
- `src/main/files/agent-tooling-state.ts` — `toolingRoot()`, and the
  update-policy / active-state read-write pair (`update-policy.json`,
  `active.json`).
- `src/main/files/agent-tooling-files.ts` — wrapper generation
  (`unixWrapper`/`windowsWrapper`), `fingerprintCliTree`,
  `isBundleCurrent`/`isLauncherCurrent`, `atomicWrite` (tmp-write + rename).
- `src/main/files/agent-tooling-deployment.ts` — `deployAgentTooling`
  (failure-atomic activation), `prepareCliPayload` (fingerprint cache/runtime
  directories), `installSkillsTransaction`.
- `src/main/files/agent-tooling-queue.ts` — `createAgentToolingQueue`, the
  single-flight action queue shared by every trigger.
- `src/main/files/skill-installer.ts` — `ensureAgentToolingAtStartup`,
  `resolveBundleRoot`, `SKILL_PARENT_DIRS`, and the `skills:*` IPC handlers
  (`install`, `update`, `status`, `configure-path`, `set-update-policy`,
  `cleanup-legacy`).
- `src/main/files/shell-path.ts` — shell-PATH inspect/configure helpers.
- `src/main/settings/experimental-ipc.ts` — the `agent-teams` flag's
  fire-and-forget install trigger.
- `src/renderer/src/modules/settings/internal/Settings/AgentSection.tsx`,
  `AgentShellPathCard.tsx` — Settings UI.
- `src/main/app/bootstrap.ts` — calls `ensureAgentToolingAtStartup` at
  startup.

## Bound checks

The `packaged-agent-tooling` rule in `harness/validate/validation.yaml`
binds this whole surface (manager, files, deployment, queue, state,
skill-installer, shell-path, and the Settings UI files above) to:

- quick/required: `pnpm --filter canvas-workspace exec vitest run
  src/main/files/agent-tooling-manager.test.ts
  src/main/files/agent-tooling-files.test.ts
  src/main/files/agent-tooling-queue.test.ts src/main/files/shell-path.test.ts
  src/main/__tests__/agent-tooling-package.test.ts
  scripts/setup/prepare-sqlite-native.test.mjs
  scripts/setup/assert-packaged-native.test.mjs`
- manual (release-level, actually packages the app): `pnpm --filter
  canvas-workspace package:mac:arm64 && node
  apps/canvas-workspace/harness/tools/smoke-packaged-agent-tooling.mjs`

## Child-process PATH contract

`src/main/shell-path.ts` — a GUI launch inherits a stripped PATH, and every child (agent `bash`, which the engine spawns with NO `env`, MCP stdio servers, the bundled CLI) takes `process.env` verbatim, so a missing binary surfaces as a bare "command not found". Repaired once in `bootstrap.ts` before any spawn: `augmentProcessPath()` (sync, well-known per-user bin dirs incl. `~/.pulse-coder/bin`) then a best-effort `applyLoginShellPath()` (async, timeout-bounded `$SHELL -ilc`, only ever widens). PTY env shares the same bin-dir list — do not fork a second copy. Tests: `src/main/__tests__/shell-path.test.ts`

Repo harness skills guide coding agents; src/main/agent/skills is the product runtime feature. The files/skill-installer boundary deploys the external pulse-canvas CLI and bundled skills through the same compatibility bundle.
