# AGENTS.md - packages/cli

Local entry for the Pulse Coder terminal host. Read root AGENTS and harness/README.md first.

## Role and boundaries

This package owns Ink, the readline fallback, print mode, sessions, slash commands, clarification, model selection, memory/task-list integration, goal host IO, and host-tool registration. Engine, ACP, and team protocol policy remain in their own packages. Sandbox execution is local to src/tools/sandbox and its separately built runner.

Keep source files around 300 lines, host surfaces separate, and tests beside their modules. The source map and stable facade boundaries live in `harness/knowledge/source-layout.md`.

## Required task routes

When a trigger matches, read its Knowledge/protocol before editing.

| Change | Required knowledge / first source |
|---|---|
| Entry flags, Ink/readline/print structure, facade exports | `harness/knowledge/source-layout.md`, `src/ui-mode.ts` |
| Runs, stop/abort, queued input, signals, sessions, slash commands, logging | `harness/knowledge/host-lifecycle.md` |
| Models/providers, startup/resume choice, context budget, prompt-cache routing | `harness/knowledge/model-registry.md`, `src/models/model-registry.ts` |
| Streaming transcript, tool traces, terminal paint, composer/picker geometry | `harness/knowledge/live-region-bounding.md` |
| File/image references, paste/clipboard attachments | `harness/knowledge/file-references.md`, `src/shared/file-reference.ts` |
| Goal continuation and host IO | `harness/knowledge/goal.md`, `src/shared/goal-integration.ts` |
| Host tools, run_js, forked sandbox runner, live Canvas capabilities | `harness/knowledge/source-layout.md` (Host tool boundaries), `src/tools/runtime-tools.ts` |
| Memory integration | `src/shared/memory-integration.ts`, `packages/plugin-kit/harness/knowledge/memory.md` |
| Harbor / SWE-bench evaluation | `harness/tools/harbor/README.md` |
| Validation and package scripts | `harness/validate/validation.yaml`, `package.json` |

## Local constraints

- Keep CLI-specific state and UI behavior in this package; do not push UI concerns into the engine.

- Keep command behavior aligned between the Ink controller and the readline fallback unless a change is intentionally UI-specific.

- Default startup selects Ink via `src/ui-mode.ts`; `PULSE_CODER_UI=readline` is the fallback path.

- Session files live under `~/.pulse-coder/sessions`; keep local runtime data out of source control and preserve session task-list metadata.

- This package currently has no `typecheck` script; do not document or rely on `pnpm --filter pulse-coder-cli typecheck` until `package.json` adds it.

- Contract changes with engine, ACP, teams, or plugin-kit (memory module) should use the affected workspace contracts/validation plus the root impact overlay.

- Keep the transcript append-only; render streaming work in the live region. Bound live content on both display axes through terminal/text-width, never String.length.
- Engine abort is detected from the signal after a resolved run; preserve the abort path, atomic session save, and queued-input rules in host-lifecycle.md.
- Preserve the two real interaction modes (edit/plan) and built-in-command precedence. Retired team/ACP commands stay unwired until their abort and bridge support is deliberately restored.
- models.json stores environment variable names, not secret values. Share model run-option construction between hosts and preserve startup/resume precedence.
- Goal policy belongs to plugin-kit; this host injects IO. Read goal.md before changing completion or confirmation.
- Keep host-tool assembly shared. Live-app tools require both the CLI opt-in and the Canvas host flag; their exact contract is in source-layout.md.

## Acceptance

Run from the repository root:

```bash
pnpm --filter pulse-coder-cli test
pnpm --filter pulse-coder-cli build
```

Use the local validation file and root overlay for the actual changed paths. There is no CLI typecheck script; smoke-launch after wiring new engine imports, since missing exports can surface only at runtime. Build before `pnpm start` when dist may be stale; `pnpm start:debug` rebuilds before debugging.

For interactive changes, preserve both hosts' shared behavior and the documented UI-specific differences. Terminal paint/geometry evidence comes from `src/ink/ink-app.render.test.tsx` and `src/ink/ink-app.screen.test.tsx`. Keep unverified runtime behavior explicit.

## Known divergence and write-back

The readline direct skill invocation has a documented fall-through defect; read host-lifecycle.md before touching slash routing. Do not silently restore retired commands or normalize intentional host differences.

Write detailed lessons into the relevant Knowledge file and keep this entry as a task router. Source maps belong in source-layout.md, command selection in local validation.
