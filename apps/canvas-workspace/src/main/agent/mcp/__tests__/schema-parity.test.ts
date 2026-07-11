import { describe, expect, it } from 'vitest';
import type { HTTPOrSSEServerConfig } from 'pulse-coder-engine/built-in';
import type { CanvasMcpAuth, CanvasMcpServer } from '../config';

/**
 * MCP schema parity — canvas-workspace <-> engine (type-level).
 *
 * `../config.ts`'s header comment says its validation "mirrors the plugin's
 * normalizer" in `packages/engine/src/built-in/mcp-plugin/index.ts`, but
 * until this file that was prose-only: nothing broke at compile time if the
 * two shapes drifted apart. The real contract is directional: canvas WRITES
 * `mcp.json` (`upsertCanvasMcpServer` / `importCanvasMcpJson` in
 * `../config.ts`) and the engine's built-in MCP plugin READS it
 * (`loadMCPConfig` / `normalizeServerConfig` in
 * `packages/engine/src/built-in/mcp-plugin/index.ts`). So the assignability
 * that actually matters is: canvas's normalized server shape must be
 * assignable to what the engine accepts — not the reverse.
 *
 * Only `HTTPOrSSEServerConfig` is exported from the engine's public surface
 * (`packages/engine/src/built-in/index.ts`, re-exported at the
 * `pulse-coder-engine/built-in` subpath — importing the SAME name from the
 * bare `pulse-coder-engine` root specifier fails to resolve against the
 * current build output's chunk-splitting, so use the subpath).
 * `StdioServerConfig` is NOT exported at all, so the stdio transport half of
 * this contract has no compile-time check available from this package; this
 * file is scoped to http/sse. (The storage-schema side of canvas-workspace
 * <-> canvas-cli parity is a separate mechanism: see
 * `apps/canvas-workspace/harness/tools/describe-canvas.mjs` section 4.)
 */

/** Compiles iff `B` is assignable to `A`; a documentation-grade type assertion. */
type AssertAssignable<A, B extends A> = B;

// Model the http/sse variant canvas actually produces: `normalizeServer()`
// in `../config.ts` always sets `transport` to 'http' | 'sse' on this branch
// and always supplies a non-empty `url` (it throws before writing
// otherwise), so narrow those two fields to what actually lands in
// mcp.json.
type CanvasHttpSseServer = CanvasMcpServer & { transport: 'http' | 'sse'; url: string };

// ─── Direction 1 (the real contract): what canvas WRITES must satisfy what
// the engine ACCEPTS, for every field EXCEPT `oauth` (see KNOWN DRIFT below
// — full-object assignability including `oauth` does not compile today).
// If this line fails, canvas's normalized http/sse server shape no longer
// satisfies the engine's built-in MCP plugin on transport/url/headers/
// auth/deferTools/disabledTools — an mcp.json file canvas considers valid
// could fail engine-side loading.
type _CanvasCoreFieldsSatisfyEngine = AssertAssignable<
  Omit<HTTPOrSSEServerConfig, 'oauth'>,
  Omit<CanvasHttpSseServer, 'oauth'>
>;

// ─── KNOWN DRIFT #1 (real, currently-true): `oauth`. Engine types it as the
// escape hatch `oauth?: Record<string, unknown>`
// (`packages/engine/src/built-in/mcp-plugin/index.ts`); canvas types it as
// the concrete `CanvasMcpOAuthConfig` interface
// (`{ clientId?: string; clientSecret?: string; scope?: string }` in
// `../config.ts`). TypeScript's structural rules do not treat a plain
// interface without an index signature as assignable to
// `Record<string, unknown>` ("Index signature for type 'string' is missing
// in type 'CanvasMcpOAuthConfig'") even though every value canvas can
// actually produce is a valid `Record<string, unknown>` at runtime. This
// full-object check documents that gap precisely; if either side's `oauth`
// type changes, this line will either compile (delete the
// `@ts-expect-error`) or fail differently (investigate before deleting).
// @ts-expect-error - CanvasMcpOAuthConfig has no string index signature, so it does not structurally satisfy engine's oauth?: Record<string, unknown>, even though canvas's normalizeOAuthConfig() only ever produces plain string-keyed objects
type _CanvasFullyIncludingOauthSatisfiesEngine = AssertAssignable<HTTPOrSSEServerConfig, CanvasHttpSseServer>;

// ─── KNOWN DRIFT #2 (real, currently-true, the drift `../config.ts`'s
// header comment alludes to): `auth`. Engine's accepted `auth` is any
// `string` (`HTTPOrSSEServerConfig['auth']: string`); canvas's typed model
// narrows it to `'none' | 'oauth'`
// (`export type CanvasMcpAuth = 'none' | 'oauth'` in `../config.ts`).
// Direction 1 above (canvas -> engine) compiles fine for `auth` because a
// narrower string union is always assignable to `string`. The drift only
// shows up in the OTHER direction: a config value the engine would happily
// accept (e.g. `auth: "bearer"`) does not fit canvas's narrower type. This
// is harmless today because canvas's own `normalizeAuth()` only ever writes
// `'oauth'` (or omits the field) — but if the engine's normalizer ever
// starts validating `auth` against a fixed set, or canvas's union widens,
// revisit this block.
function _knownAuthDrift(engineAuth: HTTPOrSSEServerConfig['auth']): CanvasMcpAuth | undefined {
  // @ts-expect-error - engine's auth is an unconstrained string; canvas's CanvasMcpAuth union does not accept an arbitrary string without narrowing
  const asCanvasAuth: CanvasMcpAuth = engineAuth;
  return asCanvasAuth;
}
void _knownAuthDrift;

describe('MCP schema parity: canvas-workspace <-> engine', () => {
  it('binds this compile-time check to its two source files', () => {
    // The real assertions in this file are the type-level lines above: they
    // fail `pnpm --filter canvas-workspace typecheck`, not `vitest run`, the
    // moment either shape drifts. `vitest run` does not type-check test
    // files, so this runtime case exists only to give `pnpm test` a
    // human-readable pointer at the two files that must stay in sync.
    const engineSource = 'packages/engine/src/built-in/mcp-plugin/index.ts (HTTPOrSSEServerConfig)';
    const canvasSource = 'apps/canvas-workspace/src/main/agent/mcp/config.ts (CanvasMcpServer, CanvasMcpAuth)';
    expect(`canvas persists what engine loads: ${canvasSource} -> ${engineSource}`).toContain(
      'apps/canvas-workspace/src/main/agent/mcp/config.ts',
    );
  });
});
