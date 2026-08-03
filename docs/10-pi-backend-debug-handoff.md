# pi-backed chat: debug handoff

Date: 2026-08-03
Branch: `claude/canvas-workspace-planning-m7ca4o`
Status: RESOLVED on the user's machine. The real Canvas UI and standalone pi
0.83 CLI both complete successfully against the configured third-party
OpenAI-compatible provider after the root-base normalization fix described
below.

## Symptom timeline

1. `OpenAI API error (401) invalid_api_key` — pi resolved models from the
   user's own `~/.pi`, sending the third-party key to api.openai.com.
   FIXED by the model-parity bridge (`2bf40ec`): canvas model config is
   mirrored into a canvas-owned pi config dir + `PI_CODING_AGENT_DIR` +
   `--provider canvas --model <id>`.
2. `Stream ended without finish_reason` — REPRODUCED against the real
   pi 0.83 CLI: a stream sending content deltas + `[DONE]` but never a
   `finish_reason` chunk fails pi's client (the engine's AI-SDK client
   tolerates it). Empirically ruled OUT: compat flags (bare custom model
   entries already get plain `system` role, no `reasoning_effort`).
   FIXED by the loopback SSE-normalizing relay (`b6398be`): bridged
   OpenAI-compatible upstreams are fronted by a local relay that injects a
   synthesized `finish_reason:"stop"` chunk before `[DONE]` when none was
   seen (and appends `[DONE]` if the upstream ends without it). End-to-end
   verified in the dev container: the exact failing stream succeeds through
   the relay with the real pi binary.
3. User reports "还是不行" after (2) — NO new error log captured yet.
   Unverified whether the failure is the same message, whether the running
   build includes the relay, or whether the relay engaged.
4. Local reproduction found two stacked failures. First, pi was absent and
   Canvas failed with `spawn pi ENOENT`; installing
   `@earendil-works/pi-coding-agent@0.83.0` removed that blocker. The next run
   reproduced `Stream ended without finish_reason` even though the relay was
   engaged. The configured OpenAI-compatible base URL was an unversioned host
   root. Canvas model discovery interprets that as a root and probes `/v1`,
   but the pi bridge forwarded `/chat/completions` at the root and received
   the gateway's HTML frontend. FIXED by normalizing unversioned OpenAI base
   URLs to `/v1` before configuring the relay. A bridge+relay regression test
   pins `/v1/chat/completions`. Real Canvas returned `PI_OK`; standalone pi
   returned `PI_CLI_OK` with `stopReason:"stop"`.

## Current architecture (all on this branch)

Flag `pi-native-chat` (Settings → Experimental; env escape hatch
`PULSE_CANVAS_PI_NATIVE_CHAT=1`) diverts ONLY the default assistant:

```
resolveTurnBackend(null role) → piNativeTurnBackend
  → ask-mode approval → resolveExternalCwd (workspace root | scratch)
  → preparePiModelBridge()
      reads canvas model config (same resolveEffectiveFields chain the
      engine uses) → writes <bridgeDir>/models.json (0600) with provider
      "canvas" (+ conservative compat for openai) → for openai-compatible
      upstreams baseUrl = ensurePiStreamRelay(upstream)  ← loopback relay
      returns env { PI_CODING_AGENT_DIR } + args [--provider canvas --model <id>]
  → runPiSegment: spawn `pi --mode json -p [--session id] [-e extension] <args>`
      prompt via stdin; session id from stream header line; stale-resume retry
  → workspace chats also attach resources/pi-extension/pulse-canvas.ts
      (canvas tools over the runtime-control server, PULSE_CANVAS_WORKSPACE_ID)
```

Key files (`apps/canvas-workspace/src/main/agent/`):
`backends/pi-native-backend.ts`, `backends/pi-model-bridge.ts`,
`backends/pi-stream-relay.ts`, `external/pi.ts`, `external/spawn-jsonl.ts`,
`resources/pi-extension/pulse-canvas.ts`; capability
`runtime/capabilities/context-capabilities.ts`. Design: `docs/09`.

Env overrides: `PULSE_CANVAS_PI_CMD` (binary), `PULSE_CANVAS_PI_BRIDGE_DIR`
(default `~/.pulse-coder/canvas/pi-agent`), `PULSE_CANVAS_PI_EXTENSION`,
`PULSE_CANVAS_PI_NATIVE_CHAT`, `PULSE_CANVAS_MODEL_CONFIG`,
`PULSE_CANVAS_RUNTIME_FILE` (extension-side discovery).

## What is PROVEN vs ASSUMED

Proven (real pi 0.83, dev container):
- bare custom model entry → pi sends `system` role, no reasoning_effort;
- no-finish_reason stream → exact user error; same stream through relay →
  success (`stopReason:"stop"`);
- stale `--session` resume error matches the shared retry regex;
- 429 tests green across backends/driver/extension/bridge/relay suites.

Proven on the user's machine:
- pi 0.83 is installed and the bridge selects the configured Canvas model;
- the relay engages with a loopback base URL;
- the upstream emits standard SSE with `finish_reason:"stop"` and `[DONE]`;
- before the fix, the relay requested the unversioned HTML route; after the
  fix, real Canvas returned `PI_OK` and standalone pi returned `PI_CLI_OK`
  with `stopReason:"stop"`.

Still unverified: compatibility with other gateways whose unversioned roots
do not follow Canvas's `/v1` convention.

## Resolved local root cause

The provider returned a fully compliant stream, including
`finish_reason:"stop"` and `[DONE]`, at `/v1/chat/completions`. The relay was
instead requesting `/chat/completions` because it preserved the configured
root URL verbatim. That route returned `text/html` with the gateway frontend;
pi surfaced the misleading finish-reason error after receiving no completion
events. `normalizeVersionedAPIBaseURL()` now gives model discovery and the pi
bridge one root-or-versioned URL convention.

## Debug checklist for the local agent (in order)

1. Confirm the branch contains relay normalization, CRLF handling, and
   `normalizeVersionedAPIBaseURL`; `pnpm --filter canvas-workspace build`;
   relaunch.
2. Reproduce once; capture the EXACT error text + main-process log lines
   around `[canvas-agent-service]`.
3. Inspect bridge metadata without printing the plaintext key:

   ```bash
   node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync(process.env.HOME+"/.pulse-coder/canvas/pi-agent/models.json","utf8")).providers.canvas; console.log({baseUrl:m.baseUrl,models:m.models?.map(x=>x.id),apiKeyPresent:Boolean(m.apiKey)})'
   ```

   `baseUrl` MUST be `http://127.0.0.1:<port>` while the app runs. A real
   upstream URL there means the relay did not engage.
4. Bypass the app entirely:
   `PI_CODING_AGENT_DIR=~/.pulse-coder/canvas/pi-agent pi --mode json -p --no-session --provider canvas --model <id> "hi"`
   (app must be running for the relay port to be live). Success here =
   app-side wiring issue; same error = stream/client issue.
5. Inspect the raw upstream stream directly:
   `curl -N -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"model":"<id>","stream":true,"messages":[{"role":"user","content":"hi"}]}' <base_url>/chat/completions | cat -A | head -40`
   Look for: any `finish_reason` chunk? `[DONE]`? `\r\n\r\n` framing
   (`^M` in cat -A)? `event:` lines? content-type header.
6. Reproduce quirks locally with the committed mock:
   `MODE=nofinish PORT=45990 node apps/canvas-workspace/harness/tools/mock-openai-sse.mjs`
   (modes: ok | nofinish | nodone), point a scratch pi config at it, and
   extend the mock with whatever step 5 revealed.
7. Fix in `pi-stream-relay.ts` (normalization) or `pi-model-bridge.ts`
   (config mapping); pin with a case in `pi-stream-relay.test.ts`;
   `pnpm --filter canvas-workspace exec vitest run src/main/agent/backends`
   + typecheck must stay green; file-size gate: config.ts must stay ≤599.

## Also parked / adjacent

- The container-side screenshot demo (real app via
  `pnpm --filter canvas-workspace harness start --headless`) was prepared
  but abandoned when the user moved debugging local; Electron binary +
  build already work in-container if wanted later.
- Remaining roadmap: docs/09 v2-full (SDK embed) and the benchmark lane;
  engine-side P0s (compaction write-back, session primitives) unstarted.
