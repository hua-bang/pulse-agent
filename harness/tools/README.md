# Harness Tools

`harness/tools` describes horizontal atomic capabilities. Tools can be used by checks, reports, humans, or future skills.

A tool should have stable inputs and outputs, but it does not own final decisions.

## Current Executable Tools

| Tool | Purpose |
|---|---|
| `run-harness-check` (`scripts/harness/run-harness-check.mjs`) | Resolve changed paths to bound validation commands and execute them with a pass/fail report. |
| `check-harness` (`scripts/harness/check-harness.mjs`) | Drift check: entry/validation coverage per workspace, validation file shape, command/package references, and routing links in harness docs. |

Both entrypoints use `scripts/harness/validation-data.mjs` for YAML/schema validation and workspace discovery. Install the root development dependencies with pnpm before running them. Invalid versions, duplicate keys/rules, unknown fields, and invalid command tiers fail explicitly.

Command-reference inspection checks literal Node targets, named package scripts, and concrete Vitest/tsc paths from the repository root (or selected package for pnpm exec). It supports simple quoted arguments and ordered `&&` steps. It never runs configured commands during a drift scan, does not inspect package script bodies, and does not prove behavioral coverage. Unsupported shell/executable forms are listed under `uninspectedCommands`; they are not counted as verified references or structural failures. The runner preflights all selected references before executing the first check.

Use --deep-docs for diagnostic inspection of explicit Markdown links and source citations in workspace Knowledge/Skills. Markdown links resolve relative to the document; source citations use their owner and uniquely matching tracked source suffixes. Runtime-generated paths, marked history, external URLs, and code examples are excluded; tracked sources under normally generated directories remain checkable. Ambiguous shorthand stays labelled as a diagnostic rather than a missing-file claim. docWarnings do not affect harnessGaps or block a run.

Use --json for a single machine-readable result containing both summary fields and the gaps array, including on structural failure.

entryMetrics reports full AGENTS lengths and the root + shared harness intro + workspace reading chain in UTF-16 code units. These counts measure the documented reading path, not actual model tokens or automatic prompt injection. Size is informational at every level and does not affect harnessGaps. Entry admission and maintenance follow DESIGN.md's content principles; semantic review remains a judgment, not an automated checker claim.

## Candidate Tool Ideas

These are ideas, not on-disk tool directories or executable protocols.

| Tool | Purpose |
|---|---|
| `repo-profiler` | Inspect active workspaces and suggest workspace `AGENTS.md` navigation updates. |
| `ssot-resolver` | Pick the correct long-term source of truth for a fact or rule. |
| `feedback-router` | Route feedback to a proposal target based on evidence and scope. |

Executable implementations may later live in `scripts/harness/`. Until then, these are protocol specs only.
