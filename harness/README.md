# Repository Harness

This directory is the source of truth for the repository-level harness pilot. It is separate from `.pulse-coder/`, which remains product/runtime configuration (MCP servers, sub-agents, runtime skills) for Pulse Coder itself.

The target harness shape is one always-on control surface plus four expandable surfaces:

```text
AGENTS.md -> Knowledge / Tool / Validate / Skills
```

See `harness/DESIGN.md` for the full model. In short: `AGENTS.md` carries persistent routing, constraints, gates, acceptance standards, and failure guards; Knowledge / Tool / Validate / Skills carry the expandable facts, mechanisms, validation planning, and action protocols.

## Reading Path

Use progressive disclosure. Do not read the whole repository by default.

```text
AGENTS.md / CLAUDE.md
-> harness/README.md
-> affected workspace entry
-> workspace contracts/spec/runbook/validation as needed
```

## Areas

| Area | Path | Purpose |
|---|---|---|
| Harness design | `DESIGN.md` | Target shape for AGENTS.md + Knowledge / Tool / Validate / Skills across global and module scopes. |
| Pilot status | `ROADMAP.md` | Current pilot status, honest gaps (no CI / no git hooks / no executable checks), and the keystone rollout plan. |
| Workspace membership | `../pnpm-workspace.yaml` | Machine-readable active workspace set. |
| Root validation rules | `validate/validation.yaml` | Machine-readable root validation routing and escalation rules. |
| Knowledge index | `knowledge/` | Index for the Knowledge surface — routes to existing knowledge SSOTs (root AGENTS, workspace AGENTS, workspace docs/contracts). |
| Validate index | `validate/` | Index for the Validate surface — routes to root validation rules, workspace validation, checks, and run evidence. |
| Tools | `tools/` | Harness tool index; only `graph-viewer` is a wired executable today. |

## Knowledge Routing

Keep source-of-truth routing lightweight and human-readable. Do not maintain a separate YAML rule table for this during the pilot.

| Knowledge | Default target |
|---|---|
| Knowledge surface index (what the agent faces) | `harness/knowledge/README.md` |
| Validate surface index (how the agent validates) | `harness/validate/README.md` |
| Repository navigation | `AGENTS.md` |
| Claude Code specifics | `CLAUDE.md` |
| Workspace routing | `pnpm-workspace.yaml` + workspace `AGENTS.md` |
| Validation rules | workspace `harness/validate/validation.yaml`, plus optional root impact rules in `harness/validate/validation.yaml` |
| Package contract | Workspace `AGENTS.md`, `README.md`, `harness/knowledge/contracts.md` if present, otherwise local docs/types/tests |
| App behavior | Workspace `AGENTS.md` or `CLAUDE.md`; add `docs/spec/` only when behavior needs durable product-level SSOT |
| Runtime operation | Workspace `docs/runbook.md` or local entry file |
| Future action protocol | Add `harness/skills/*.md` only after a recurring workflow is stable enough to justify a file |
| Tool documentation | `harness/tools/README.md` and executable tool README files |

## Principles

- Root entry files route; they do not duplicate workspace knowledge.
- `pnpm-workspace.yaml` maps workspaces; workspace-local `harness/validate/validation.yaml` maps local checks; root `validate/validation.yaml` maps root config and cross-workspace impact. Keep other routing in Markdown until it proves stable enough to mechanize.
- Workspace facts live near the workspace.
- Add mechanical checks only after a rule proves stable enough to enforce.
- Package-local harness directories are optional extension points, not required boilerplate.

## Pilot Coverage

The pilot is no longer limited to an initial representative set. `pnpm-workspace.yaml` defines the active workspace set, workspace `AGENTS.md` files own local role/navigation, and every active workspace has a local `harness/validate/validation.yaml`. Root `harness/validate/validation.yaml` is now reserved for root config checks and cross-workspace impact rules.

`pnpm-workspace.yaml` is the SSOT for the active workspace set. See `harness/ROADMAP.md` for pilot status and known gaps.
