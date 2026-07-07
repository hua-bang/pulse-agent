# Engine Architecture

This file records current implementation facts for `pulse-coder-engine`. It is a map for changes, not a full design document.

## Module Map

| Area | Files | Owns |
|---|---|---|
| Public entry | `src/index.ts` | Package exports and public type surface. |
| Engine bootstrap | `src/Engine.ts` | Options, plugin initialization, tool merge order, provider/model resolution, run/compact helpers. |
| Runtime loop | `src/core/loop.ts` | Streaming, tool execution, hooks, retries, aborts, timeouts, compaction events. |
| Context | `src/context/` | Compaction strategy and message shaping. |
| AI adapter | `src/ai/` | AI SDK wrapper, provider options, tool context injection. |
| Config | `src/config/` | Provider construction, env fallback order, runtime constants. |
| Plugin system | `src/plugin/` | Engine plugins, user config plugins, dependency order, hooks, services. |
| Built-in plugins | `src/built-in/` | MCP, skills, tool search, plan mode, task tracking, sub-agents, agent teams, role soul, PTC. |
| Built-in tools | `src/tools/` | File, shell, Tavily, image, clarification, and deferred demo tools. |

## Initialization Flow

1. `new Engine(options)` creates a `PluginManager`.
2. `initialize()` prepares built-in plugins unless `disableBuiltInPlugins` is true.
3. Engine plugins are loaded by dependency order.
4. User config plugins are loaded after engine plugins.
5. Built-in tools and plugin tools are merged.
6. `EngineOptions.tools` are merged last and can override earlier tools.

## Run Flow

1. `Engine.run()` collects plugin hooks and legacy tool hooks.
2. `loop()` may compact context before the LLM call.
3. `beforeRun` and `beforeLLMCall` hooks can adjust context, tools, and system prompt.
4. Tools are wrapped so `beforeToolCall` / `afterToolCall` hooks can transform input/output.
5. The AI adapter forwards `ToolExecutionContext`, including `runContext`, clarification handler, abort signal, and `toolCallId`.
6. `loop()` handles text/tool chunks, response messages, finish reasons, retries, timeouts, aborts, and compaction callbacks.

## Prompt Resolution

- The base system prompt is `loadAgentsPrompt() ?? DEFAULT_PROMPT` (`src/prompt/system.ts`): a non-empty `agents.md`/`AGENTS.md` in the runtime `process.cwd()` REPLACES the built-in prompt entirely — the two never combine. Lookup is cwd-only, case-insensitive, mtime-cached (edits apply without restart), and an empty file counts as absent.
- Plugin `SystemPromptOption.append` values stack on top of whichever base was selected (`resolveSystemPrompt` in `src/ai/index.ts`); a string or function option replaces even that base.
- Consequence: running any engine host from a directory with a root `AGENTS.md` (this repository included) silently swaps the entire built-in prompt for that file's content.

## Runtime Invariants

Verified against source; each of these has broken (or would silently break) real behavior when violated.

- `maxOutputTokens` is force-set per model family and is a correctness parameter, not a cost knob (`src/ai/index.ts`, `resolveMaxOutputTokens`; Claude 32768 / OpenAI 16384, env-overridable). The AI SDK does not pass it by default, and Anthropic's 4096 fallback can be consumed entirely by reasoning tokens — surfacing as `finishReason='length'` with empty text, historically misdiagnosed as context overflow.
- `finishReason === 'length'` is ambiguous and MUST stay disambiguated (`src/core/loop.ts` length branch): only `inputTokens >= modelContextBudget * 0.8` counts as true overflow and may compact; an output-cap hit just continues the loop so the model resumes.
- Compaction attempts share ONE counter across both trigger sites — pre-loop and length-retry (`compactionAttempts` in `src/core/loop.ts`, cap `MAX_COMPACTION_ATTEMPTS`, default 2, env-overridable). A pre-loop compaction consumes an attempt the length branch can no longer use.
- Compacted message lists must never end on an assistant message: `ensureEndsWithUser` (`src/context/index.ts`) strips trailing assistant messages and appends a placeholder user message if that empties the list — some providers reject assistant-final requests.
- Tool wrapping order in the loop is fixed: `wrapToolsWithReadDedup` first, `wrapToolsWithHooks` second (`src/core/loop.ts`). Plugin `afterToolCall` hooks therefore observe read/ls output with the dedup note already appended; no hook sees the raw output.
- Plugin dependency resolution is asymmetric (`src/plugin/PluginManager.ts`): topological sort silently skips a dependency that is not in the plugin list, but initialization throws `Dependency not found`. A misspelled dependency name surfaces only at init time, and only in loading combinations that omit the intended plugin.

## Built-In Plugin Order

Defined in `src/built-in/index.ts`:

1. MCP
2. Skills
3. Tool Search
4. Plan Mode
5. Task Tracking
6. SubAgent
7. Agent Teams
8. Role Soul
9. PTC

Order matters because later plugins can observe or filter tools registered earlier.

## Config Roots

Preferred project config lives under `.pulse-coder/*`. Legacy `.coder/*` paths remain supported. Some loaders also support user-level config under the home directory.

Important examples:

- MCP: `.pulse-coder/mcp.json`, `.coder/mcp.json`, and home equivalents.
- Skills: `.pulse-coder/skills/**/SKILL.md`, plus compatible skill roots.
- Sub-agents: `.pulse-coder/agents`, `.coder/agents`.
- Engine plugins/config: `.pulse-coder/engine-plugins`, `.pulse-coder/config`, plus legacy equivalents.

## Risk Areas

- `src/core/loop.ts`: history pruning, retries, aborts, tool streaming, timeouts, and compaction are tightly coupled.
- `src/tools/bash.ts`: must stay async and decode buffered UTF-8 safely.
- `src/tools/grep.ts`: now uses async `execFile` with an arg array (was blocking `execSync` with a shell string — a command-injection + blocking-I/O bug, fixed with a regression test).
- `src/built-in/index.ts`: plugin order and exports affect hosts.
- `src/index.ts`: public exports affect downstream package builds.
