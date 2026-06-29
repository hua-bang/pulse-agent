---
name: quality-workflow
description: Select validation depth and collect evidence for repository changes based on affected workspaces and change type.
---

# Quality Workflow Skill

## Trigger

Use this when planning validation for a change, preparing a handoff, or deciding whether targeted checks are enough.

## Boundary

This skill chooses checks and evidence. It does not review the diff for bugs; use `code-review.md` for review behavior.

## Required Inputs

- Changed paths or intended change scope.
- Whether public contracts, runtime behavior, config, or docs changed.
- Available local environment constraints.

## Steps

1. Detect affected workspaces using `harness/profile.yaml`.
2. Read the workspace `docs/validation.md` when present.
3. Apply `harness/validation.yaml` path rules and escalation rules.
4. Prefer targeted checks first, then cross-workspace checks when contracts or shared runtime behavior change.
5. Clearly separate automatic checks from manual/runtime smoke checks.
6. Record skipped checks with reason.

## Output

- Affected workspace list.
- Required checks.
- Optional/manual checks.
- Evidence collected and remaining risk.

## Validation

A completed task should state what was run, the result, and why skipped checks were skipped.
