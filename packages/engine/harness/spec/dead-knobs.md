# Spec: two env knobs are read but never change behavior

Both of these are env vars the code parses into config and then never acts on. They are not bugs in the "produces a wrong answer" sense — they are settings that silently do nothing, which is a contract question: should they *work*, or should they *not exist*? Deciding "wire it" vs "delete it" is a small judgement call each, so they sit here rather than in `known-defects.md`.

## 1. `CLARIFICATION_ENABLED` has no consumer

**Current state.** `src/config/index.ts:114` exports `CLARIFICATION_ENABLED = process.env.CLARIFICATION_ENABLED !== 'false'`. A repo-wide search finds **no other reference** — nothing reads the exported constant. The clarification feature runs regardless of this flag.

**Open question.** Was `CLARIFICATION_ENABLED` meant to gate the clarification path (wire it into that code), or is it a leftover from a removed/renamed feature (delete it, and drop `CLARIFICATION_*` from the env documentation in root `AGENTS.md` §7)?

**Why it needs a decision.** It is documented in root `AGENTS.md` §7 as a runtime key, so an operator can set `CLARIFICATION_ENABLED=false` expecting to turn clarification off — and nothing happens. That is a false-off switch: worse than an undocumented no-op, because the docs promise it works.

## 2. `PULSE_CODER_TOOL_SEARCH_VARIANT` reaches only a log line

**Current state.** `buildConfig()` reads `PULSE_CODER_TOOL_SEARCH_VARIANT`, validates it against `['regex','bm25']`, and stores it as `config.variant` (`src/built-in/tool-search-plugin/tool-search-plugin.ts:60-68`). But the plugin **registers both** tools unconditionally — `tool_search_tool_regex` and `tool_search_tool_bm25` (`:305-306`) — and each hardcodes its own variant at its call site (`:122` passes `'regex'`, `:134` passes `'bm25'`). The only place `config.variant` is consumed is the init logger (`:334`). Setting the env var to `regex` vs `bm25` changes nothing the LLM or a caller can observe.

**Open question.** Was `variant` meant to *select* which search tool is exposed (register one, not both, per the configured default) — or is exposing both tools always the intent, making `variant` (and its env var) dead config to remove?

**Why it needs a decision.** As with the other knob, it is a setting that looks live (validated, typed, logged) but is inert. If both-tools-always is correct, `variant` and `PULSE_CODER_TOOL_SEARCH_VARIANT` are surface to delete; if a default-selection was intended, the registration at `:305-306` is not honoring it. Either is fine — but it should be chosen, not left as a knob that quietly ignores its input.

---

**Verification.** Confirmed against source on the working branch (2026-07-07): `CLARIFICATION_ENABLED` sole definition and zero other references (`config/index.ts:114`, repo grep); tool-search variant read at `tool-search-plugin.ts:60-68`, both tools registered at `:305-306`, variant consumed only at logger `:334`.
