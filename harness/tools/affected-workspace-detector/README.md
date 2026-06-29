# Affected Workspace Detector Tool

## Purpose

Map changed paths or a user request to the workspaces likely affected by a task.

## Inputs

- Changed file paths, git diff paths, or user-described target area.
- `harness/profile.yaml` workspace map.
- Optional package dependency hints.

## Output

- affected workspaces
- producer/consumer relationships when known
- confidence level
- paths that could not be mapped

## Non-goals

- Does not decide validation by itself; use `validation-planner` for that.
- Does not review code correctness.
