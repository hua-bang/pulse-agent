# canvas-workspace Spec

Currently **empty — the success state**, not a placeholder waiting to be filled.

Surface definition (what qualifies as an entry, entry shape, lifecycle) lives in `packages/engine/harness/spec/README.md` — reused by pointer, not copied, per SSOT.

## What's landed here before

Two entries ran the full lifecycle — decided, mechanized/encoded, deleted:

| Entry | Decision | Landed in |
|---|---|---|
| `ui-reuse-unification.md` (2026-07-07) | Unify basic UI capabilities on a blessed `components/ui/` set; new-code ratchet, radius/color/shadow tokens gated | `src/main/__tests__/ui-reuse-governance.test.ts`, `components/ui/`, `harness/knowledge/conventions/frontend.md` |
| `node-extension-path.md` (2026-07-08) | Plugin nodes are the default extension path; host `CanvasNode['type']` union is the exception, reserved for nodes needing main-process integration beyond the plugin capability registry (persistent session/IPC channel, dedicated storage migration) | `harness/skills/add-canvas-node/SKILL.md`, `AGENTS.md` Local Constraints |

Both are gone from this directory on purpose — see git history for the original evidence and reasoning. Add a new entry only when current state ≠ intended state AND the right answer is a genuine judgement call (not a bug, not already obvious) — see the linked README for the admission rule.
