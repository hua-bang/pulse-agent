# pulse-coder-memory-plugin

Host-side memory service for Pulse Coder runtimes. Provides persistent, scoped memory with semantic recall, daily logging, and automatic injection into agent context.

## Architecture

```
FileMemoryPluginService
 ├── Layered state store    # user/ soul/ daily/ subdirs per platformKey
 ├── Embedding providers    # hash (local) or OpenAI (API)
 ├── SQLite vector store    # semantic recall via cosine similarity
 ├── Daily log processor    # auto-extraction + quota + quality gates
 └── Engine plugin hooks    # beforeRun injection + onCompacted daily-log extraction
```

### Memory Scopes

| Scope | Purpose | Surfacing |
|-------|---------|-----------|
| `user` | Persistent profile/preferences/rules/facts (cross-session) | Only `rule`/`fact` items with `sourceType !== 'daily-log'` are auto-injected into the system prompt each run, capped at 4 items (~520 chars). `preference`-type user memories are not auto-injected. |
| `soul` | Personality traits and character notes | All soul items are auto-injected into the system prompt each run under a private header ("do not surface to user unless asked"); also retrievable via `memory_recall` with `scope: 'soul'` or `'all'`. |
| `session` | Session-scoped decisions/fixes and daily-log entries | `recall()` returns only `sourceType === 'daily-log'` items, ranked by hybrid vector + keyword + recency scoring. Explicit session items are visible via `list()` (with `sessionId`) but not via `recall()`. |

### Storage Layout

Default `baseDir` is `~/.pulse-coder/memory-plugin` (override via `FileMemoryServiceOptions.baseDir`).

```
~/.pulse-coder/memory-plugin/            # baseDir
  vectors.sqlite                          # SQLite vector store for semantic recall
  state.json                              # legacy single-file state (auto-migrated to layered layout)
  state.v1.backup.json                    # backup produced after migrating legacy state.json
  {platformKey}/
    user/memories.json                    # user-scope memories + per-session enabled flags
    soul/memories.json                    # soul/personality memories
    daily/YYYY-MM-DD.json                 # daily-log entries (session-scope), sharded by day
```

On startup, a legacy `state.json` (if present) is merged into the layered layout and renamed to `state.v1.backup.json`; subsequent writes use the layered files only.

### Recall Strategy

Hybrid scoring combines:
- **Vector similarity** (65%) — cosine distance via SQLite vector store
- **Keyword matching** (35%) — term overlap scoring
- **Recency bonus** — recent memories rank higher
- **Quality weight** — confidence and importance factors

Fallback to recency + quality scoring when no query signals are available.

## Memory Tools

The engine plugin registers these tools (all `defer_loading: true`):

| Tool | Description |
|------|-------------|
| `memory_recall` | Recall relevant memories for the current session. `scope`: `default` (daily-log items), `soul` (hidden personality memory), or `all` (merge both). `query` defaults to the current user message when omitted. |
| `memory_record` | Persist a memory. `kind`: `preference` \| `rule` \| `fix` \| `profile` \| `soul` (defaults to `profile`). `rule`/`profile` are user-level; `preference`/`fix` are session-level; `soul` is hidden personality memory. |
| `memory_get_daily_log_by_day` | Retrieve daily-log entries for a specific `YYYY-MM-DD` day, with optional `types` filter. |

All three tools require an active run context (see [Engine Integration](#engine-integration)).

## Embedding Strategies

| Strategy | Env var | Description |
|----------|---------|-------------|
| `hash` (default) | `MEMORY_EMBEDDING_STRATEGY=hash` | Local content-addressable hashing with synonym expansion and character n-grams. Zero API calls. |
| `openai` | `MEMORY_EMBEDDING_STRATEGY=openai` | OpenAI-compatible embedding API. Requires `MEMORY_EMBEDDING_API_KEY` (or `OPENAI_API_KEY`) and `MEMORY_EMBEDDING_API_URL` (or `OPENAI_API_URL`); falls back to `hash` if either is missing. |

## Configuration

Env vars are resolved by `createMemoryIntegrationFromEnv()` (via `resolveMemoryEmbeddingRuntimeConfigFromEnv` and `resolveMemoryWriteRuntimeConfigFromEnv`). They can also be passed explicitly via `FileMemoryServiceOptions` / `CreateMemoryIntegrationOptions`.

### Embedding

| Env var | Default | Description |
|---------|---------|-------------|
| `MEMORY_SEMANTIC_RECALL_ENABLED` | `true` | Enable vector-based semantic recall |
| `MEMORY_EMBEDDING_STRATEGY` | `hash` | `hash` or `openai` |
| `MEMORY_EMBEDDING_DIMENSIONS` | 256 (hash) / 1536 (openai) | Embedding vector dimensions |
| `MEMORY_EMBEDDING_MODEL` | `text-embedding-3-small` | openai strategy model (falls back to `OPENAI_EMBEDDING_MODEL`, then the default) |
| `MEMORY_EMBEDDING_API_KEY` | (falls back to `OPENAI_API_KEY`) | Dedicated embedding API key |
| `MEMORY_EMBEDDING_API_URL` | (falls back to `OPENAI_API_URL`) | Dedicated embedding endpoint |
| `MEMORY_EMBEDDING_TIMEOUT_MS` | 15000 | Embedding API timeout (ms) |

### Daily-log write policy

| Env var | Default | Description |
|---------|---------|-------------|
| `MEMORY_DAILY_LOG_ENABLED` | `true` | Enable daily-log extraction from turns |
| `MEMORY_DAILY_LOG_MODE` | `write` | `write` (persist) or `shadow` (evaluate + log stats, do not persist) |
| `MEMORY_DAILY_LOG_MIN_CONFIDENCE` | 0.65 | Minimum extraction confidence to accept a candidate |
| `MEMORY_DAILY_LOG_MAX_PER_TURN` | 3 | Max daily-log items written per turn |
| `MEMORY_DAILY_LOG_MAX_PER_DAY` | 30 | Max daily-log items written per platform/day |

### Compaction write policy

Drives daily-log memory written from compacted-away turns via the `onCompacted` hook.

| Env var | Default | Description |
|---------|---------|-------------|
| `MEMORY_COMPACTION_WRITE_ENABLED` | `true` | Enable compaction-driven daily-log writes |
| `MEMORY_COMPACTION_MIN_TOKEN_DELTA` | 8000 | Min tokens removed before a compaction write is considered |
| `MEMORY_COMPACTION_MIN_REMOVED_MESSAGES` | 4 | Min messages removed before a compaction write is considered |
| `MEMORY_COMPACTION_MAX_PER_RUN` | 1 | Max compaction writes per engine run |
| `MEMORY_COMPACTION_EXTRACTOR` | `rule` | Compaction extractor (only `rule` is implemented) |

## Usage

```typescript
import { FileMemoryPluginService } from 'pulse-coder-memory-plugin';

const memory = new FileMemoryPluginService(); // baseDir defaults to ~/.pulse-coder/memory-plugin
await memory.initialize();

// Record explicit memories extracted from a conversation turn.
// recordTurn runs rule-based extraction on userText/assistantText.
await memory.recordTurn({
  platformKey: 'slack',
  sessionId: 'session-42',
  userText: 'Always use TypeScript with strict mode',
  assistantText: 'Got it, strict mode enabled.',
  sourceType: 'explicit', // 'explicit' | 'daily-log' | 'daily-log-compact'
});

// Record a hidden soul/personality memory (auto-injected each run, marked private).
await memory.recordSoul({
  platformKey: 'slack',
  content: 'Prefers concise, direct answers',
});

// Recall returns daily-log (sourceType === 'daily-log') items for the session,
// ranked by hybrid vector + keyword + recency scoring.
const results = await memory.recall({
  platformKey: 'slack',
  sessionId: 'session-42',
  query: 'coding preferences',
  limit: 5,
});
```

### Engine Integration

The recommended entry points are `createMemoryIntegrationFromEnv` (reads `MEMORY_*` env) and `createMemoryIntegration` (explicit options). Both return a `MemoryIntegration` (`{ service, enginePlugin, initialize, withRunContext, getRunContext }`) that wires the service, an `AsyncLocalStorage` run-context adapter, and the engine plugin in one call.

```typescript
import { Engine } from 'pulse-coder-engine';
import { createMemoryIntegrationFromEnv } from 'pulse-coder-memory-plugin';

const integration = createMemoryIntegrationFromEnv();
await integration.initialize();

const engine = new Engine({
  enginePlugins: {
    plugins: [integration.enginePlugin],
  },
});
```

The plugin registers two hooks:

- `beforeRun` — appends the memory tool policy to the system prompt and auto-injects user/soul memories for the active run context.
- `onCompacted` — when the compaction write policy gates pass, extracts a daily-log memory from the messages removed by compaction.

**Run-context requirement:** the memory tools throw `memory tools require active engine run context` unless a `MemoryRunContext` (`{ platformKey, sessionId, userText }`) is active. Wrap the engine run so tools can resolve it:

```typescript
await integration.withRunContext(
  { platformKey: 'slack', sessionId: 'session-42', userText: 'remember my preferences' },
  async () => {
    // engine run that may invoke memory_recall / memory_record / memory_get_daily_log_by_day
  },
);
```

For lower-level control, `createMemoryEnginePlugin` accepts `{ service, getRunContext, name?, version?, toolPolicyAppend?, compactionWritePolicy? }` directly (`service` and `getRunContext` are required; there is no `baseDir` option — pass a configured `FileMemoryPluginService` instead).

## Build & Test

```bash
pnpm --filter pulse-coder-memory-plugin build
pnpm --filter pulse-coder-memory-plugin test
pnpm --filter pulse-coder-memory-plugin typecheck
```
