---
name: check-renderer-structure
description: Audit Canvas Workspace renderer directory health, module ownership, dependency direction, colocation, and size pressure. Use when reviewing renderer architecture, planning a refactor, checking whether a move improved locality, or assessing module-first migration progress; not for runtime performance or visual QA.
---

# Check Renderer Structure

Read `harness/spec/renderer-modules/README.md` and
`harness/knowledge/conventions/frontend.md` before interpreting results. The
spec distinguishes current implemented structure from the module-first target.

Run from the repository root:

```bash
node apps/canvas-workspace/harness/skills/check-renderer-structure/scripts/check-renderer-structure.mjs
```

Use `--json` when another tool will consume the result. Use `--strict` only
when the user asks for target conformance or a module-first migration phase is
being accepted:

```bash
node apps/canvas-workspace/harness/skills/check-renderer-structure/scripts/check-renderer-structure.mjs --strict
```

Default mode is read-only and migration-aware. It reports pressure and target
gaps without failing merely because the planned structure is incomplete.
Strict mode exits non-zero for target gaps or dependency-direction violations.

## Interpret the report

- `boundaryErrors`: fix before accepting a module move. Cross-module imports
  must use the target module's root interface; shared/platform code cannot
  import upward.
- `businessComponentGroups`: current product visuals still grouped under root
  `components/`. They are migration candidates, not automatic defects.
- `legacyFeatureRoots`: feature ownership still split across renderer root
  folders.
- `flatComponentFiles`: inspect whether each non-trivial visual module needs
  an owner folder with local CSS, types, controller, and tests.
- `pressure`: use as investigation leads. Existing file-size governance is the
  authority; do not equate line count with shallow design.
- `separatedStyles` and `centralTests`: inspect ownership manually. Heuristics
  cannot prove CSS selector ownership or whether a test is genuinely
  cross-module.
- `boundaryCoverage`: when `modules/` is absent, zero dependency errors means
  "not yet applicable," not "healthy." `moduleCycles` becomes authoritative
  only after module roots exist.

Counts overlap and are migration signals, not a count of independent defects.
Human-readable output truncates long lists; use `--json` for a complete audit.

Apply the deletion test before recommending a split: deleting a useful deep
module should spread complexity back across callers. Avoid creating thin
pass-through files, compatibility barrels, generic managers, or adapters with
no second implementation.

Report findings as:

1. current structure facts;
2. target gaps;
3. the top three deepening opportunities, with exact files;
4. areas deliberately left alone because their interface already provides
   depth;
5. checks run and whether strict mode was appropriate.

Before ranking, inspect each candidate's source, caller count, public interface,
and direct tests. Do not copy the dated pressure table from the spec as if it
were current evidence.

Do not move files or update baselines unless the user asks for implementation.
When implementation is requested, use phased commits and the workspace's
`validate-canvas-change` skill for acceptance.
