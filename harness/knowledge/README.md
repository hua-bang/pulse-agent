# Harness Knowledge

`harness/knowledge` is the index for the **Knowledge** surface: what the agent is facing — facts, structure, contracts, risks, and impact relationships.

This directory is an index, not a copy. Knowledge in this repo is distributed across SSOTs that already exist. Read this README to find where to look; do not duplicate facts here.

## Mapping

| Knowledge | Default SSOT |
|---|---|
| Repository navigation, meta-rules, precedence | Root `AGENTS.md` / `CLAUDE.md` (§0–§3) |
| Auxiliary-workspace boundary, active workspace set | Root `AGENTS.md` §3 + `pnpm-workspace.yaml` |
| Workspace role, routing, and curated knowledge pointers | Workspace `AGENTS.md` and local `docs/` |
| Security / secrets / runtime key precedence | Root `AGENTS.md` §7 |
| Named failure captures and their guards | Root `AGENTS.md` §6 |
| Package contracts, module boundaries | Workspace `AGENTS.md` + `harness/knowledge/contracts.md` if present, otherwise local docs/types/tests |
| App behavior spec | Workspace `AGENTS.md` or `CLAUDE.md`; `docs/spec/` only when behavior needs durable product-level SSOT |
| Runtime operation | Workspace `docs/runbook.md` or local entry file |
| Topic deep-dives (harness, mcp-plugin, memory-plugin, plan-mode, plugin-system) | Root `docs/<topic>/` |

## What does not belong here

- Validation rules: route to `harness/validate/` or `harness/validate/validation.yaml`.
- Agent action protocols: add `harness/skills/` only when a stable recurring workflow justifies it.
- Mechanical tool specs: route to `harness/tools/`.
- Module-local facts: keep near the module (workspace `docs/` or `AGENTS.md`).

## When to add a file under `harness/knowledge/`

Per `harness/DESIGN.md` rollout order, add a dedicated Knowledge file only when a root or module entry starts accumulating detailed facts that no existing SSOT carries. The first move is always to route to or extend an existing SSOT; split a file out only when the entry becomes too dense.

If you add a file, name it for the fact class (e.g. `risk-map.md`, `impact-graph.md`) and link it from this README.
