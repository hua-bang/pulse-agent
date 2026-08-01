---
name: slim-agents-md
description: Use when a root or workspace AGENTS.md has grown overweight — router table rows or constraint bullets carrying multi-sentence mechanism prose instead of short pointers — and needs inline knowledge extracted into harness/knowledge/ without losing any fact. Covers root AGENTS.md and every workspace AGENTS.md.
---

# Slim an AGENTS.md

Move inline mechanism prose out of a router file (root `AGENTS.md` or a workspace `AGENTS.md`) into that content's owning `harness/knowledge/` file, leaving a short pointer behind. The router keeps routing; the knowledge file keeps the facts. No fact may be lost in the move — this is a relocation, not a summary.

This is the repo action protocol for the extraction already applied once to `apps/canvas-workspace/AGENTS.md` (knowledge moved into `apps/canvas-workspace/harness/knowledge/*.md`; read that file's git history for a full worked example before your first pass). Apply the same procedure to any other workspace `AGENTS.md` — or root `AGENTS.md` itself — once it shows the same weight symptoms.

## When to Use

- A router table row or constraint bullet has grown into multi-sentence mechanism prose (the WHY and the HOW, not just the WHAT and WHERE) — see Measurement for a concrete signal.
- `node scripts/harness/check-harness.mjs` reports a `router-weight` gap: a line in root or a workspace `AGENTS.md` over `ROUTER_WEIGHT_THRESHOLD` (see that constant's comment in `scripts/harness/check-harness.mjs` for the current value and ratchet plan). It rides the same overlay glob — `harness/**`, `AGENTS.md`, `**/AGENTS.md`, `**/harness/**` — that already runs it for every AGENTS.md/harness change; see the `harness-data` rule in root `harness/validate/validation.yaml`.
- A maintainer explicitly asks to slim, trim, or extract knowledge from an AGENTS.md file.

Do not use it to manufacture work. Most workspace `AGENTS.md` files are currently well under the ceiling in Measurement — extraction is justified by measured weight, not by a general tidiness impulse.

## The Three-Layer Placement Test

For every candidate row or bullet, classify each fact it carries into exactly one layer. Do not leave a fact sitting in the router once it has a layer-2 or layer-3 home.

1. **Router** (`AGENTS.md`, stays inline) — a routing decision or a one-sentence rule: WHICH file to read for WHAT task, or WHAT outcome a constraint enforces. Short enough to scan in a table row or a one-line bullet.
2. **Harness-knowledge** (`harness/knowledge/<topic>.md`, extracted) — the WHY and the HOW: mechanism explanation, history, edge cases, the multi-sentence reasoning that makes the rule make sense. If a sentence explains a mechanism rather than naming a destination, it belongs here, not in the router.
3. **Tests-and-types** (referenced, never restated) — the enforcement that already lives in the codebase: a test file, a type contract, or a `harness/validate/validation.yaml` rule. Point at it (`Guard: <path>`); do not re-explain in prose what the test already proves mechanically. Restating a test's logic in Markdown creates a second, driftable copy of a fact a machine already enforces.

This mirrors root `AGENTS.md` §0 rule 5's own self-check ("Can this be a mechanism — type / lint / test / hook / script — rather than a doc line? If only doc, is the reason stated?"), applied specifically to router weight.

One placement wrinkle: the owning `harness/knowledge/` directory is the content's *subject* workspace, which is not always the file being edited. When root `AGENTS.md` documents a workspace-specific failure (its §6 Failure Capture), the Detail pointer targets that workspace's `harness/knowledge/`, never a new root-level knowledge file — root `harness/knowledge/` is an index only (its own `README.md`: "This directory is an index, not a copy"). Root `AGENTS.md` §6's keyboard-shortcuts entries already point at `apps/canvas-workspace/harness/knowledge/keyboard-shortcuts.md` on this basis; follow the same rule for any other root-level, workspace-specific fact.

## Measurement

Router weight is a proxy for "this row stopped routing and started explaining." Two commands, run from repo root.

Repo-wide scan — which `AGENTS.md` files carry the longest lines right now:

```bash
for f in $(git ls-files '*/AGENTS.md' 'AGENTS.md'); do
  echo "$(awk '{print length}' "$f" | sort -rn | head -1)  $f"
done | sort -rn
```

Per-file map — once a file is targeted, find its exact offending rows/bullets by line number:

```bash
awk '{ print length, NR }' <path-to-AGENTS.md> | sort -rn | head -20
```

Working ceiling: a router table row should read comfortably at or under **700 characters**. The `Dock web tabs` row in `apps/canvas-workspace/AGENTS.md` — the closest thing this repo has to a template row — sits at 460. A constraint bullet's RULE line should be one sentence; needing a second sentence to state the mechanism, not just the outcome, marks a layer-2 candidate.

Treat 700 as a working ceiling for judgment, not a constant to defend. The authoritative, evolving gate is `ROUTER_WEIGHT_THRESHOLD` in `scripts/harness/check-harness.mjs` (800 as of this writing — the 810 mid-ratchet closed when root `AGENTS.md` §6's long bullets moved into their owning workspaces' `harness/knowledge/`; read that constant's own comment before quoting a number from this skill). That check measures JS string length (UTF-16 code units); `awk`'s byte-oriented `length` reads slightly higher on lines with em dashes, arrows, or CJK text, which this repo's AGENTS.md files use — treat `awk`'s numbers as directional for finding candidates, and let `check-harness.mjs` make the actual call.

## Extraction Protocol

1. **Read the whole target file** and run Measurement to list candidate rows/bullets.
2. **Classify each candidate** with the Three-Layer Placement Test. Most rows split: a short routing sentence stays (layer 1), the mechanism explanation moves (layer 2), any test-backed claim gets pointed at instead of restated (layer 3).
3. **Find or create the owning knowledge file** — `<workspace>/harness/knowledge/<topic>.md` (for a root-level fact about a specific workspace, target that workspace's directory, not root's index-only one — see the placement wrinkle above). Reuse an existing topic file over creating a new one when the subject already has a home: `apps/canvas-workspace/harness/knowledge/chat-sessions.md` backs five different router rows rather than five new files. Create the `harness/knowledge/` directory itself if the workspace has none yet.
4. **Move the prose verbatim.** Light reformatting into knowledge-file style is fine; deleting specifics, numbers, gotchas, or "why" reasoning is not.
5. **Verify every concrete path** referenced in both the old prose and the new knowledge file still exists on disk (`Read`/`ls`, or let `check-harness.mjs`'s routing-links check do it — see Verification). A path that no longer resolves is a stale fact, handled by the next step, not silently dropped.
6. **Flag stale facts; do not silently fix them.** If extraction surfaces a claim that contradicts current source (a renamed file, a described behavior the code no longer matches), leave it visibly flagged in the knowledge file (e.g. a leading "STALE — verify:" note) or call it out to the requester. Silently "correcting" a fact you have not independently verified against source risks encoding a second wrong answer with more confidence than the first.
7. **Replace the original with a pointer.**

   Table row (model: the `Dock web tabs` row in `apps/canvas-workspace/AGENTS.md`), kept at or under the 700-character ceiling:

   ```
   | <Task/topic> | Read `harness/knowledge/<topic>.md` before <the specific trigger condition>. Key contracts: `<path-1>`, `<path-2>`. Tests: `<test-1>`, `<test-2>`. |
   ```

   Constraint bullet (model: the workspace-local chat-sessions/agent-roles bullets in `apps/canvas-workspace/AGENTS.md` §Local Constraints):

   ```
   - <One-sentence RULE — the outcome/constraint, not the mechanism>.
     Guard: `<test-file-1>`, `<test-file-2>`.
     Detail: `harness/knowledge/<topic>.md`.
   ```

   Root `AGENTS.md` §6 sometimes merges the last two lines into one — `Detail + guards: <path>.` — when the guard list is already itemized inside the linked knowledge file. Both forms are acceptable; do not force the two-line form where it would just repeat what the knowledge file already lists. Omit `Guard:` entirely when nothing currently tests the rule mechanically — do not invent a test reference; an untested rule being weaker than a tested one is worth stating, not worth hiding.
8. **Re-measure** the touched rows/bullets — confirm the router actually lost weight, not just gained a pointer alongside the old paragraph (see Anti-Regression).

## Verification Protocol

1. **Fact-preservation audit.** Diff against the last known-good state and confirm every removed sentence survived somewhere:

   ```bash
   git show HEAD:<path-to-AGENTS.md> > /tmp/before.md
   diff /tmp/before.md <path-to-AGENTS.md>
   ```

   For every `-` line in that diff, find its content again — inline in the shortened row/bullet, or in the knowledge file's prose. A fact present in neither is a regression, not a simplification.
2. **Path audit.** Every backticked, repo-path-shaped token in the touched files must resolve on disk. `check-harness.mjs`'s routing-links check does this mechanically for tokens starting with `packages/`, `apps/`, `harness/`, `scripts/`, `docs/`, `.github/`, or `.pulse-coder/`; spot-check anything else by hand (bare tokens like `src/...` are outside that prefix set by design and need a manual look).
3. **Run the harness check**, repo root:

   ```bash
   node scripts/harness/check-harness.mjs
   ```

   Must report `"harnessGaps": 0`. This covers entry/validation coverage, dangling routing links, and router weight (see Anti-Regression). A gap here is authoritative — fix it before finishing, do not explain it away.
4. **Run the affected workspace's bound checks** only if anything beyond Markdown changed (it usually has not) — its own `harness/validate/validation.yaml` names them. A pure knowledge-extraction pass is typically Markdown-only and needs no build/test/typecheck run, but confirm rather than assume.
5. **Keep the footprint honest.** `git diff --stat` should show only the files the request actually asked for — a root `AGENTS.md` edit in particular is often scoped to one exact section; do not let a slimming pass sprawl into unrelated parts of the file.

## Anti-Regression

- **Router-weight threshold.** This skill exists to reduce a measured weight, not to relocate prose cosmetically. "Extracted but not shrunk" — copying the paragraph into a knowledge file while leaving the original row just as long, pointer bolted on top — is the failure mode to watch for. Re-run Measurement on the touched rows after every pass and confirm they actually got shorter. Two backstops cover this so it does not rely on one pass of manual discipline: `check-harness.mjs`'s `router-weight` check (a numeric gate that evolves independently of this document — it has already moved twice — implicit "no check" → `810` → `800` when root `AGENTS.md` §6's long bullets moved out to their owning workspaces; re-run it, do not assume a threshold documented here is still current) and this skill's own re-measurement step, which gives immediate feedback every time it runs.
- **The write-back routing rule.** Root `AGENTS.md` §6's write-back sentence — new fact routes to the nearest owning doc, "but never inline multi-sentence knowledge into a router table row or constraint bullet: put it in that workspace's `harness/knowledge/` file (create one if missing) and leave a pointer row" — is what stops a slimmed file from regrowing the same weight one task at a time. This skill is the retrofit for files that are already overweight; the write-back rule is the standing prevention for every task from here on. Keep the two in sync: if this skill's pointer-row or constraint-bullet format changes, check whether §6's sentence needs the same update, and vice versa. A drift between the one-line summary and the full procedure is exactly the duplicate-rule problem root `AGENTS.md` §0 rule 2 (SSOT, no copies) warns about.

## Done When

- Every touched row/bullet is at or under the working ceiling in Measurement, or carries a stated reason it cannot shrink further.
- Every fact the original prose stated still exists somewhere — inline pointer or knowledge file — confirmed by the fact-preservation audit, not assumed.
- Every backticked, repo-path-shaped token in the touched files resolves on disk.
- `node scripts/harness/check-harness.mjs` reports `harnessGaps: 0`.
- Stale facts found mid-pass are flagged in place, never silently corrected or silently dropped.
- The diff footprint matches what was actually asked for.
