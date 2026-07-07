# Skill: Add or modify a built-in tool

An ordered procedure for adding/changing a tool in `src/tools/`. Gives the SEQUENCE and the landmines; FACTS live in the knowledge docs it points to — do not restate them.

## When to use

Adding a new built-in tool, or changing an existing tool's schema/behavior in `src/tools/`.

## Steps

1. **Snapshot the current tool registry first.** Build, then run the tool so you see the real registry (static + plugin-registered) and which are deferred:
   `pnpm --filter pulse-coder-engine build && node packages/engine/harness/tools/describe-engine.mjs`

2. **Implement the Tool object.** `name` (what the LLM sees), `description`, `inputSchema` (zod), `execute(input, ctx)`. Contract, existing tools' shapes, and `ToolExecutionContext` fields: `harness/knowledge/tools-reference.md`.

3. **NON-BLOCKING and SHELL-SAFE — the loudest engine-tool landmine.** Never `execSync`/blocking I/O and never build a shell string; pass args as arrays to async `execFile`/`spawn`. Both `bash.ts` and `grep.ts` shipped bugs here (event-loop freeze, command injection) — see root `AGENTS.md` §6 and `harness/knowledge/security-posture.md`. The engine ships zero tool gating; the host owns sandboxing.

4. **Decide `defer_loading`.** A deferred tool is hidden from the LLM until a `tool_search_*` call loads it on the NEXT turn (visibility gate). Load-immediately for core tools; defer for heavy/rare/network tools. See `plugin-system.md` (The Tools Pipeline keystone).

5. **Register in `src/tools/index.ts`.** Add to the `BuiltinTools` array AND the named-export block. A tool only in the array (like `deferDemoTool`) ships in `BuiltinToolsMap` but is not individually importable — do that only if intentional. `describe-engine` step 1 shows the current registry to match against.

6. **Know the precedence + blast radius.** Tool merge order is built-ins < plugin tools < `options.tools` (a host can override by name). The `Tool`/`ToolExecutionContext` shape is a dense consumer contract implemented across plugin-kit, memory-plugin, remote-server, and canvas (`harness/knowledge/contracts.md`, Known Consumers).

7. **Run the consumer escalation.** This is a tool-contract change → run the `engineToolSchemaChange` reminder from `node scripts/harness/run-harness-check.mjs`, plus `pnpm --filter pulse-coder-engine test`.

## Done when

`describe-engine` shows the tool with the intended `defer_loading` status and source, it is both in the array and (unless intentionally array-only) named-exported, engine test + typecheck pass, and the escalation commands are green.
