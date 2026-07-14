---
name: add-agent-tool
description: Use when adding or changing a Canvas Agent tool (canvas_* / workspace_node_* in src/main/agent/tools/). Covers the two registration surfaces, the ZodObject trap, the tool-name compatibility contract, defer_loading, and the execute-class security gate.
---

# Add a Canvas Agent Tool

An ordered procedure. Gives the SEQUENCE and the landmines; FACTS live in the sources it points to — do not restate them here.

## Steps

1. **Snapshot the registry first.** `node apps/canvas-workspace/harness/tools/describe-canvas.mjs` — see the current 45+ tools, the naming conventions per file, and whether your name collides (duplicate names are a hard error there). Note: describe-canvas checks NAMES only — it does NOT verify the global-chat surface (landmine 3 below), so passing it is necessary, not sufficient.

2. **Implement the tool** in the matching per-capability module under `src/main/agent/tools/` (nodes/edges/sessions/terminals/… — match your capability's siblings' shape: `name`, `description`, zod `inputSchema`, `execute`).

3. **Register on BOTH surfaces if the tool should work in global chat.** `src/main/agent/tools/index.ts` has TWO factories: `createCanvasTools(workspaceId)` (workspace-scoped chat) and `createGlobalCanvasTools()` (global chat, no ambient workspace). A tool only added to the first silently does not exist in global chat. Global-surface tools must be wrapped in `requireWorkspaceId(...)` so the LLM supplies the workspace explicitly.

4. **The ZodObject trap.** `requireWorkspaceId` (tools/index.ts:28) only `.extend`s the schema when `inputSchema instanceof z.ZodObject` — any non-object schema is silently NOT extended, and the global-chat variant breaks without a compile error. Keep tool input schemas object-shaped.

5. **The tool name is a compatibility contract.** `harness/knowledge/main-domain-modules.md` Compatibility Rules lists "canvas-agent tool names" as must-not-change — persisted sessions and skills reference them. Naming convention: `canvas_*` / `workspace_node_*`, snake_case. Renaming an existing tool is a breaking change, not a refactor.

6. **Decide `defer_loading` consciously.** A deferred tool (see `terminals.ts:17`) is hidden from the LLM until a `tool_search_*` call loads it. Defer heavy/rare tools; load-immediately for core ones.

7. **Execute-class tools go through the security gate.** If the tool spawns/executes/writes outside the canvas store (anything bash-shaped, PTY-shaped, or filesystem-shaped), read `harness/knowledge/security-posture.md` ("When you change things here") and the `canvas_create_terminal_node` precedent in `terminals.ts` BEFORE implementing — you are widening what a prompt-injected LLM can do at main-process privilege.

8. **Verify.** Re-run describe-canvas (name registered, no dup); `pnpm --filter canvas-workspace typecheck && pnpm --filter canvas-workspace test`.

## Done when

The tool appears in describe-canvas's registry; it is on both factories (or the workspace-only choice is stated in the PR); schema is a ZodObject; name follows the convention; defer_loading is a conscious choice; execute-class gate consulted if applicable; typecheck + test green.
