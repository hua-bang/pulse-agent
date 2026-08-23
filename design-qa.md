# Agent Plugins Market Design QA

Result: passed on 2026-08-23.

## Product decision

The Codex reference supplies the information architecture: Plugins and Skills tabs, Installed strip, Public and Personal views, grouped two-column rows, search, refresh, settings and Add actions. The implementation keeps Pulse Canvas's own mono typography, blue interaction color, route gutters, buttons, fields, modal, dropdown, borders and sidebar rather than copying Codex's skin.

The launch catalog uses actual source brand artwork for Exa, TranscriptAPI, Arcade, Resend, OpnForm and Mobbin. Brand images have a neutral framed treatment and a fallback glyph, so missing artwork cannot break the list.

## Real Electron evidence

- Full desktop market: `apps/canvas-workspace/.harness/runs/harness-2026-08-23T14-43-06-107Z/screenshot-1787496192762.png`
- Narrow single-column layout: `apps/canvas-workspace/.harness/runs/harness-2026-08-23T14-43-06-107Z/screenshot-1787496200263.png`
- Narrow Add menu: `apps/canvas-workspace/.harness/runs/harness-2026-08-23T14-43-06-107Z/screenshot-1787496219550.png`
- Installed Exa detail: `apps/canvas-workspace/.harness/runs/harness-2026-08-23T14-43-06-107Z/screenshot-1787496246134.png`

The isolated demo run installed Exa from its public Git repository. The Installed strip and list state updated, the details view showed its license, two skills, one MCP server and required connection state, and both Exa skills appeared on the existing Skills tab. The generated MCP config preserved Exa's public source header and marked the server for client-managed OAuth.

## Findings

- Desktop and narrow layouts retain readable hierarchy with no horizontal overflow; the catalog becomes a single column below 980px.
- Plugins and Skills share the same top-level segmented navigation and remain visually part of one product.
- Install, Details, Connect and Uninstall are separate states. Installing a package does not falsely imply its remote account is connected.
- No P0, P1 or P2 visual issue remained in the inspected states.
