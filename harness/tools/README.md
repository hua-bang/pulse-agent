# Harness Tools

`harness/tools` describes horizontal atomic capabilities. Tools can be used by checks, reports, humans, or future skills.

A tool should have stable inputs and outputs, but it does not own final decisions.

## Current Executable Tools

| Tool | Purpose |
|---|---|
| `run-harness-check` (`scripts/harness/run-harness-check.mjs`) | Resolve changed paths to bound validation commands and execute them with a pass/fail report. |
| `check-harness` (`scripts/harness/check-harness.mjs`) | Drift check: entry/validation coverage per workspace, validation file shape, `--filter` names reference real packages. |

## Candidate Tool Ideas

These are ideas, not on-disk tool directories or executable protocols.

| Tool | Purpose |
|---|---|
| `repo-profiler` | Inspect active workspaces and suggest workspace `AGENTS.md` navigation updates. |
| `ssot-resolver` | Pick the correct long-term source of truth for a fact or rule. |
| `feedback-router` | Route feedback to a proposal target based on evidence and scope. |

Executable implementations may later live in `scripts/harness/`. Until then, these are protocol specs only.
