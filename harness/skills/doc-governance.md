---
name: doc-governance
description: Govern repository and workspace documentation so entries route to a single source of truth without duplicating rules.
---

# Doc Governance Skill

## Trigger

Use this when adding, renaming, moving, or restructuring `AGENTS.md`, `CLAUDE.md`, workspace docs, `harness/*`, or documentation indexes.

## Boundary

This skill governs documentation structure and routing. It does not implement code, CI, hooks, or runtime tools.

## Required Inputs

- The user goal or feedback that requires documentation changes.
- Affected workspace or repository area.
- Existing source of truth from `harness/README.md`, root entries, and the affected workspace entry.

## Steps

1. Read root `AGENTS.md` and `harness/README.md`.
2. Use `harness/profile.yaml` to identify affected workspace entries.
3. Use the `harness/README.md` knowledge routing table and affected workspace entry to choose one source of truth.
4. Prefer updating an existing entry over creating a new one.
5. Keep root entries as routers; put details in workspace docs or harness skill/tool files.
6. If a rule is stable and enforceable, consider whether a future `harness/checks` item is more appropriate than more prose.

## Output

- Changed files and why each file is the correct SSOT.
- Any intentionally deferred entry or check.
- Verification performed.

## Validation

- Referenced paths exist or are explicitly marked deferred.
- No rule body is copied into multiple locations.
- YAML files remain structural, not prose-heavy.
