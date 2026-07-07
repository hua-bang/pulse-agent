# Spec: the intended public API surface

The engine's public surface grew by accretion. Four exports are live today whose *intent* is unclear — each could be a deliberate contract or an accident that consumers have since pinned. Because `src/index.ts` and `src/built-in/index.ts` are the package's contract with 8 consumers (see `knowledge/contracts.md`, Known Consumers), guessing wrong in either direction is expensive: removing a real contract breaks consumers; keeping an accident forces it to be maintained forever.

The current shape (barrel asymmetry, the consumer matrix) is documented in `knowledge/contracts.md` — this entry only records what is *undecided* about it.

## 1. `PulseEngineInstance` is exported despite a "do not expose" intent

**Current state.** `src/shared/types.ts:108` carries the comment `// Engine instance, 不能直接暴露实际例子，只能通过插件上下文获取` ("must not be exposed directly; only reachable via plugin context"), yet the interface on the next line is re-exported to the world by the `export * from './shared/types.js'` wildcard in `src/index.ts:72`.

**Open question.** Is the type meant to be public (delete the comment, treat it as a contract), or is the comment the real intent (narrow the wildcard so the *instance shape* stays internal while plugin-context access remains the only door)? The two readings contradict each other and both are load-bearing.

**Why it needs a decision.** As long as it is wildcard-exported, any consumer can depend on the concrete instance shape — which is exactly what the comment says must not happen. Every field added to `PulseEngineInstance` silently becomes public. The `export *` makes this invisible at the barrel; nobody chose it deliberately.

## 2. `./types` package subpath is a byte-identical duplicate of `.`

**Current state.** `package.json` defines `"./types"` (lines 18-22) with the same `types`/`import`/`require` targets as the root `"."` export (lines 10-13) — `./dist/index.d.ts`, `./dist/index.js`, `./dist/index.cjs`. Importing `pulse-coder-engine/types` and `pulse-coder-engine` resolve to the same module.

**Open question.** Is `./types` a supported alias some consumer relies on, or vestigial? (There is also a `./src` subpath at lines 14-17 pointing at raw TS — a separate, deliberate-looking escape hatch, not part of this question.)

**Why it needs a decision.** A duplicate subpath export is a maintenance trap: future export changes must be mirrored across two entries or the two paths silently diverge. If no consumer imports `/types`, it is dead surface to remove; if one does, it is an undocumented contract to record. Neither is known today.

## 3. Four plugin/factory exports exist on `./built-in` but not on `.`

**Current state.** `describe-engine.mjs` reports the main barrel omits four names the built-in barrel exports: `SubAgentPlugin`, `builtInToolSearchPlugin`, `createMcpPlugin`, `createSkillsPlugin`. remote-server and canvas import `./built-in` directly and hand-assemble plugin lists, so they see these; a consumer importing only `.` does not. (Asymmetry mechanics: `knowledge/contracts.md`, Public Surface.)

**Open question.** Is the narrower main barrel intended (these four are "advanced, reach via `./built-in`"), or did they simply never get promoted to `.`? i.e. is `./built-in` ⊃ `.` a designed tier, or drift?

**Why it needs a decision.** Skill `add-builtin-plugin.md` step 5 tells authors to "export from BOTH barrels … unless the omission is intentional and noted." That instruction cannot be honored until *someone records which omissions are intentional*. Right now the author has to guess, and the honest default (export from both) may re-add something that was deliberately withheld.

## 4. `deferDemoTool` ships in the production tool registry

**Current state.** `src/tools/index.ts:11,27` imports `deferDemoTool` and includes it in `BuiltinTools`. It is array-only (not named-exported) — a demonstration tool for the defer-loading path — but it ships in every host's registry (`describe-engine` lists it under `BuiltinTools`, deferred).

**Open question.** Should a demo tool be in the default production registry, or gated behind a flag / removed for shipping builds?

**Why it needs a decision.** It is an LLM-visible-on-search tool with no product purpose; it widens the tool surface and the security posture (`knowledge/security-posture.md`) for every embedder by one tool that exists only to exercise deferral. Keeping it is defensible (harmless, documents the mechanism); the point is that *nobody chose* to ship it — it needs an explicit keep/gate/remove call.

## 5. Orchestrator team-run types are part of the engine's public type surface

**Current state.** `src/index.ts:62-67` re-exports `TeamRole`, `TaskGraph`, `TaskNode`, `NodeResult`, `TeamRunInput`, `TeamRunOutput` from `./built-in/index.js` (which sources them from the orchestrator). The engine's public `.d.ts` therefore encodes the orchestrator's team-run data shapes.

**Open question.** Is agent-teams a first-class part of the engine's public contract (then these belong and should be documented as such), or an internal integration that leaked its DTOs onto the barrel?

**Why it needs a decision.** This couples the engine's public API to orchestrator-owned types: an orchestrator refactor to `TaskGraph`/`TeamRunInput` becomes a breaking change to `pulse-coder-engine`'s published types. It also interacts with the `tsconfig.json` no-`rootDir` decision (the agent-teams built-in already reaches orchestrator *source* through the path alias — see `packages/engine/AGENTS.md` Local Constraints). Whether that coupling is intended governs how freely the orchestrator can evolve.

---

**Verification.** All five confirmed against source on the working branch (2026-07-07): comment + wildcard export (`shared/types.ts:108-109`, `index.ts:72`); duplicate subpath (`package.json:10-22`); barrel omits (`describe-engine.mjs` output: 4 `mainBarrelOmits`); `deferDemoTool` registry membership (`tools/index.ts:11,27`); team-type re-exports (`index.ts:62-68`).
