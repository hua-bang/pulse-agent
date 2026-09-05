# CLI model registry

Read before changing model/provider configuration, startup or resume selection, context budgets, or prompt-cache routing. src/models/model-registry.ts owns loading/merge; model-spec.ts owns resolution; model-run-options.ts owns engine wiring; preferences.ts owns the explicit last-model choice. Engine environment defaults remain in the engine's config-reference.md.

## Provider, resolution, and persistence contracts

- `/model` exists on BOTH hosts over the same registry and resolver; only the surface differs (Ink modal picker vs a printed indexed list plus `/model <index|spec|reset>`). A numeric argument in the readline host is always an index — never let it fall through to the lenient resolver, which would accept a model literally named `"1"`.

- Per-model `contextWindow` (models.json) must flow through `modelRunOptions()` into BOTH the run options and `compactContext` — the status-line ctx% denominator and the engine's compaction trigger/target must never diverge.

- Both hosts build engine run options through `buildModelRunOptions()` (`model-run-options.ts`). `model-registry.ts` stays engine-free so its tests stay fast; the provider wiring lives in the shared module so a provider-bound spec cannot reach the engine with a connection on one host and without it on the other.

- `resolveModelSpec` never returns null (a bare id always parses) — that leniency is right for a spec the user just typed and wrong for the silent startup restore, which uses `resolveKnownModelSpec` instead. A `provider:model` spec whose provider has left models.json must fail there, not come back as the literal id `"provider:model"`.

- models.json is provider-granular and committable: provider entries carry `baseUrl` + `apiKeyEnv` (an env var NAME); inline `apiKey` values are ignored with a warning — never let secrets into this file (root AGENTS §7). Provider-bound choices build their connection via the engine's `buildProvider(type, {baseURL, apiKey})` inside `modelRunOptions()`.

- Provider entries may opt into `promptCacheKey: true`: both interactive hosts then send a stable per-session key (SHA-256 of `provider:model:sessionId`, `model-run-options.ts`) that the engine forwards as OpenAI `prompt_cache_key` — cache-node ROUTING AFFINITY for multi-upstream gateways, not cache isolation, so `/clear` keeps the session's key and rotation buys nothing. The provider is the SSOT for the flag (`applyProvider` drops a stale home-scope opt-in on rebase), print mode has no session and never sends one, and the engine's Claude path filters the key out.

- Startup model precedence is `--model` > persisted last choice (`preferences.ts`) > models.json `"default": true` > engine env default. Only an explicit user switch persists; a `--model` flag never does. A persisted spec that no longer resolves warns and falls back rather than failing.

- Sessions additionally record the model they were saved under (`metadata.model`, via `setModelSpecProvider`) and BOTH hosts restore it after `loadContext` on `/resume` and `--continue` — a resumed conversation continues on the model it was actually using. The restore is silent: it never writes the global last-model preference (that records explicit choices only), `--model` still pins the process, and an unresolvable spec warns and keeps the current model. Note the global-preference persistence itself (`preferences.ts`) remains Ink-only; the readline host restores per-session models but does not persist a global last choice.

- The registry loads from BOTH `~/.pulse-coder/models.json` and `<cwd>/.pulse-coder/models.json` and merges them (project wins per provider name and per `provider:model` id; home models referencing a redefined provider are rebased onto the project connection). A home-only setup must keep working from any directory — do not reduce this back to a single-scope lookup.
