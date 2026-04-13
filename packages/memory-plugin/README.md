# pulse-coder-memory-plugin

Host-side memory service for Pulse Coder runtimes. Provides persistent, scoped memory with semantic recall, daily logging, and automatic injection into agent context.

## Architecture

```
FileMemoryPluginService
 ├── Layered state store    # user/ soul/ daily/ subdirs per platformKey
 ├── Embedding providers    # hash (local) or OpenAI (API)
 ├── SQLite vector store    # semantic recall via cosine similarity
 ├── Daily log processor    # auto-extraction + quota + quality gates
 └── Engine plugin hooks    # beforeRun injection + afterRun logging
```

### Memory Scopes

| Scope | Purpose | Surfacing |
|-------|---------|-----------|
| `user` | Persistent preferences, rules, facts (profile) | Auto-injected into system prompt every run |
| `soul` | Personality traits and character notes | Private — only surfaced when explicitly queried |
| `session` | Session-specific decisions, fixes, daily logs | Recalled by semantic similarity to current query |

### Storage Layout

```
~/.pulse-coder/memory-plugin/{platformKey}/
  user/memories.json       # persistent user memories
  soul/memories.json       # soul/personality memories
  daily/YYYY-MM-DD.json    # daily log entries
```

### Recall Strategy

Hybrid scoring combines:
- **Vector similarity** (65%) — cosine distance via SQLite vector store
- **Keyword matching** (35%) — term overlap scoring
- **Recency bonus** — recent memories rank higher
- **Quality weight** — confidence and specificity factors

Fallback to recency-only when no query signals are available.

## Memory Tools

The engine plugin registers these tools:

| Tool | Description |
|------|-------------|
| `memory_recall` | Query memories by topic/keyword with hybrid scoring |
| `memory_record` | Store a new memory (type: preference, rule, decision, fix, fact) |
| `memory_get_daily_log_by_day` | Retrieve daily log entries for a specific date |

## Embedding Strategies

| Strategy | Env var | Description |
|----------|---------|-------------|
| `hash` (default) | `MEMORY_EMBEDDING_STRATEGY=hash` | Local content-addressable hashing with synonym expansion and n-grams. Zero API calls. |
| `openai` | `MEMORY_EMBEDDING_STRATEGY=openai` | OpenAI-compatible embedding API. Requires `MEMORY_EMBEDDING_API_KEY`. |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MEMORY_SEMANTIC_RECALL_ENABLED` | `true` | Enable vector-based semantic recall |
| `MEMORY_EMBEDDING_STRATEGY` | `hash` | `hash` or `openai` |
| `MEMORY_EMBEDDING_DIMENSIONS` | 256 (hash) / 1536 (openai) | Embedding vector dimensions |
| `MEMORY_EMBEDDING_MODEL` | `text-embedding-3-small` | Model for openai strategy |
| `MEMORY_EMBEDDING_API_KEY` | (falls back to `OPENAI_API_KEY`) | Dedicated embedding API key |
| `MEMORY_EMBEDDING_API_URL` | (falls back to `OPENAI_API_URL`) | Dedicated embedding endpoint |
| `MEMORY_EMBEDDING_TIMEOUT_MS` | 15000 | Embedding API timeout |

## Usage

```typescript
import { FileMemoryPluginService } from 'pulse-coder-memory-plugin';

const memory = new FileMemoryPluginService({
  baseDir: '~/.pulse-coder/remote-memory',
});
await memory.initialize();

// Record a memory
await memory.record('user:123', {
  type: 'preference',
  scope: 'user',
  content: 'User prefers TypeScript with strict mode',
});

// Recall by query
const results = await memory.recall('user:123', {
  query: 'coding preferences',
  limit: 5,
});
```

### Engine Integration

The plugin auto-injects user memories into the system prompt via `beforeRun` hook, and can auto-extract daily log entries from conversation turns via `afterRun`.

```typescript
import { createMemoryEnginePlugin } from 'pulse-coder-memory-plugin';

const engine = new Engine({
  enginePlugins: {
    plugins: [createMemoryEnginePlugin({ baseDir })],
  },
});
```

## Build & Test

```bash
pnpm --filter pulse-coder-memory-plugin build
pnpm --filter pulse-coder-memory-plugin test
pnpm --filter pulse-coder-memory-plugin typecheck
```
