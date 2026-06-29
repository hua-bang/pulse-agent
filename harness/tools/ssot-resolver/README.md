# SSOT Resolver Tool

## Purpose

Choose the long-term source of truth for a piece of repository knowledge.

## Inputs

- Knowledge type: navigation, architecture, contract, behavior, validation, action, feedback, runbook, or history.
- Scope: repository, workspace, app, package, runtime, single case.
- Evidence paths.
- `harness/README.md` knowledge routing table.
- Affected workspace entry file.

## Output

- recommended target path
- fallback target if the primary path does not exist
- whether the information should be mechanism-backed by tests/checks/hooks
- whether the item should remain only as a proposal or inbox item

## Non-goals

- Does not write the target file.
- Does not override human ownership decisions.
