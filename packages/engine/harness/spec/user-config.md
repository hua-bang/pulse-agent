# Spec: declarative user-config — implement or delete

**Current state.** The engine has a full-looking declarative user-config pipeline: `PluginManager` scans `.pulse-coder/config` / `.coder/config` (and home equivalents) for `config.{json,yaml,yml}` and `*.config.{json,yaml,yml}`, parses each file, and calls `applyUserConfig()` on it (`src/plugin/PluginManager.ts:255-268`). But `applyUserConfig` (`:335-375`) is an **inert stub**: for `config.tools`, `config.mcp.servers`, `config.subAgents`, and `config.skills` it only emits `logger.debug(...)` and then `this.userConfigPlugins.push(config)`. It never creates a tool, registers an MCP server, or wires a sub-agent. The in-source comment says so in future tense — `// 这里将根据配置创建具体工具实例` ("here it *will* create the concrete tool instance"). A user who writes a `config.json` gets log lines and no behavior. (This is why `knowledge/plugin-system.md` marks declarative user-config as INERT.)

**Open question.** Is declarative user-config a planned feature (implement `applyUserConfig` so config files actually configure tools/MCP/sub-agents/skills), or an abandoned direction (delete the scan + loader + stub, since the working config paths are `.pulse-coder/mcp.json`, `.pulse-coder/agents/`, `.pulse-coder/skills/`, and their real loaders)?

**Why it needs a decision.** The stub is worse than nothing on two fronts:
- **User-facing false affordance.** The scan runs on every Engine construction and logs `Loaded user config: <name>` at `info`, so a config file *appears* to take effect. A user reasonably concludes their `config.json` is live when it changes nothing — a silent-no-op contract.
- **Security surface for zero benefit.** The loader `await import('yaml')` / `JSON.parse`es any matching file under scanned dirs (including `~/.coder/config`) on every build. It parses attacker-plantable files (see `knowledge/security-posture.md`, auto-loaded disk surfaces) to produce a debug log. The cost is real; the value is zero until implemented.

Leaving it half-built keeps both costs indefinitely. The decision is binary — finish it or remove it — and it is a judgement call about product direction, not a bug, which is why it is a spec and not a `known-defects.md` line.

**Verification.** Confirmed against source on the working branch (2026-07-07): scan/apply call site `PluginManager.ts:266-269`; stub body `PluginManager.ts:335-375` (debug-only, no registration); loader `loadUserConfigFile` `:305-323`.
