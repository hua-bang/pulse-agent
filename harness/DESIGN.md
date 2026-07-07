# Harness Design

This document defines the target shape for the repository harness. It is a design layer, not an implementation log. For current status, gaps, and rollout order, see `harness/README.md` and `harness/ROADMAP.md`.

## Formula

The harness is intentionally small:

```text
Harness = AGENTS.md + Knowledge + Tool + Validate + Skills
```

`AGENTS.md` is the always-on control surface. The other four surfaces are expandable context that should be loaded only when the task needs them.

## Surfaces

| Surface | Role | Default shape |
|---|---|---|
| `AGENTS.md` | Routing, boundaries, prerequisite gates, acceptance standards, and failure guards that must stay in active context. | Root and workspace entry files. |
| Knowledge | Facts the agent is facing: workspace membership, module responsibility, contracts, risk areas, runtime/config boundaries, and impact relationships. | Lightweight index in `AGENTS.md`; details live in workspace docs, root docs, and `pnpm-workspace.yaml`. |
| Tool | Mechanisms the agent can run or inspect: graph viewers, detectors, runners, generators, debug helpers. | Lightweight index in `AGENTS.md`; executable tools and local scripts document themselves. |
| Validate | How the agent chooses checks and reports evidence. | Lightweight index in `AGENTS.md`; workspace-local validation first; optional root impact rules in `harness/validate/`. |
| Skills | Reusable action protocols for recurring repository work. | Repo-level or workspace-level protocol docs when the workflow is stable enough to name. |

The surfaces are not equal-weight boilerplate. A workspace does not need a local Knowledge, Tool, Validate, or Skills directory until local detail is too dense for its `AGENTS.md` or existing docs.

## Spec Artifacts

`Spec` is not a sixth default surface in the harness formula. It is an optional specification artifact for cases where a feature, protocol, migration, or architectural boundary needs an explicit normative design.

Use this distinction:

| Artifact | Answers | Meaning |
|---|---|---|
| Knowledge | What is true now? | Current implemented facts, architecture, contracts, risks, and runtime boundaries. |
| Spec | What should be true? | Normative design for intended behavior, protocols, feature shape, or migration target. |
| Spec history | Why did the spec become this? | Decision trail, rejected options, tradeoffs, migration notes, and dated context. |

Prefer this shape when a spec is needed:

```text
harness/spec/<feature>/README.md
harness/spec/<feature>/history/YYYY-MM-DD-topic.md
```

`README.md` is the current active specification. Keep history out of it except for short links. Put decision records, prior approaches, and migration notes under `history/`.

Default placement is workspace-local:

```text
workspace/
  harness/
    spec/
      <feature>/
        README.md
        history/
          YYYY-MM-DD-topic.md
```

Use root `harness/spec/<feature>/` only for cross-workspace specifications that the root can legitimately own, such as a repo-wide runtime protocol or multi-package migration. Package-local behavior belongs in that workspace's harness.

Do not create a spec for facts that are already implemented and only need to be understood. Those belong in Knowledge. Do not create a spec because a directory template says so; create one only when a normative design needs a durable source of truth.

## Surface README Rule

Do not create a README for a surface by default. The formula is a mental model, not a directory template.

Use `AGENTS.md` as the lightweight index for Knowledge, Tool, Validate, and Skills until a surface has real navigation cost. Add a dedicated surface README only when at least one of these is true:

- The surface has many entries, roughly 15 or more files or subtopics.
- The surface has multiple entry types and readers need help choosing the right one.
- The surface is consumed by a script or tool and needs a stable input/output contract.
- The directory is likely to be opened directly without first reading `AGENTS.md`.

If none of those is true, keep the route in `AGENTS.md` or the nearest existing doc. A thin README that merely restates the surface name is noise.

## Workspace Harness Directory

When a workspace needs local harness assets, prefer a workspace-local `harness/` directory as the container:

```text
workspace/
  AGENTS.md
  harness/
    knowledge/
    spec/
    tools/
    validate/
    skills/
```

This is a future-friendly home for local Knowledge, Spec, Tool, Validate, and Skills assets. It does not mean every workspace should immediately create every subdirectory.

Use these defaults:

- Keep lightweight routing in the workspace `AGENTS.md`.
- Add `harness/validate/` when validation needs machine-readable rules, local scenarios, or command selection beyond a short `AGENTS.md` note.
- Add `harness/tools/` when the workspace has executable mechanisms or scripts that need a stable home.
- Add `harness/knowledge/` only when local facts outgrow existing `README.md`, `docs/`, contracts, or source types.
- Add `harness/spec/` only when normative design is needed for a feature, protocol, migration, or architectural boundary.
- Add `harness/skills/` only for stable local action protocols that are not runtime task skills.

If a workspace already has `harness/` for a specific mechanism, treat that existing directory as the relevant surface until there is enough pressure to split it. For example, `apps/canvas-workspace/harness/` is currently a real Electron operation tool; do not mix unrelated Knowledge or Skills files into it casually. If it later needs a full workspace harness container, migrate deliberately instead of overloading the existing tool layout.

Runtime artifact directories such as `.harness/` are not harness knowledge. They hold generated state, screenshots, logs, or temporary homes and should not become documentation or validation sources of truth.

## Root / Workspace Split

The root harness is a router and coordination layer. It owns repository-wide invariants and cross-workspace impact, not package-local detail.

| Layer | Owns | Does not own |
|---|---|---|
| Root | Precedence, global constraints, active workspace source, shared reading path, global tools, optional validation overlay, known cross-package impact rules. | Package architecture, local runbooks, local command nuance, local product behavior. |
| Workspace | Local role, boundaries, contracts, scripts, tests, validation details, runbooks, local failure guards. | Rules that contradict root constraints or silently redefine repository-wide behavior. |

Module rules may refine root rules, but they must not contradict them. If a fact is only true for one workspace, it belongs in that workspace's `AGENTS.md`, docs, or local validation file.

## Knowledge Ownership

Do not maintain a separate workspace profile table. The sources of truth are:

| Fact | Source of truth |
|---|---|
| Active workspace membership | `pnpm-workspace.yaml` |
| Package name and package scripts | Workspace `package.json` |
| Workspace role and navigation | Workspace `AGENTS.md` |
| Local contracts and architecture | Workspace `docs/`, `README.md`, source types, and tests |
| Repository-level harness routing | Root `AGENTS.md`, `CLAUDE.md`, `harness/README.md` |

This avoids a second root-owned map that drifts from package reality. Root files should route to the local owner instead of copying local facts.

## Validate Ownership

Validation has two different jobs:

| Scope | Job | Default location |
|---|---|---|
| Workspace-local validation | Local commands, known red commands, local smoke checks, package-specific caveats. | Workspace `harness/validate/validation.yaml` for machine-readable rules; `harness/validate/README.md`, docs, or `AGENTS.md` for human guidance. |
| Root validation overlay | Root config changes, shared dependency changes, cross-workspace public API impact, migration-era routing while local validation files are introduced. | `harness/validate/validation.yaml` |

The root validation file is optional by design. It should exist only where the root can say something useful that a single workspace cannot know, such as "this root config change affects every package" or "this public API change must check downstream consumers."

Run evidence does not belong in YAML. Put evidence in the final response, PR/MR description, or CI logs once CI exists.

## What Belongs In `AGENTS.md`

Both root and workspace `AGENTS.md` files use the same categories:

| Category | Purpose |
|---|---|
| Navigation / routing | Where to read next for the current scope. |
| Hard boundaries / constraints | Stable rules that should remain in active context. |
| Prerequisite gates | Conditions that require reading a contract, loading a protocol, running a detector, or gathering evidence first. |
| Acceptance standards | What evidence must be collected before claiming the work is done. |
| Failure capture | Named guardrails from past failures, stated as concise rules. |

`AGENTS.md` should not become the full knowledge base. If a section starts accumulating detailed facts, move those facts into Knowledge, Tool, Validate, or Skills and keep only the trigger or summary in `AGENTS.md`.

## Agent Loop

The expected agent behavior is:

```text
1. Start from root AGENTS.md / CLAUDE.md, then harness/README.md when harness context is relevant.
2. Identify the affected workspace from the changed path and pnpm workspace membership.
3. Read the affected workspace AGENTS.md and only the local docs needed for the task.
4. Use Tool only when a mechanism is needed to inspect, transform, or check something.
5. Select validation from the workspace first, then apply root Validate overlay for root or cross-workspace impact.
6. Report the commands run, commands skipped, and why.
7. Feed durable discoveries back into the right surface:
   - new fact or local rule -> workspace Knowledge or AGENTS.md
   - new intended behavior or normative design -> workspace Spec
   - new design decision or rejected option -> workspace Spec history
   - new mechanism -> Tool
   - new acceptance rule or known validation gap -> Validate
   - new recurring workflow -> Skills
```

## Current Repository Projection

The current pilot maps onto this design as follows:

| Design surface | Current repository location |
|---|---|
| Root control surface | `AGENTS.md` and `CLAUDE.md` |
| Root Knowledge | Root `AGENTS.md`, `CLAUDE.md`, `harness/README.md`, `pnpm-workspace.yaml`, workspace entries, selected `docs/` |
| Root Tool | Root `AGENTS.md`, `harness/README.md`, executable tools under `scripts/harness/`, and self-documenting tool directories when needed |
| Root Validate | Root `AGENTS.md`, `harness/README.md`, optional root overlay in `harness/validate/validation.yaml`, and workspace-local validation docs |
| Skills | Protocol docs when present; runtime task skills under `.pulse-coder/skills/` are a separate product layer and must not be merged with repo harness protocols. |
| Workspace control surface | Each workspace `AGENTS.md` |
| Workspace Knowledge / Tool / Validate | Workspace-local `harness/`, `README.md`, docs, scripts, tests, and contracts |
| Workspace Spec | Optional workspace-local `harness/spec/<feature>/` when a normative design needs a durable home |

Do not add or keep a file solely because the model has a named surface. Add a file only when it removes duplication, gives the agent a clearer route, or creates an executable constraint.

## Minimal Workspace Entry Template

Use this shape when adding or refreshing a workspace `AGENTS.md`:

```text
# AGENTS.md

## Role
What this workspace owns and when an agent should use this entry.

## Navigation / Routing
Where local Knowledge, Tool, Validate, and Skills details live.

## Hard Boundaries / Constraints
Stable local rules, public contracts, and files that need special care.

## Prerequisite Gates
When to load local contracts, docs, action protocols, tools, or validation rules.

## Acceptance Standards
Which local checks or evidence are expected before finishing.

## Failure Capture
Short named guards from past workspace failures.
```

Keep workspace entries local and differential. Do not copy root principles or root validation prose into every workspace.

## Anti-Patterns

- Recreating a root `profile.yaml` for workspace roles or knowledge pointers.
- Putting workspace-local facts in root harness files.
- Treating root `harness/validate/validation.yaml` as mandatory for every workspace.
- Creating `knowledge/README.md`, `tools/README.md`, `validate/README.md`, or `skills/README.md` just because the surface exists.
- Mixing generated `.harness/` run artifacts with durable harness knowledge.
- Dumping unrelated Knowledge, Validate, or Skills files into an existing tool-specific `harness/` directory without an explicit migration.
- Using Spec as a second Knowledge store for current implemented facts.
- Letting `spec/<feature>/README.md` become a decision log; move history and alternatives into `spec/<feature>/history/`.
- Storing run evidence in YAML.
- Claiming CI, hooks, or a validation runner exists before it is implemented.
- Duplicating the same command matrix in root and workspace docs without a clear owner.
- Merging repo harness Skills with `.pulse-coder/skills/` runtime task skills.

## Rollout Order

1. Keep root `AGENTS.md` as the global control surface.
2. Keep workspace membership in `pnpm-workspace.yaml` and workspace facts near each workspace.
3. Keep surface routing in `AGENTS.md` until a surface reaches the README threshold.
4. Use workspace-local `harness/` as the preferred container when local Knowledge, Tool, Validate, or Skills assets need a home.
5. Keep root Validate minimal while migrating detailed validation into workspace-local `harness/validate/`.
6. Keep `scripts/harness/` tools consuming workspace-local validation files as the primary source (done for the runner and drift check).
7. Make Validate executable by adding a runner for `harness/validate/validation.yaml` plus workspace-local validation files.
8. Add Spec only when a concrete feature, protocol, or migration needs normative design and history.
