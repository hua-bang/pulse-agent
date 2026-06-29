---
name: contract-coding
description: Make package or runtime contract changes while keeping docs, types, tests, and consumers aligned.
---

# Contract Coding Skill

## Trigger

Use this when changing exported APIs, tool schemas, plugin hooks, runtime protocols, internal route payloads, workspace contracts, or cross-package behavior.

## Boundary

This skill is for contract-level changes. Implementation-only bug fixes can proceed with normal code workflow if the existing contract remains true.

## Steps

1. Identify the producer workspace and affected consumer workspaces.
2. Read producer `AGENTS.md` and `docs/contracts.md`.
3. Check whether TypeScript types, tests, README, or runtime docs are the current SSOT.
4. Update the contract source before or alongside implementation.
5. Update tests and consumer usage when the contract changes.
6. Apply `harness/validation.yaml` cross-package escalation rules.

## Output

- Contract changed or confirmed unchanged.
- Producer and consumer impact.
- Validation commands and results.
- Any compatibility or migration note.

## Validation

Contract changes must run producer checks and affected consumer checks when practical.
