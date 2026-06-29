# Repo Profiler Tool

## Purpose

Build or refresh the machine-readable repository map in `harness/profile.yaml`.

## Inputs

- Workspace manifests: `package.json`, `pnpm-workspace.yaml`, workspace `package.json` files.
- Existing entries: root `AGENTS.md`, root `CLAUDE.md`, workspace `AGENTS.md` or `CLAUDE.md`.
- Known docs: README, contracts, validation, runbooks, specs, history.

## Output

A proposed `workspaces` entry with:

- path
- type
- package name
- short role label
- entry file
- knowledge file paths

Validation commands should not be emitted into `profile.yaml`; use `harness/validation.yaml` and workspace `docs/validation.md`.

## Non-goals

- Do not infer detailed contracts from source code.
- Do not create docs automatically without doc governance review.
- Do not duplicate validation matrices or long module descriptions.
