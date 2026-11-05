---
name: create-canvas-plugin
description: Build or change a Pulse Canvas plugin from outside the app (a sidebar page, a tool panel, a reader, a dashboard, or a canvas node) and install it with the pulse-canvas CLI. Use when the user asks to make, generate, or change a Pulse Canvas plugin, e.g. "做一个 Pulse Canvas 插件", "build a canvas plugin".
canvas-agent: false
---

# Create a Pulse Canvas plugin

This version is for coding agents outside Pulse Canvas (Claude Code, Codex). The Canvas Agent inside the app has its own copy. Pulse Canvas must be running.

1. Run `pulse-canvas plugin guide` and follow it. It is the app's current plugin guide: folder layout, `plugin.json`, renderer and main APIs, and rules. Do not write a plugin from memory; the APIs change.
2. Write the plugin folder. Default location: `~/.pulse-coder/canvas-plugins/<name>/`.
3. Run `pulse-canvas plugin install <dir>`. Read the JSON report.
   - `ok: false`: fix every `error` diagnostic and install again.
   - Follow `nextStep`. When `nativeEnabled` is false, tell the user to enable the plugin on the Plugins page in Pulse Canvas. You cannot enable plugin code yourself.
4. After every later change to the files, run `pulse-canvas plugin install <dir>` again. An enabled plugin reloads in the open app at once.

Never claim the plugin works before the user has enabled it and seen the page.
