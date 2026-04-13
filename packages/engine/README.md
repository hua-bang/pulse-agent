# pulse-coder-engine

Core runtime for Pulse Coder — provides the agent execution loop, tool system, plugin manager, and built-in plugins. This is the foundational package that all other packages and apps depend on.

## Architecture

```
Engine
 ├── PluginManager        # dual-track: engine plugins + user config plugins
 │    ├── Built-in plugins (MCP, skills, plan-mode, tasks, sub-agent, …)
 │    └── User plugins     (.pulse-coder/engine-plugins/)
 ├── Tools                 # read, write, edit, grep, ls, bash, tavily, gemini, clarify
 ├── Loop                  # core agent loop (streamText → tool exec → retry → compact)
 ├── AI adapter            # Vercel AI SDK wrapper (OpenAI / Anthropic)
 └── Context compaction    # summary-based token management
```

### Execution Loop (`src/core/loop.ts`)

Each `Engine.run()` call enters a loop that:
1. Fires `beforeRun` hooks (plugins can mutate system prompt and tools)
2. Calls `streamText` via the AI adapter
3. Executes tool calls with `beforeToolCall` / `afterToolCall` hooks
4. Checks token usage and triggers compaction when needed
5. Retries on recoverable errors (up to `MAX_ERROR_COUNT`)
6. Fires `afterRun` hooks on completion

### Plugin System

Dual-track architecture:
- **Engine plugins** (`EnginePlugin` interface) — code-level extensions that register tools, hooks, and services.
- **User config plugins** — declarative JSON/YAML configs for tools, prompts, MCP servers, and sub-agents.

Plugins interact with the engine through `EnginePluginContext`:
- `registerTool(name, tool)` / `registerTools(map)`
- `registerHook(hookName, handler)` — all hooks from `EngineHookMap`
- `registerService(name, service)` / `getService(name)`
- `getConfig(key)` / `setConfig(key, val)`
- `events` (EventEmitter), `logger`

### Built-in Plugins

Registered automatically from `src/built-in/index.ts`:

| Plugin | Description |
|--------|-------------|
| MCP | Connects to MCP servers from `.pulse-coder/mcp.json` |
| Skills | Scans `SKILL.md` files and registers the `skill` tool |
| Plan mode | Adds `plan` / `act` mode switching with tool filtering |
| Task tracking | Shared task list with `task_create`, `task_get`, `task_list`, `task_update` tools |
| Sub-agent | Loads agent definitions from `.pulse-coder/agents/*.md` |
| Tool search | BM25-based deferred tool discovery (`tool_search_tool_bm25`) |
| Role/Soul | Injects persona prompts from `.pulse-coder/agents/` |
| Agent teams | Multi-agent coordination via `pulse-coder-orchestrator` |
| PTC | PTC workflow integration with `allowed_callers` filtering |

### Built-in Tools

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | String-replacement file editing |
| `grep` | Regex search via ripgrep-style |
| `ls` | Directory listing |
| `bash` | Shell command execution |
| `tavily` | Web search + extract + crawl + map |
| `gemini_pro_image` | Image generation via Gemini Pro |
| `clarify` | Request clarification from the user |

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

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `OPENAI_API_KEY` / `OPENAI_API_URL` | — | OpenAI credentials |
| `USE_ANTHROPIC` | — | Set to use Anthropic as default provider |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_URL` | — | Anthropic credentials |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | `novita/deepseek/deepseek_v3` | Default model |
| `CONTEXT_WINDOW_TOKENS` | 64000 | Token budget for compaction |
| `COMPACT_TRIGGER` | 75% of window | Compaction trigger threshold |
| `COMPACT_TARGET` | 50% of window | Target after compaction |
| `KEEP_LAST_TURNS` | 4 | Recent turns preserved during compaction |
| `COMPACT_SUMMARY_MODEL` | (main model) | Dedicated model for summaries |
| `MAX_COMPACTION_ATTEMPTS` | 2 | Retry limit for compaction |
| `CLARIFICATION_ENABLED` | true | Enable the `clarify` tool |
| `CLARIFICATION_TIMEOUT` | 300000 | Clarification wait timeout (ms) |
| `TAVILY_API_KEY` | — | Enable Tavily web search tools |
| `GEMINI_API_KEY` | — | Enable Gemini image tool |

## Build & Test

```bash
pnpm --filter pulse-coder-engine build
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
```
