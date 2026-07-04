# pulse-coder-engine

Core runtime for Pulse Coder — provides the agent execution loop, tool system, plugin manager, and built-in plugins. This is the foundational package that all other packages and apps depend on.

## Architecture

```
Engine
 ├── PluginManager        # dual-track: engine plugins + user config plugins
 │    ├── Built-in plugins (MCP, skills, plan-mode, tasks, sub-agent, …)
 │    └── User plugins     (.pulse-coder/engine-plugins/)
 ├── Tools                 # read, write, edit, grep, ls, bash, tavily (+extract/crawl/map), generate_image, clarify
 ├── Loop                  # core agent loop (streamText → tool exec → retry → compact)
 ├── AI adapter            # Vercel AI SDK wrapper (OpenAI / Anthropic)
 └── Context compaction    # summary-based token management
```

### Execution Loop (`src/core/loop.ts`)

Each `Engine.run()` call enters a loop that:
1. Fires `beforeRun` hooks (plugins can mutate system prompt and tools)
2. Calls `streamText` via the AI adapter, firing `beforeLLMCall` / `afterLLMCall` around each call and `onToolCall` when a tool-call chunk arrives
3. Executes tool calls with `beforeToolCall` / `afterToolCall` hooks
4. Checks token usage and triggers compaction when needed (fires `onCompacted`)
5. Retries on recoverable errors (up to `MAX_ERROR_COUNT`)
6. Fires `afterRun` hooks on completion

### Plugin System

Dual-track architecture:
- **Engine plugins** (`EnginePlugin` interface) — code-level extensions that register tools, hooks, and services.
- **User config plugins** — declarative JSON/YAML configs for tools, prompts, MCP servers, and sub-agents.

Plugins interact with the engine through `EnginePluginContext` (`src/plugin/EnginePlugin.ts`):
- `registerTool(name, tool)` / `registerTools(map)` / `getTool(name)` / `getTools()`
- `getEngineInstance()` — access the underlying engine instance
- `registerHook(hookName, handler)` — any of the 8 hooks in `EngineHookMap` (see [Hooks](#hooks))
- `registerService(name, service)` / `getService(name)`
- `getConfig(key)` / `setConfig(key, val)`
- `events` (EventEmitter), `logger`

### Hooks

The engine defines 8 lifecycle hooks in `EngineHookMap` (`src/plugin/EnginePlugin.ts`). Full input/result type signatures live in that file; the table below lists when each fires and what it can mutate.

| Hook | Fires | Can mutate |
|------|-------|------------|
| `beforeRun` | Once at the start of `Engine.run()`, before the loop | `systemPrompt`, `tools` |
| `beforeLLMCall` | Before each LLM call inside the loop (including retries) | `systemPrompt`, `tools` |
| `afterLLMCall` | After each LLM call completes (read-only) | — |
| `onToolCall` | When the LLM emits a tool-call chunk (read-only) | — |
| `beforeToolCall` | Before each individual tool execution | `input` (or throw to abort) |
| `afterToolCall` | After each individual tool execution | `output` |
| `onCompacted` | After context compaction produced a new message list (read-only) | — |
| `afterRun` | Once when `Engine.run()` finishes (read-only) | — |

### Built-in Plugins

Registered automatically from `src/built-in/index.ts`:

| Plugin | Description |
|--------|-------------|
| MCP | Connects to MCP servers from `.pulse-coder/mcp.json` |
| Skills | Scans `SKILL.md` files and registers the `skill` tool |
| Plan mode | Adds `planning` / `executing` mode switching with tool filtering |
| Task tracking | Shared task list with `task_create`, `task_get`, `task_list`, `task_update` tools |
| Sub-agent | Loads agent definitions from `.pulse-coder/agents/*.md` |
| Tool search | Deferred tool discovery via `tool_search_tool_bm25` (natural language) and `tool_search_tool_regex` (regex) |
| Role/Soul | Injects persona prompts from `.pulse-coder/souls/**/SOUL.md` (legacy `.agents/souls/`, `.coder/souls/`) |
| Agent teams | Multi-agent coordination via `pulse-coder-orchestrator` |
| PTC | PTC workflow integration with `allowed_callers` filtering |

### Built-in Tools

Registered unconditionally from `src/tools/index.ts`; tools marked *deferred* are loaded lazily via tool search.

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | String-replacement file editing |
| `grep` | Regex search via ripgrep-style |
| `ls` | Directory listing |
| `bash` | Shell command execution |
| `tavily` | Web search via Tavily API |
| `tavily_extract` | Extract cleaned content from URLs *(deferred)* |
| `tavily_crawl` | Crawl a site and extract page content *(deferred)* |
| `tavily_map` | Discover site URLs without full extraction *(deferred)* |
| `generate_image` | Image generation; defaults to OpenAI/GPT (`gpt-image-2` via `OPENAI_API_KEY`), Gemini opt-in via `provider: 'gemini'` *(deferred)* |
| `clarify` | Request clarification from the user |
| `deferred_demo` | Demo deferred tool that echoes a message *(deferred)* |

## Usage

```typescript
import { Engine } from 'pulse-coder-engine';

const engine = new Engine({
  model: 'gpt-4o',
  systemPrompt: { append: 'Always respond in English.' },
  tools: { myCustomTool },
});

await engine.initialize();

const result = await engine.run(
  { messages: [{ role: 'user', content: 'Explain the auth module' }] },
  {
    onText: (delta) => process.stdout.write(delta),
    onToolCall: (tc) => console.log('tool:', tc.toolName),
  },
);
```

### LLM Provider

Default provider is built from env vars. Override per-engine or per-run:

```typescript
// Via named type (uses env vars)
new Engine({ modelType: 'claude', model: 'claude-sonnet-4-20250514' });

// Via custom factory
import { createOpenAI } from '@ai-sdk/openai';
new Engine({ llmProvider: createOpenAI({ apiKey: '...' }).responses });
```

### Exports

Beyond `Engine`, `src/index.ts` re-exports the building blocks hosts and plugin authors compose with: `PulseAgent` (alias of `Engine`), the `loop` runtime, `streamTextAI` / `generateTextAI`, `maybeCompactContext`, `buildProvider`, the full `EnginePlugin` / `EnginePluginContext` / hook types, the `PluginManager`, and all built-in plugins and tools.

## Configuration

The OpenAI/Anthropic provider credential vars accept a `PULSE_`-prefixed global fallback (e.g. `OPENAI_API_KEY` → `PULSE_OPENAI_API_KEY`) so a shell-profile default can be overridden per project. Tool-specific keys (`TAVILY_API_KEY`, `GEMINI_API_KEY`) are read directly and do not have a `PULSE_` fallback.

| Env var | Default | Description |
|---------|---------|-------------|
| `OPENAI_API_KEY` / `OPENAI_API_URL` | — | OpenAI credentials (or `PULSE_OPENAI_*`) |
| `USE_ANTHROPIC` | — | Set to use Anthropic as default provider |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_URL` | — | Anthropic credentials (or `PULSE_ANTHROPIC_*`) |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | `novita/deepseek/deepseek_v3` | Default model (precedence: `ANTHROPIC_MODEL` → `OPENAI_MODEL` → `PULSE_ANTHROPIC_MODEL` → `PULSE_OPENAI_MODEL`) |
| `LLM_FIRST_CHUNK_TIMEOUT_MS` | 180000 | Abort if no first chunk arrives within this (ms) |
| `LLM_CALL_TIMEOUT_MS` | 600000 | Overall LLM call timeout (ms) |
| `MAX_STEPS` | 500 | Max tool-execution steps per run |
| `MAX_TOOL_OUTPUT_LENGTH` | 30000 | Truncate tool output beyond this (chars) |
| `MODEL_CONTEXT_BUDGET` | 0 (unset) | Global input-token cap override used to disambiguate `finishReason='length'`; when unset/0, falls back to per-family budgets in `resolveModelContextBudget` (`src/core/loop.ts`). Separate from `CONTEXT_WINDOW_TOKENS` (compaction). |
| `OPENAI_REASONING_EFFORT` | (unset) | OpenAI reasoning effort (e.g. low / medium / high) |
| `CLAUDE_MAX_OUTPUT_TOKENS` | 32768 | Per-call output token cap for Claude |
| `OPENAI_MAX_OUTPUT_TOKENS` | 16384 | Per-call output token cap for OpenAI |
| `CONTEXT_WINDOW_TOKENS` | 64000 | Token budget for compaction |
| `COMPACT_TRIGGER` | 75% of window | Compaction trigger threshold |
| `COMPACT_TARGET` | 50% of window | Target after compaction |
| `KEEP_LAST_TURNS` | 4 | Recent turns preserved during compaction |
| `COMPACT_SUMMARY_MODEL` | (main model) | Dedicated model for summaries |
| `COMPACT_SUMMARY_MAX_TOKENS` | 1200 | Max tokens for compaction summaries |
| `MAX_COMPACTION_ATTEMPTS` | 2 | Retry limit for compaction |
| `CLARIFICATION_ENABLED` | true | Enable the `clarify` tool |
| `CLARIFICATION_TIMEOUT` | 300000 | Clarification wait timeout (ms) |
| `TAVILY_API_KEY` | — | Required to execute Tavily tools (checked at call time; the tools are registered regardless) |
| `GEMINI_API_KEY` | — | Required only when `generate_image` runs with `provider: 'gemini'` (the default OpenAI/GPT path uses `OPENAI_API_KEY`) |

Image and Tavily tools expose additional per-tool env knobs (e.g. `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_API_MODE`, `OPENAI_IMAGE_TIMEOUT_MS`, `GEMINI_IMAGE_MODEL`, `TAVILY_API_BASE_URL`); see `src/tools/generate-image.ts` and `src/tools/tavily.ts`.

## Contracts & Validation

Package contracts and validation commands are the source of truth in [`harness/knowledge/contracts.md`](harness/knowledge/contracts.md), [`harness/knowledge/architecture.md`](harness/knowledge/architecture.md), and [`harness/validate/README.md`](harness/validate/README.md). Public exports, `EngineOptions`, hook signatures, service names, built-in tool schemas, and built-in plugin behavior are contracts.

## Build & Test

```bash
pnpm --filter pulse-coder-engine build
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
```
