# Validation Planner Tool

## Purpose

Produce a validation plan from affected workspaces and change type.

## Inputs

- Affected workspaces.
- Changed paths.
- Change type: docs-only, contract, runtime, config, test, app interaction, or release.
- `harness/validation.yaml`.
- Workspace `docs/validation.md` when present.

## Output

- required commands
- optional commands
- manual/runtime checks
- escalation reason
- skipped checks and why

## Non-goals

- Does not execute commands.
- Does not decide whether failed checks can be ignored.
