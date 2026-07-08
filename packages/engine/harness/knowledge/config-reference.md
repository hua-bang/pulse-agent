# Config Knob Reference

Every tunable the engine reads, with defaults and read sites. All `config/index.ts` constants resolve ONCE at module import (after `dotenv.config()`); later `process.env` mutations are ignored except through `buildProvider()` overrides.

## Model & Provider Resolution

- Model: `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL` → hardcoded `novita/deepseek/deepseek_v3` (`DEFAULT_MODEL`, `config/index.ts`).
- Provider: `USE_ANTHROPIC`/`PULSE_USE_ANTHROPIC` truthy → Anthropic SDK, else OpenAI `.responses` (`CoderAI`). `buildProvider(type, {apiKey, baseURL, headers})` builds either explicitly.
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
| `CONTEXT_WINDOW_TOKENS` | 64000 | base for compaction thresholds |
| `COMPACT_TRIGGER` | 75% of window = 48000 | pre-loop compaction threshold (cheap char-based estimate) |
| `COMPACT_TARGET` | 50% of window = 32000 | post-summary size target; overshooting triggers hard-truncate fallback |
| `KEEP_LAST_TURNS` | 4 | recent turns never summarized; also the hard-truncate size |
| `COMPACT_SUMMARY_MODEL` | `''` | model for the summary call — see interaction note 3 |
| `COMPACT_SUMMARY_MAX_TOKENS` | 1200 | output cap of the summary call |
| `MAX_COMPACTION_ATTEMPTS` | 2 | shared counter per loop() (see architecture.md) |
| `MODEL_CONTEXT_BUDGET` | 0 = use per-family table | overrides the length-disambiguation budget only |
| — (hardcoded) | `MAX_ERROR_COUNT` 3 · `MAX_STEPS` 500 (per-run `LoopOptions.maxSteps` only) · `MAX_TOOL_OUTPUT_LENGTH` 30000 · `MAX_TURNS` 100 (exported, unused) · per-family budgets 180K claude/gpt-5/gpt-4.1/o-series, 110K gpt-4o/default, 900K gemini | retry/step/output caps and the length-disambiguation table |
| `CLARIFICATION_ENABLED` | true | exported but consumed nowhere in engine src — dead knob today |
| `TAVILY_API_KEY` / `TAVILY_API_BASE_URL` / `TAVILY_PROJECT_ID` | required / api.tavily.com / unset | web-search family |
| `GEMINI_API_KEY` / `GEMINI_IMAGE_MODEL` / `GEMINI_API_BASE_URL` | required / gemini-2.0-flash-preview-image-generation / v1beta | Gemini image gen (no PULSE_ fallback) |
| `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_RESPONSES_MODEL` / `OPENAI_IMAGE_API_MODE` | gpt-image-2 / = image model / `responses` | OpenAI image gen model + call mode |
| `PULSE_CODER_PTC_ENABLED` `_STRICT` `_APPEND_PROMPT` `_APPEND_PROMPT_MAX_TOOLS` | true / false / false / 12 | PTC plugin |
| `PULSE_CODER_TOOL_SEARCH_ENABLED` `_VARIANT` `_LIMIT` `_CANDIDATES` `_MAX_REGEX_LENGTH` `_SUMMARY` | true / bm25 / 10 / 20 / 200 / true | tool-search plugin |
| `PULSE_CODER_TASK_LIST_ID` (or `CLAUDE_CODE_TASK_LIST_ID`) / `PULSE_CODER_TASKS_DIR` | default / `~/.pulse-coder/tasks` | task-tracking plugin |
| `PULSE_CODER_SOUL_STATE_DIR` / `PULSE_CODER_SOUL_PERSIST` | internal / on unless `'0'` | role-soul plugin |

## Interaction Notes

1. The length-disambiguation budgets (`loop.ts` per-family table, `MODEL_CONTEXT_BUDGET`) are INDEPENDENT of `CONTEXT_WINDOW_TOKENS`/`COMPACT_TRIGGER` — the former reads real `usage.inputTokens`, the latter a cheap char estimate; their default scales disagree (64K vs 180K for Claude) by design.
2. Raising the output-token caps reduces false compactions: an under-budget `length` finish is treated as an output-cap hit and just continues.
3. **Dead fallback**: `summarizeMessages` resolves `options?.model ?? COMPACT_SUMMARY_MODEL ?? DEFAULT_MODEL`, but `COMPACT_SUMMARY_MODEL` is always a string (possibly `''`), so `?? DEFAULT_MODEL` never fires — when the caller supplies no model and the env is unset, `provider('')` is called with an empty model id. Fix candidate: `||` or export undefined-if-empty.
4. If the summary fails to shrink below `COMPACT_TARGET` (or at all), the summary is DISCARDED and the transcript hard-truncates to `KEEP_LAST_TURNS` — setting `COMPACT_TARGET` close to `COMPACT_TRIGGER` makes silent truncation more likely.
5. `MAX_COMPACTION_ATTEMPTS` exhausts across both trigger sites in one `loop()`; after that, overflow retries proceed uncompacted.
