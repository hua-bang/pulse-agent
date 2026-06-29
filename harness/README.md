# Repository Harness

This directory is the source of truth for the repository-level harness pilot. It is separate from `.pulse-coder/`, which remains product/runtime configuration and test data for Pulse Coder itself.

The harness has four main loops:

```text
knowledge -> action -> validation -> feedback
```

`tools` are shared atomic capabilities that can be used by any loop.

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
| Repository map | `profile.yaml` | Machine-readable workspace routing table. |
| Validation matrix | `validation.yaml` | Machine-readable validation matrix and escalation rules. |
| Action protocols | `skills/` | Tool-agnostic agent skills for recurring work. |
| Atomic tools | `tools/` | Reusable small capabilities used by skills, checks, reports, or humans. |
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

## First Pilot Workspaces

This pilot starts with representative workspaces:

- `packages/engine`: core runtime package, contract-heavy.
- `packages/agent-teams`: coordination runtime, quality/autonomy-heavy.
- `apps/remote-server`: operational HTTP runtime.
- `apps/canvas-workspace`: existing app guidance and runtime harness are referenced instead of duplicated.
