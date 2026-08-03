# pi-backed chat: debug handoff

Date: 2026-08-03
Branch: `claude/canvas-workspace-planning-m7ca4o`
Status: user still reports failure on their machine with a third-party
OpenAI-compatible provider; container-side evidence says the shipped chain
works against reproduced quirks. This doc is the complete handoff for a
local agent to close the gap.

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

Assumed (NOT yet verified on the user's machine):
- the user's proxy's exact SSE framing and finish behavior;
- that their running dist includes `b6398be`+;
- that the relay engaged (models.json baseUrl should be loopback);
- their model id and whether pi's catalog treats it specially.

## Ranked suspects for the remaining failure

1. **Stale build**: old dist without bridge/relay. Check first.
2. ~~CRLF-framed SSE~~ — the relay only split events on `\n\n` until
   HEAD; CRLF (`\r\n\r\n`) framing is common among proxies and would have
   bypassed normalization entirely. HARDENED at HEAD (accepts both) but
   unverified against the user's proxy.
3. Proxy quirks beyond framing: `event:`-prefixed lines, multi-`data:`
   events, non-`text/event-stream` content-type despite streaming (relay
   then passes through un-normalized — check response headers), HTTP/2-only
   endpoints, gzip with unusual transfer-encoding.
4. A DIFFERENT error than finish_reason (no log captured for round 3) —
   e.g. approval gate, cwd resolution, extension load failure, or the
   engine path erroring before pi is even reached.

## Debug checklist for the local agent (in order)

1. `git log --oneline -3` → confirm ≥ `b6398be` (relay) or HEAD (CRLF
   hardening); `pnpm --filter canvas-workspace build`; relaunch.
2. Reproduce once; capture the EXACT error text + main-process log lines
   around `[canvas-agent-service]`.
3. `cat ~/.pulse-coder/canvas/pi-agent/models.json` — baseUrl MUST be
   `http://127.0.0.1:<port>` while the app runs. Real upstream URL there =
   relay not engaged (stale build or claude-typed provider).
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
