# Spec: is the current gating posture the intended contract?

The engine's *current* containment story is fully described in `knowledge/security-posture.md` — zero engine-level gating, host owns all sandboxing, plus two mechanisms (plan-mode, ptc) that look like gates but are not. That doc is the SSOT for **what is true now**. This entry records the three normative questions it raises: in each case the code's behavior and its apparent intent diverge, and someone with authority has to say which is the contract.

## 1. "Engine ships zero containment" — deliberate posture, or a gap to close?

**Current state.** No sandbox, no command allowlist, no filesystem-root confinement, no human-in-the-loop approval hook anywhere in the engine; every built-in tool (`bash`, `write`, `edit`, `read`, `grep`, MCP, sub-agents) runs at full host-process privilege (`knowledge/security-posture.md`, "The one rule").

**Open question.** Is "the host owns 100% of sandboxing" a deliberate, documented contract the engine promises to keep (so embedders can rely on the engine never adding its own gate) — or is the absence simply unfinished, with an approval hook expected later?

**Why it needs a decision.** This is the single most load-bearing assumption for every embedder. If it is a contract, it should be stated as one (and the skills/knowledge can point embedders at it with confidence). If it is a gap, adding an approval hook later changes the tool-execution path for all hosts and is a breaking behavior change — better decided before more consumers hard-code "no gate exists." Either answer is legitimate; leaving it implicit means each host re-derives it by reading source.

## 2. plan-mode: declared policy ≠ enforced policy

**Current state.** The planning-mode policy object declares `disallowedCategories: ['write', 'execute']` (`src/built-in/plan-mode-plugin/index.ts:64`). But the code that actually removes tools keys off a hardcoded name set `DISALLOWED_TOOLS_IN_PLANNING = new Set(['write', 'edit'])` (`:103`, applied at `:110`) — tool *names*, not categories. So in planning mode `write` and `edit` are removed, while `bash` and other `execute`-category tools stay callable, even though the declared policy says `execute` is disallowed. The `disallowedCategories` value is consumed only by `observePotentialPolicyViolation` (`:370`), which merely *emits an event* — it blocks nothing.

**Open question.** Which is the intended planning-mode policy — the declared one (`execute` should also be withheld, so the enforcement set is wrong) or the enforced one (only `write`/`edit` should go, so the declared `disallowedCategories` is misleading)?

**Why it needs a decision.** The two are contradictory and both are shipped. A host reading `disallowedCategories: ['write','execute']` reasonably believes `bash` is blocked in planning mode; it is not. This is a divergence between spec-as-written-in-code and behavior — resolving it is a policy call (how locked-down should planning mode be?), not an obvious bug fix, because either side could be the intended truth.

## 3. ptc `allowed_callers` unions typed + untyped allowlists

**Current state.** `resolveAllowedCallers` builds the effective allowlist by `addCallerToken`-ing both `tool.allowed_callers` and `tool.ptc.allowed_callers` into one `Set` (`src/built-in/ptc-plugin/ptc-plugin.ts:71,183-184`) — a **union**. Declaring both lists therefore *broadens* who may call the tool, never narrows it. ptc is registered last in the pipeline, so it only filters tools earlier stages left (`knowledge/security-posture.md`, "what little gating exists").

**Open question.** Is union the intended semantics (both fields are additive aliases for the same allowlist), or was intersection / precedence intended (the more specific `ptc.allowed_callers` should override or tighten the top-level one)?

**Why it needs a decision.** An author who sets a narrow `ptc.allowed_callers` expecting to *restrict* a tool that also has a broad top-level `allowed_callers` gets the opposite of their intent — the tool becomes callable by the union of both. If union is intended it must be documented loudly (it is a footgun); if not, the resolution logic is wrong. Because ptc is an exposure filter that some hosts may lean on, the semantics have to be stated deliberately.

---

**Verification.** Confirmed against source on the working branch (2026-07-07): plan-mode declared vs enforced (`plan-mode-plugin/index.ts:64` vs `:103,110`; observation-only consumer at `:370`); ptc union (`ptc-plugin.ts:71,183-184`, `addCallerToken` into a shared `Set`). The zero-gating posture is the standing description in `knowledge/security-posture.md`.
