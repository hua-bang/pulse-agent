# Spec: which node-extension path is sanctioned — host type or plugin?

> Surface definition (what qualifies as a spec entry, entry lifecycle):
> `packages/engine/harness/spec/README.md`. Same admission rule here:
> current ≠ intended AND the answer is a genuine judgement call. An empty
> `spec/` is the success state.

**Current state.** Two extension paths for canvas nodes coexist:

1. **Host types** — `CanvasNode.type` is a closed 13-member union
   (`src/shared/canvas.ts`). Adding one touches at least four places: the
   type union, the `data` shape union, `createNodeData` in
   `src/renderer/src/utils/nodeFactory.ts` (verified total against the union
   by `harness/tools/describe-canvas.mjs`), and the renderer body dispatch
   under `src/renderer/src/components/CanvasNodeView/` — plus persistence
   compatibility (node data is stored as workspace JSON).
2. **Plugin nodes** — stable host type `'plugin'` with plugin-owned
   `data.nodeType`/`payload`, resolved through renderer/main plugin
   registries (`harness/knowledge/plugin-node-mf2.md`, which introduces
   itself as "the first vertical slice for **custom canvas nodes**").

`AGENTS.md` Local Constraints lean plugin-ward ("Host behavior should go
through renderer/main plugin registries and declared capabilities"), yet the
host union has kept growing — `mindmap`, `shape`, `reference`, `dynamic-app`
all became first-class host types while the plugin mechanism existed. No doc
states a criterion for which path a new node capability should take.

**The open question.** When someone needs a new node capability, which is the
sanctioned route — extend the host union (first-class, four-site change,
schema-visible to every consumer of `shared/canvas.ts`), or ship it as a
plugin `nodeType` (registry-isolated, but boxed into the `plugin` type's
capability model)? And if both remain legitimate, what is the criterion —
e.g. "host type only when the node needs main-process integration beyond the
plugin capability registry (PTY, storage migration, dedicated IPC domain)"?

**Why it needs a decision.** The cold-start navigation audit (2026-07-07)
showed an agent tasked with "add a new node type" cannot determine from the
harness whether that is even the right move — the strongest documented rule
points at plugins, the strongest precedent (13 types and counting) points at
host types. Every future node feature re-litigates this silently; the two
paths have different blast radii (schema/persistence/agent-tool contracts vs
registry-local), so the choice is architectural, not stylistic. Reasonable
maintainers could pick either default — which is exactly what makes it a
spec entry rather than a defect.

**Verification.** Union members and factory totality machine-checked by
`node apps/canvas-workspace/harness/tools/describe-canvas.mjs` (union 13 =
factory 13, in sync, 2026-07-07); plugin contract framing at
`harness/knowledge/plugin-node-mf2.md:1-14`; plugin-ward constraint in
`AGENTS.md` Local Constraints.
