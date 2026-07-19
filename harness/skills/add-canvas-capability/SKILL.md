---
name: add-canvas-capability
description: Add or change a Pulse Canvas capability that must be available through structured agent tools and the pulse-canvas CLI. Use for cross-workspace Capability Runtime changes spanning apps/canvas-workspace, packages/canvas-cli, or packages/cli, including new live read, operate, or unsafe application actions.
---

# Add Canvas Capability

Make the Capability Runtime the single behavior boundary. Expose that capability through native tools and CLI adapters without duplicating domain logic, policy, transport, or error handling.

## Workflow

1. Define the contract before editing.
   - State the user-visible action and why a persisted-store command is insufficient.
   - Choose a stable dotted name such as `canvas.nodes.archive`.
   - Define the Zod input, JSON-serialisable output, stable error codes, and `read`, `operate`, or `unsafe` risk.
   - List the intended consumers: Canvas Agent, Pulse Agent, external Codex/Claude agents, or a subset.

2. Read the owners.
   - Read root `AGENTS.md`, `harness/README.md`, and `harness/validate/validation.yaml`.
   - Read `apps/canvas-workspace/AGENTS.md` and its local validation file.
   - Read `packages/canvas-cli/AGENTS.md` and its local validation file.
   - Read `packages/cli/AGENTS.md` when changing Pulse Agent tool registration or descriptions.
   - Inspect sibling definitions under `apps/canvas-workspace/src/main/runtime/capabilities/` and the current policy in `capabilities/index.ts`.

3. Add a failing focused test for the behavior or contract. Cover the real risk: schema rejection, actor policy, workspace isolation, abort propagation, domain side effects, or stable error mapping.

4. Implement the behavior once in the existing domain owner. Keep storage, Electron, webview, and business operations out of CLI and Tool adapters. Reuse an existing service or operation module before creating another abstraction.

5. Register the capability.
   - Put the definition in the matching module under `src/main/runtime/capabilities/`.
   - Validate input with Zod and use `CapabilityError` for expected stable failures.
   - Use `context.workspaceId`, `context.actor`, and `context.abortSignal`; never infer a workspace or bypass cancellation.
   - Add the definition to `getCanvasCapabilityRuntime()` and update policy and feature-gate sets together when needed.
   - Ensure discovery and execution apply the same policy. Registration alone does not make a capability externally callable.

6. Expose adapters without forking behavior.
   - Pulse Agent already discovers and calls allowed capabilities through `app_capabilities_list` and `app_capability_call` in `packages/cli/src/canvas-runtime-tools.ts`.
   - External agents already use `pulse-canvas runtime capabilities` and `pulse-canvas runtime call` through `packages/canvas-cli/src/core/runtime-capabilities.ts`.
   - Verify both generic paths for every new externally allowed capability; do not add adapter code merely to rename the same generic call.
   - For a frequent action that needs better model selection, add a task-specific Canvas Agent Tool that calls `getCanvasCapabilityRuntime().call(...)` with actor `canvas-agent` and forwards the abort signal. Read `apps/canvas-workspace/harness/skills/add-agent-tool/SKILL.md` before doing so.
   - Add a dedicated CLI subcommand only when it materially improves human or agent ergonomics. Implement it over the shared runtime capability client, never over a second copy of the behavior or transport policy.
   - Update the bundled `pulse-canvas` Skill only when the action needs ordering, safety guidance, or selection advice that discovery metadata cannot express.

7. Preserve the local security boundary.
   - Keep runtime routes loopback-only and authenticated through the per-run runtime descriptor; do not add user-configured API keys.
   - Keep external access behind `agent-runtime-control` and any capability-specific experimental flag.
   - Treat a new externally callable `unsafe` capability as a security-policy change. Read `apps/canvas-workspace/harness/knowledge/security-posture.md`, justify the exception, and test discovery plus execution denial/allowance.

8. Verify from each promised consumer.
   - Test the capability definition and domain side effect directly.
   - Test any task-specific Tool adapter for capability name, workspace, actor, abort signal, result, and error parity.
   - Test a dedicated CLI command when added; otherwise exercise the generic `runtime call` contract when its shared client or protocol changed.
   - Run `node scripts/harness/run-harness-check.mjs` so workspace-local checks and root cross-workspace reminders come from their SSOT.
   - Run release-level performance or packaged-agent-tooling smoke only when the changed paths or validation rules require them.

## Guardrails

- Do not implement the operation separately in a Tool, HTTP handler, and CLI command.
- Do not let adapters invent different schemas, timeout budgets, permissions, or error codes.
- Do not expose internal `data` fields to external actors merely because the Canvas Agent may use them.
- Do not add a task-specific Tool or CLI command when generic discovery and call are sufficient.
- Do not claim Tool + CLI support until both consumers can discover the capability under the intended flags and actor policy.

## Done When

- One domain implementation sits behind one registered capability.
- Native Tool and CLI consumers share that capability and its policy.
- Risk, feature gates, authentication, workspace selection, cancellation, and error semantics are explicit.
- Focused regression tests pass and the harness runner reports the required affected-workspace checks.
