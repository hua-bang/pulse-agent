# Pulse Canvas Harness

The harness is an agent-friendly operating entrypoint around the real Electron
app. It launches Pulse Canvas with a controlled profile, keeps a current
harness session on disk, and lets follow-up commands observe or operate the
same running window without adding harness code to the Electron main process.

This is not a full e2e suite yet. It is the foundation for smoke checks,
debugging, screenshots, and later e2e scenarios.

## Quick Start

Build once, then start a demo session:

```bash
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace harness start --profile demo
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness snapshot-ui
pnpm --filter canvas-workspace harness close
```

You can also let the harness build before launch:

```bash
pnpm --filter canvas-workspace harness start --profile demo --build
```

To open the first-run onboard workspace directly:

```bash
pnpm --filter canvas-workspace harness start --target onboard
```

For an already-running harness session:

```bash
pnpm --filter canvas-workspace harness onboard
```

## Profiles

`temp`
: Fresh temporary `HOME`. Safe default for smoke checks.

`demo`
: Stable harness-owned `HOME` under `apps/canvas-workspace/.harness/demo-home`.
  The harness seeds a small demo workspace. Use `--reset` to recreate it.

`clone`
: Copies one real workspace into a temporary `HOME`.

```bash
pnpm --filter canvas-workspace harness start --profile clone --workspace ws-123
```

`real`
: Uses your real `HOME`. This can write to real Pulse Canvas data, so it
  requires explicit opt-in:

```bash
pnpm --filter canvas-workspace harness start --profile real --workspace ws-123 --allow-real-writes
```

## Headless Linux (CI / containers / cloud sandboxes)

Opt-in with `--headless`: the harness then spawns its own Xvfb, sets
`ELECTRON_DISABLE_SANDBOX=1` for the child, and reaps the Xvfb process on
`close`. This never happens implicitly — on a display-less Linux host,
`start` without the flag fails fast with a hint instead of spawning an X
server behind your back. Requirements on the host:

- `Xvfb` installed (debian/ubuntu: `apt-get install -y xvfb`)
- the Electron binary present — if the postinstall download was skipped or
  blocked (proxy, offline image), run:

```bash
pnpm --filter canvas-workspace setup:electron   # falls back to the npmmirror CDN
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace harness start --profile temp --headless
```

## Session Commands

The current session is recorded at:

```text
apps/canvas-workspace/.harness/current-session.json
```

Follow-up commands operate on that same Electron process:

```bash
pnpm --filter canvas-workspace harness status
pnpm --filter canvas-workspace harness onboard
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness screenshot --method system
pnpm --filter canvas-workspace harness screenshot --method cdp
pnpm --filter canvas-workspace harness click --text "Settings"
pnpm --filter canvas-workspace harness click --selector ".some-css-selector"
pnpm --filter canvas-workspace harness fill --selector "input[name=q]" "hello"
pnpm --filter canvas-workspace harness press "Meta+K"
pnpm --filter canvas-workspace harness eval-renderer "location.href"
pnpm --filter canvas-workspace harness logs
pnpm --filter canvas-workspace harness close
```

Screenshots, logs, and other run artifacts are written under:

```text
apps/canvas-workspace/.harness/runs/<session-id>/
```

## Experimental Flags

Flags are written to a per-run file and passed through
`PULSE_CANVAS_EXPERIMENTAL_FEATURES`.

```bash
pnpm --filter canvas-workspace harness start --profile demo --flag webview-page-control
```

There is also a shortcut:

```bash
pnpm --filter canvas-workspace harness start --profile demo --enable-webview-page-control
```

## Current Scope

The first version launches the real Electron app and controls the main renderer
through Electron's Chrome DevTools Protocol remote debugging port. Screenshots
default to CDP capture, then fall back to macOS window capture when CDP cannot
produce an image. It supports:

- start/status/close
- screenshot
- UI snapshot
- renderer evaluation
- click/fill/press
- log tailing
- temp/demo/clone/real profiles

Future layers can add app-specific state IPC, webview-node CDP commands,
fixture web servers, scenario scripts, and CI-friendly smoke runners.

## Code Layout

`cli.mjs`
: Thin executable entrypoint.

`src/launch.mjs`
: Starts Electron with the selected profile and CDP port.

`src/profiles.mjs`
: Builds temp, demo, clone, and real homes.

`src/session.mjs`
: Reads/writes the current harness session and closes it.

`src/cdp.mjs`, `src/renderer.mjs`, `src/navigation.mjs`, `src/input.mjs`
: Renderer observation and operation helpers.

`src/screenshot.mjs`
: External screenshot strategies.
