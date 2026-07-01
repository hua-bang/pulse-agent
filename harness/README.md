# Repository Harness

This directory is the source of truth for the repository-level harness pilot. It is separate from `.pulse-coder/`, which remains product/runtime configuration (MCP servers, sub-agents, runtime skills) for Pulse Coder itself.

The target harness shape is one always-on control surface plus three expandable surfaces:

```text
AGENTS.md -> Know / Tool / Verify
```

See `harness/DESIGN.md` for the full model. In short: `AGENTS.md` carries persistent routing, constraints, gates, acceptance standards, and failure guards; Know / Tool / Verify carry the expandable facts, mechanisms, and validation evidence.

## Reading Path

Use progressive disclosure. Do not read the whole repository by default.

```text
AGENTS.md / CLAUDE.md
-> harness/README.md
-> harness/profile.yaml
-> affected workspace entry
-> workspace contracts/spec/runbook/validation as needed
```

## Areas

| Area | Path | Purpose |
|---|---|---|
| Harness design | `DESIGN.md` | Target shape for AGENTS.md + Know / Tool / Verify across global and module scopes. |
| Pilot status | `ROADMAP.md` | Current pilot status, honest gaps (no CI / no git hooks / no executable checks), and the keystone rollout plan. |
| Repository map | `profile.yaml` | Machine-readable workspace routing table. |
| Validation matrix | `validation.yaml` | Machine-readable validation matrix and escalation rules. |
| Action protocols | `skills/` | Repo-level action protocols (not runtime skills) for recurring work. |
| Atomic tools | `tools/` | Atomic tool protocols; only `graph-viewer` is a wired executable, the rest are spec-only. |
| Feedback flow | `feedback/` | Admission, routing, proposals, and temporary inbox. |
| Checks | `checks/` | Future mechanical gates to prevent drift. |
| Templates | `templates/` | Starting points for new local entries and proposals. |

## Knowledge Routing

Keep source-of-truth routing lightweight and human-readable. Do not maintain a separate YAML rule table for this during the pilot.

| Knowledge | Default target |
|---|---|
| Repository navigation | `AGENTS.md` |
| Claude Code specifics | `CLAUDE.md` |
| Workspace routing | `harness/profile.yaml` |
| Validation matrix | `harness/validation.yaml` and workspace `docs/validation.md` |
| Package contract | Workspace `AGENTS.md`, `README.md`, `docs/contracts.md`, types, and tests as needed |
| App behavior | Workspace `AGENTS.md` or `CLAUDE.md`; add `docs/spec/` only when behavior needs durable product-level SSOT |
| Runtime operation | Workspace `docs/runbook.md` or local entry file |
| Agent action protocol | `harness/skills/*.md` |
| Atomic tool protocol | `harness/tools/*/README.md` |
| Feedback proposal | `harness/feedback/`, then route accepted facts to the real target |

## Principles

- Root entry files route; they do not duplicate workspace knowledge.
- `profile.yaml` maps workspaces; `validation.yaml` maps checks. Keep other routing in Markdown until it proves stable enough to mechanize.
- Workspace facts live near the workspace.
- Feedback is not the final knowledge store. Route accepted feedback back to the right long-term target.
- Add mechanical checks only after a rule proves stable enough to enforce.
- Package-local harness directories are optional extension points, not required boilerplate.

## Pilot Coverage

The pilot is no longer limited to an initial representative set. `harness/profile.yaml` now routes 14 active workspaces across `packages/*` plus `apps/remote-server`, `apps/teams-cli`, and `apps/canvas-workspace`, each with a type, package name, role, entry, and knowledge pointer. `harness/validation.yaml` binds a `pnpm --filter` check set to each workspace's paths.

`harness/profile.yaml` is the SSOT for the active workspace set — do not re-list workspaces here. See `harness/ROADMAP.md` for pilot status and known gaps.
