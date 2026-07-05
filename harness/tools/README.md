# Harness Tools

`harness/tools` describes horizontal atomic capabilities. Tools can be used by checks, reports, humans, or future skills.

A tool should have stable inputs and outputs, but it does not own final decisions.

## Current Executable Tools

| Tool | Purpose |
|---|---|
| `graph-viewer` | Inspect harness coverage and validation routing. |

## Candidate Tool Ideas

These are ideas, not on-disk tool directories or executable protocols.

| Tool | Purpose |
|---|---|
| `repo-profiler` | Inspect active workspaces and suggest workspace `AGENTS.md` navigation updates. |
| `affected-workspace-detector` | Map changed paths or a user request to affected workspaces. |
| `ssot-resolver` | Pick the correct long-term source of truth for a fact or rule. |
| `feedback-router` | Route feedback to a proposal target based on evidence and scope. |
| `validation-planner` | Produce validation commands from affected workspaces and change type. |

Executable implementations may later live in `scripts/harness/`. Until then, these are protocol specs only.
