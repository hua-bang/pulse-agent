# `@` file references and image input

## Where expansion happens

Both interactive hosts expand `@path` references at submit time:

| Host | Entry point |
|---|---|
| Ink (default) | `src/ink/controller-run.ts` `runMessage` |
| Readline (fallback) | `src/readline/agent-turn.ts` `executeAgentTurn` |

The readline host historically did NOT expand refs; since image input landed it uses
the same `expandFileReferences` pipeline so the two hosts cannot drift.

Shared logic lives in `src/shared/file-reference.ts`; the `@` completion index is
built in the background after engine init and is keyboard-handled before the slash
palette (`useInput` / `use-composer-layout.ts`).

## Behavior contract

- The transcript keeps the raw text the user typed (auto-title and the memory/daily
  log use it); the model gets text contents appended below, with the `@ref` tokens
  still present so it sees what the user pointed at.
- Expansion is bounded: per-file bytes (`maxFileBytes`, 64KB), attachment count
  (`maxFiles`, 20), directory entries (`maxDirEntries`, 40). It refuses binaries
  and any path escaping the workspace (`isInsideWorkspace` — a raw `startsWith`
  is NOT enough; use `path.relative`).
- **Images are vision input, not text.** `.png/.jpg/.jpeg/.gif/.webp` references
  become AI SDK `{ type: 'image', image: <dataUrl> }` content parts via
  `buildUserContent`, bounded by `maxImageBytes` (5MB default — matches Anthropic's
  per-image cap). They are NOT appended as text blocks and are not skipped as
  "binary". Other image extensions (`.ico/.bmp/.tiff`) and all other binaries stay
  skipped because OpenAI/Anthropic-compatible providers reject them as image parts.
- Both hosts push structured content ONLY when images are present; a text-only turn
  stays a plain string so history remains byte-identical for cache-friendly prompts.
- Oversized images (>5MB) and empty image files are skipped with a reason.

## Why 5MB

Anthropic rejects images over 5MB per part. `maxImageBytes` is the SSOT for the
cap; keep it aligned with provider limits when touching it. Data URLs grow ~1.37x
in base64, and `estimateTokens` JSON-stringifies the part, so a large image
inflates the ctx% estimate exactly like the provider's image-token cost would —
that is desired for compaction triggering.
