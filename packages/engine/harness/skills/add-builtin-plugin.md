# Skill: Add or modify a built-in plugin

An ordered procedure for adding/changing a plugin in `builtInPlugins`. It gives the SEQUENCE and the landmines; the FACTS live in the knowledge docs it points to — do not restate them here.

## When to use

Adding a new built-in plugin, or reordering/removing/renaming an existing one in `src/built-in/`.

## Steps

1. **Snapshot the current reality first.** Build, then run the introspection tool so you edit against ground truth (the prose docs have drifted before):
   `pnpm --filter pulse-coder-engine build && node packages/engine/harness/tools/describe-engine.mjs`
   Note the current registration order, the dependency edges, and which exports the main barrel already omits.

2. **Implement the plugin object.** `name`, `version`, `initialize(ctx)`, optional `dependencies`. Contract and the `ctx` capabilities: `harness/knowledge/plugin-system.md` (Plugin Contract).

3. **Register at the RIGHT order position** in `src/built-in/index.ts`'s `builtInPlugins` array. Order = the tools-pipeline order: a later plugin only sees what earlier ones left, and can filter/hide their tools. See `plugin-system.md` (The Tools Pipeline keystone) before choosing the slot.

4. **Declare `dependencies` with EXACT names.** A dependency string must equal the target plugin's `name` verbatim — a typo throws `Dependency not found` at init and aborts the ENTIRE Engine build for every host, not just this plugin (`plugin-system.md` fail-fast; guarded by `src/plugin/plugin-manager.test.ts`).

5. **Export from BOTH barrels.** `src/built-in/index.ts` AND `src/index.ts` — they are asymmetric today (`describe-engine` step 1 shows which the main barrel omits). Consumers reach plugins through `./built-in`; a public-surface change must update both deliberately (`harness/knowledge/contracts.md`, Public Surface).

6. **Remember non-propagation.** `apps/remote-server` and `apps/canvas-workspace` set `disableBuiltInPlugins: true` and hand-assemble their own ordered lists — they do NOT inherit a new default plugin automatically. If it must reach them, edit their arrays too (`packages/engine/AGENTS.md` Local Constraints).

7. **Run the consumer escalation.** This is a `built-in` change → run the `engineBuiltInPluginChange` reminder from `node scripts/harness/run-harness-check.mjs`, plus `pnpm --filter pulse-coder-engine test`.

## Done when

`describe-engine` shows the plugin in the expected slot with resolved deps, both barrels export it (or the omission is intentional and noted), engine test + typecheck pass, and the escalation commands are green.
