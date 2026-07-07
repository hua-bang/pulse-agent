# Built-in Tools Reference

The default tool set every host inherits (unless overridden). Verified against `src/tools/*`; shared limits live in `src/config/index.ts`.

## Assembly

`tools/index.ts`: `BuiltinTools` is a readonly tuple of 13 tools; `BuiltinToolsMap` keys by each tool's runtime `name`; `getFinalToolsMap(custom)` spreads custom over built-ins — same-name custom tools silently win. `deferDemoTool` is in the array/map but NOT in the named-export block. A commented-out `SkillTool` import marks a planned-but-unwired tool.

## Reference Cards

- **read** — `filePath`, `offset?` (0-based), `limit?`. Whole file without offset/limit; otherwise `"  N→line"` numbering (1-based). Truncated output. Throws on missing file, directory (points to `ls`), out-of-range offset. Dedup-wrapped by the loop.
- **write** — `filePath`, `content`. `mkdir -p` then overwrite, always. Returns `{success, created, bytes}`. No truncation; fs errors propagate.
- **edit** — `filePath`, `oldString`, `newString`, `replaceAll?`. Default mode requires an exact AND unique match ("old_string is not unique…" otherwise); `replaceAll` replaces every occurrence. Returns replacement count + 200-char context preview.
- **grep** — assembles an `rg` command string and runs it with **`execSync`** (`/bin/bash`, 10MB maxBuffer) — the known blocking-I/O risk (root `AGENTS.md` §6 class). `outputMode` files_with_matches/count/content, `-i`, `-U`, glob/type filters; `offset/headLimit` via shell `tail|head`. rg exit 1 = "(no matches found)"; other failures throw with stderr AND the constructed command embedded.
- **ls** — `path?` (default `.`). Plain `readdirSync`, names only, no recursion/stats. Dedup-wrapped by the loop.
- **bash** — `command`, `timeout?` (default 120 000 ms, max 600 000, out-of-range throws), `cwd?`. Async `spawn` on `/bin/bash`; stdout/stderr capped at 10 MB each (pipe keeps draining, excess dropped with a truncation note). Timeout or `abortSignal` → `SIGTERM`, then `SIGKILL` after 2 000 ms grace. Never throws for command failure — reports `{output, error?, exitCode}`.
- **tavily / tavily_extract / tavily_crawl / tavily_map** — shared `tavilyPost`: `TAVILY_API_KEY` required (throws), `TAVILY_API_BASE_URL` default `https://api.tavily.com`, optional project header. Per-call timeout default 120 000 ms, clamped 1–600 000. `tavily` (search) loads immediately; the other three are `defer_loading: true`. Non-OK HTTP throws with parsed detail.
- **generate_image** — `defer_loading: true`. Providers: openai (`images` / `responses` / `responses_stream` / `auto` via `OPENAI_IMAGE_API_MODE`, default `responses`) and gemini (`GEMINI_API_KEY`, v1beta or Vertex by base URL). `auto` tries images then FALLS BACK to responses on any error, embedding the prior error in the final message. Writes the image under `.pulse-coder/generated-images/` by default; localhost endpoints bypass the env proxy via a local undici Agent. Timeout default 300 000 ms (`OPENAI_IMAGE_TIMEOUT_MS`).
- **clarify** — `question`, `context?`, `defaultAnswer?`, `timeout?` (default `CLARIFICATION_TIMEOUT` = 300 000 ms, env-overridable). Requires `ToolExecutionContext.onClarificationRequest` (throws without it). Races callback vs timeout; on timeout returns `{answer: defaultAnswer, timedOut: true}` if a default exists, else rethrows.
- **deferred_demo** — `defer_loading: true` demo echo; exercises the deferred-tool mechanism, no I/O.

## Cross-Cutting

- `ToolExecutionContext`: `onClarificationRequest?`, `abortSignal?`, `runContext?`, `toolCallId?` — all optional; only `bash` and `clarify` consume it among built-ins.
- `defer_loading` / `deferLoading` (both casings honored by the tool-search plugin's filters) hides a tool until tool-search loads it.
- `truncateOutput` (`utils.ts`): caps at `MAX_TOOL_OUTPUT_LENGTH` = 30 000 chars, keeping head + tail and inserting `... [truncated N characters] ...` in the middle — never a blind cutoff. Used by read/edit/grep/bash and all Tavily tools.
- The loop wraps only `read`/`ls` with access dedup for the lifetime of one `loop()` call — a soft "already accessed" note appended to repeat reads, not a block (see `loop-lifecycle.md`).
