# Harness Design

This document defines the target shape for the repository harness. It is a design layer, not an implementation log. For current gaps and rollout order, see `harness/ROADMAP.md`.

## Core Shape

A harness module has one always-on control surface plus three expandable surfaces:

```text
AGENTS.md
  navigation / routing
  hard boundaries / constraints
  prerequisite gates
  acceptance standards
  failure capture

Know
  facts, structure, contracts, risks, and impact relationships

Tool
  runners, graphs, scripts, detectors, generators, and other mechanisms

Verify
  validation matrix, quality gates, known gaps, and delivery evidence
```

`AGENTS.md` should stay small enough to remain active context. It tells agents what must always be true, when to load more context, and how to finish honestly. Know / Tool / Verify hold the details that are loaded only when the task needs them.

## Monorepo Layering

Monorepos need the same shape at two scopes:

```text
Root AGENTS.md
  -> Global Know / Tool / Verify
  -> affected Module AGENTS.md
  -> Module Know / Tool / Verify
```

Global and module entries are intentionally similar. The difference is emphasis:

| Layer | Owns | Does not own |
|---|---|---|
| Global | Cross-module consistency, repository-wide principles, shared constraints, global tools, global verification routing. | Detailed package architecture or local runbooks. |
| Module | Local responsibilities, public contracts, directory boundaries, module tools, module verification reality, local failure guards. | Rules that contradict global constraints. |

Module rules may refine global rules, but they must not contradict them.

## What Belongs In `AGENTS.md`

Both root and module `AGENTS.md` files use the same categories:

| Category | Purpose |
|---|---|
| Navigation / routing | Where to read next for the current scope. |
| Hard boundaries / constraints | Stable rules that should remain in the agent's active context. |
| Prerequisite gates | Conditions that require reading a contract, loading a protocol, running a detector, or stopping to gather evidence. |
| Acceptance standards | What evidence must be collected before claiming the work is done. |
| Failure capture | Named guardrails from past failures, stated as concise rules. |

`AGENTS.md` should not become the full knowledge base. If a section starts accumulating detailed facts, move those facts into Know, Tool, or Verify and keep only the trigger or summary in `AGENTS.md`.

## Know / Tool / Verify

Use these surfaces consistently at global and module scope:

| Surface | Question | Examples |
|---|---|---|
| Know | What is the agent facing? | Repository map, module responsibilities, contracts, risk zones, impact relationships, runtime/config boundaries. |
| Tool | What mechanisms can the agent use? | Harness runner, graph viewer, affected-workspace detector, local scripts, generators, debug entry points. |
| Verify | How does the agent prove the result? | Path-to-check matrix, package commands, quality gates, known red commands, skipped-validation reporting. |

Tools do not make final decisions. They provide mechanisms. Routing and gates decide when a tool should be used.

## Agent Runtime Loop

The expected agent behavior is:

```text
1. Start from the nearest relevant AGENTS.md.
2. Identify the affected scope and module.
3. Load Know only as needed to understand facts, contracts, risks, and impact.
4. Use Tool only when a mechanism is needed to inspect, transform, or check something.
5. Use Verify before finishing to select checks and report evidence.
6. Feed durable discoveries back into the right surface:
   - new fact or failure guard -> Know or AGENTS.md
   - new mechanism -> Tool
   - new acceptance rule or known gap -> Verify
```

## Current Repository Projection

The current pilot already maps onto this design:

| Design surface | Current repository location |
|---|---|
| Global control surface | `AGENTS.md` and `CLAUDE.md` |
| Global Know | `harness/profile.yaml`, `harness/README.md`, workspace entries, selected `docs/` |
| Global Tool | `harness/tools/`, especially `harness/tools/graph-viewer/server.mjs` |
| Global Verify | `harness/validation.yaml`, `harness/checks/README.md`, known validation notes in root entries |
| Action protocols | `harness/skills/*.md`; these are invoked by `AGENTS.md` gates and triggers |
| Module control surface | each workspace `AGENTS.md` |
| Module Know / Tool / Verify | module `docs/`, scripts, tests, contracts, and optional module-local harness files |

Do not rename directories just to match this design. The first goal is conceptual consistency and routing clarity. Rename or split files only when the current names create real confusion.

## Minimal Module Entry Template

Use this shape when adding or refreshing a module `AGENTS.md`:

```text
# AGENTS.md

## Role
What this module owns and when an agent should use this entry.

## Navigation / Routing
Where local Know, Tool, and Verify details live.

## Hard Boundaries / Constraints
Stable local rules, public contracts, and files that need special care.

## Prerequisite Gates
When to load local contracts, docs, action protocols, tools, or verification rules.

## Acceptance Standards
Which local checks or evidence are expected before finishing.

## Failure Capture
Short named guards from past module failures.
```

Keep module entries local and differential. Do not copy root principles or global validation prose into every module.

## Rollout Order

1. Keep root `AGENTS.md` as the global control surface.
2. Align `harness/README.md` with this design and route details to existing files.
3. Refresh high-impact module entries first: core runtime, CLI, remote runtime, and canvas workspace.
4. Add module Know / Tool / Verify files only when the module entry becomes too dense.
5. Make Verify executable by adding a runner for `harness/validation.yaml`.
