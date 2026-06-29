# Harness Tools

`harness/tools` describes horizontal atomic capabilities. Tools can be used by skills, checks, feedback, reports, or humans.

A tool should have stable inputs and outputs, but it does not own final decisions. Skills compose tools and make workflow decisions.

## Current Tool Specs

| Tool | Purpose |
|---|---|
| `repo-profiler` | Build or refresh the repository map used by `harness/profile.yaml`. |
| `affected-workspace-detector` | Map changed paths or a user request to affected workspaces. |
| `ssot-resolver` | Pick the correct long-term source of truth for a fact or rule. |
| `feedback-router` | Route feedback to a proposal target based on evidence and scope. |
| `validation-planner` | Produce validation commands from affected workspaces and change type. |

Executable implementations may later live in `scripts/harness/`. Until then, these are protocol specs only.
