# Engine Spec

Normative decisions where the engine's **current** behavior may not be its **intended** behavior — and a human has to decide which one is right.

## What belongs here (and what does not)

This surface exists because three different things kept getting confused during the harness build:

| Surface | Question it answers | Mood |
|---|---|---|
| `knowledge/` | What is true *now*? | descriptive (現狀) |
| `spec/` (here) | What *should* be true, when that is undecided? | normative, decision-pending (應然) |
| `skills/` | *How* do I safely make a change? | procedural (HOW) |

A spec entry is admitted only when **current ≠ intended AND the intended state is a genuine judgement call** — reasonable maintainers could pick either answer, so someone with authority must decide. That is the line against the other surfaces:

- If current = intended, it is just **knowledge** (describe it there, not here).
- If current ≠ intended but the correct answer is obvious (a bug — everyone agrees it should be fixed, no decision needed), it is a **defect**, not a spec. Confirmed-but-unfixed defects live in `knowledge/known-defects.md`.
- If the entry starts telling you *how* to change the code, it has drifted into **skill** territory — move the steps out.

This mirrors spec-kit's own split: a spec carries WHAT + WHY (intent), and deliberately excludes HOW (which lives in the plan/tasks ≈ our skills). These entries are the *record* of undecided intent, not a generator.

## Entry shape

Every entry states, in this order:
1. **Current state** — with `file:line` evidence, pointing to the `knowledge/` doc that already describes it (do not restate facts; SSOT-no-copies).
2. **The open question** — the WHAT-should-be that is undecided.
3. **Why it needs a decision** — the consequence of leaving it ambiguous.
4. **Verification** — how the current-state claim was confirmed, and when.

No fix steps. When a decision is made, the outcome becomes a code change + a `knowledge/` fact (or a `known-defects.md` line if it turns out to be a plain bug), and the spec entry is deleted. An empty `spec/` is the success state, not a failure.

## Index

| Entry | Undecided question |
|---|---|
| `public-surface.md` | What is the engine's intended public API — and are four current exports intended contracts or accidents? |
| `user-config.md` | Should declarative user-config be implemented, or removed? The loader is an inert stub. |
| `gating-posture.md` | Is "engine ships zero containment" a deliberate contract, and do plan-mode / ptc mean what they appear to? |
| `dead-knobs.md` | Two env knobs are read but never change behavior — wire them or delete them? |

Provenance: these were surfaced by a multi-model deep scan of `packages/engine` during the harness build and each was re-verified against source before being written here. Status is recorded per entry.
