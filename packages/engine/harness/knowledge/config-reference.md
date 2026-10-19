# Config Knob Reference

Every tunable the engine reads, with defaults and read sites. All `config/index.ts` constants resolve ONCE at module import (after `dotenv.config()`); later `process.env` mutations are ignored except through `buildProvider()` overrides.

## Model & Provider Resolution

- Model: `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL` → hardcoded `novita/deepseek/deepseek_v3` (`DEFAULT_MODEL`, `config/index.ts`).
- Provider: `USE_ANTHROPIC`/`PULSE_USE_ANTHROPIC` truthy → Anthropic SDK, else OpenAI `.responses` (`CoderAI`). `buildProvider(type, {apiKey, baseURL, headers})` builds either explicitly. Every request path (streaming, summaries, `generateTextAI`) resolves through `resolveProvider(provider, modelType)`: explicit factory, then the env provider for `modelType` (built once per type), then `CoderAI`. `Engine.resolveModelConfig` applies per-run over constructor values and always forwards `modelType`.
- The env-built Anthropic provider sends `User-Agent: pulse-coder/<engine version>` (`DEFAULT_USER_AGENT`; the version is injected by tsup, `dev` from source). `PULSE_USER_AGENT` or `buildProvider(..., { headers })` overrides it.
- Keys/URLs, project env > `PULSE_`-prefixed > default: `OPENAI_API_KEY|_URL` (default `https://api.openai.com/v1`), `ANTHROPIC_API_KEY|_URL` (default `https://api.anthropic.com/v1`).
- Tool-local resolvers bypass the `PULSE_` fallback: generate-image reuses `OPENAI_API_URL` directly and reads `GEMINI_*` directly; tavily reads `TAVILY_*` directly.

## Knob Table

| Env var | Default | Controls |
|---|---|---|
| `CLAUDE_MAX_OUTPUT_TOKENS` / `OPENAI_MAX_OUTPUT_TOKENS` | 32768 / 16384 | per-family `maxOutputTokens` (correctness-load-bearing, see architecture.md) |
| `OPENAI_REASONING_EFFORT` | unset | `providerOptions.openai.reasoningEffort` |
| `LLM_FIRST_CHUNK_TIMEOUT_MS` / `LLM_CALL_TIMEOUT_MS` | 180000 / 600000 | first-chunk and total-call timers |
| `CLARIFICATION_TIMEOUT` | 300000 | clarify tool wait before defaultAnswer |
| `OPENAI_IMAGE_TIMEOUT_MS` | 300000 (clamp ≤600000) | image generation abort |
| `CONTEXT_WINDOW_TOKENS` | 64000 | base for compaction thresholds and the summarizer input budget (50%) |
| `COMPACT_TRIGGER` | 75% of window = 48000 | pre-loop compaction threshold (local estimate: ASCII ≈ 4 chars/token, non-ASCII ≈ 1 char/token, media parts flat 1600) |
| `COMPACT_TARGET` | 50% of window = 32000 | post-compaction size target; the verbatim tail is budgeted at 60% of it (40% when forced) |
| `KEEP_LAST_TURNS` | 4 | preferred number of recent user turns kept verbatim when they fit the tail budget (forced compaction prefers 1) |
| `COMPACT_SUMMARY_MODEL` | unset | operator override for the summary model; unset or blank → the run model, then `DEFAULT_MODEL` |
| `COMPACT_SUMMARY_MAX_TOKENS` | unset → 3% of the window, clamped to 4000–8000 | output cap of the summary call; reasoning models spend part of it thinking |
| `MAX_COMPACTION_ATTEMPTS` | 2 | consecutive compactions without a completed LLM call (see architecture.md) |
| `PULSE_USER_AGENT` | `pulse-coder/<version>` | User-Agent of the env-built Anthropic provider |
| `MODEL_CONTEXT_BUDGET` | 0 = use per-family table | overrides the length-disambiguation budget only |
| — (hardcoded) | `MAX_ERROR_COUNT` 3 · `MAX_STEPS` 500 (per-run `LoopOptions.maxSteps` only) · `MAX_TOOL_OUTPUT_LENGTH` 30000 · `MAX_TURNS` 100 (exported, unused) · per-family budgets 180K claude/gpt-5/gpt-4.1/o-series, 110K gpt-4o/default, 900K gemini | retry/step/output caps and the length-disambiguation table |
| `CLARIFICATION_ENABLED` | true | exported but consumed nowhere in engine src — dead knob today |
| `TAVILY_API_KEY` / `TAVILY_API_BASE_URL` / `TAVILY_PROJECT_ID` | required / api.tavily.com / unset | web-search family |
| `GEMINI_API_KEY` / `GEMINI_IMAGE_MODEL` / `GEMINI_API_BASE_URL` | required / gemini-2.0-flash-preview-image-generation / v1beta | Gemini image gen (no PULSE_ fallback) |
| `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_RESPONSES_MODEL` / `OPENAI_IMAGE_API_MODE` | gpt-image-2 / = image model / `responses` | OpenAI image gen model + call mode |
| `PULSE_CODER_PTC_ENABLED` `_STRICT` `_APPEND_PROMPT` `_APPEND_PROMPT_MAX_TOOLS` | true / false / false / 12 | PTC plugin |
| `PULSE_CODER_TOOL_SEARCH_ENABLED` `_VARIANT` `_LIMIT` `_CANDIDATES` `_MAX_REGEX_LENGTH` `_SUMMARY` `_THRESHOLD` | true / bm25 / 10 / 20 / 200 / true / 10 | tool-search plugin. `_THRESHOLD` is the auto mode percent of `CONTEXT_WINDOW_TOKENS`: when all deferred-tool schemas total less than that, tools load upfront (no search tools exposed); at/above it, defer + search (search → load → direct call). 0 forces search always. Default 10 mirrors Claude Code `ENABLE_TOOL_SEARCH=auto`. |
| `PULSE_CODER_TASK_LIST_ID` (or `CLAUDE_CODE_TASK_LIST_ID`) / `PULSE_CODER_TASKS_DIR` | default / `~/.pulse-coder/tasks` | task-tracking plugin |
| `PULSE_CODER_SOUL_STATE_DIR` / `PULSE_CODER_SOUL_PERSIST` | internal / on unless `'0'` | role-soul plugin |

## Interaction Notes

1. The length-disambiguation budgets (`loop.ts` per-family table, `MODEL_CONTEXT_BUDGET`) are INDEPENDENT of `CONTEXT_WINDOW_TOKENS`/`COMPACT_TRIGGER` — the former reads real `usage.inputTokens`, the latter a cheap char estimate; their default scales disagree (64K vs 180K for Claude) by design.
2. Raising the output-token caps reduces false compactions: an under-budget `length` finish is treated as an output-cap hit and just continues.
3. The summarizer receives a clipped plain-text transcript with an estimated token budget of 50% of the window, including the omission marker. When it fails, a shorter clipped transcript (20% of target) stands in for the summary (`strategy: 'fallback'`). Both use the engine text estimator, not the provider tokenizer. Request framing and prompts add overhead, so these transcript budgets do not guarantee that a model request cannot overflow.
4. When even the smallest valid tail exceeds `COMPACT_TARGET`, the summary is still kept and the result reports `strategy: 'summary-too-large'`; a result that is not smaller than the input is discarded.
5. `MAX_COMPACTION_ATTEMPTS` counts consecutive compactions across the pre-loop, length-retry and overflow-error sites and resets after each completed LLM call, so a long run can compact again after progress.

## Runtime Configuration Layout

Write new configuration under .pulse-coder and preserve .coder compatibility unless explicitly migrating. Runtime task skills are loaded by the engine's skills plugin; repository action protocols under harness/skills are a separate layer. A local skill with frontmatter `disable-model-invocation: true` remains loadable by exact name but is omitted from the model's automatic-matching list, so it requires explicit user invocation.

| Task | Source / entry |
|---|---|
| MCP configuration and current server inventory | .pulse-coder/mcp.json; src/built-in/mcp-plugin/ |
| Add or inspect runtime skills | .pulse-coder/skills/<name>/SKILL.md; src/built-in/skills-plugin/ |
| Add or inspect sub-agents | .pulse-coder/agents/*.md; src/built-in/sub-agent-plugin/ |
| Engine plugin discovery | src/plugin/EnginePlugin.ts and src/plugin/PluginManager.ts; plugin-system.md |
| Remote skill configuration | Optional .pulse-coder/skills/remote.json; src/built-in/skills-plugin/index.ts |
| Oversized tool results | src/built-in/tool-offload-plugin/; TOOL_OFFLOAD_THRESHOLD and TOOL_OFFLOAD_DIR |
| Orchestration roles | src/orchestrator/ and the pulse-coder-engine/orchestrator subpath; orchestrator.md |

The actual files and directory entries own server, skill, and agent inventories; do not keep a second fixed count in AGENTS.md. Engine plugin directories may be absent until used. `.pulse-coder/config/` is not read by the engine; the declarative user-config loader was removed (plugin-system.md).

TOOL_OFFLOAD_THRESHOLD defaults to 30,000 characters. TOOL_OFFLOAD_DIR overrides the storage directory; the default is the user-scoped ~/.pulse-coder/offload. Hosts can supply an explicit directory. Compaction knobs remain in the table above and the loop implementation.

OPENAI_API_KEY/PULSE_OPENAI_API_KEY, ANTHROPIC_API_KEY/PULSE_ANTHROPIC_API_KEY, TAVILY_API_KEY, GEMINI_API_KEY, INTERNAL_API_SECRET, and CLARIFICATION_* remain environment-only, as required by the root security policy. Provider PULSE_ fallbacks and tool-local exceptions are described above; never infer a fallback for a tool that reads its own variables directly. Other host/plugin credential storage follows its owning settings/vault boundary; no credentials belong in source control.
