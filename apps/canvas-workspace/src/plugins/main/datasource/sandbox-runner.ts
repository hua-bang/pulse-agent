/**
 * Minimal in-process sandbox for LLM-authored code: transforms (polling
 * datasources) and actions (stateful datasources).
 *
 * Uses Node's `vm` module with a stripped-down global object — no
 * fetch / require / process / Buffer / timers, and `codeGeneration`
 * disabled so eval / new Function / wasm can't escape. Runs inside the
 * Electron main process; a runaway transform / action will impact the
 * main thread for at most one second before vm's `timeout` kills it.
 *
 * Safety boundaries enforced:
 *   - no host I/O (network / fs / process control)
 *   - no eval / new Function / wasm
 *   - sync infinite loops killed by vm `timeout`
 *
 * NOT enforced (by design, MVP):
 *   - heap is shared with the host (a transform that builds a huge
 *     object will OOM the host, not "the sandbox")
 *   - async loops cannot be timed out (we run sync only — see below)
 *   - this is NOT a security boundary against an adversarial author.
 *
 * Contract for `code`: a function body that uses the supplied globals
 * and ends with `return <value>`. NO `await`; sync only. Returning a
 * Promise will surface the Promise as the result; callers do not
 * unwrap it.
 */

import vm from "node:vm";

const EXEC_TIMEOUT_MS = 1_000;
const MAX_CODE_LENGTH = 20_000;

const noopConsole: Pick<
  Console,
  "log" | "info" | "warn" | "error" | "debug"
> = {
  log: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** Build a vm context that exposes only data-shaping built-ins plus
 *  the supplied per-call globals. Used identically for transforms
 *  and actions; the only difference is what's in `extras`. */
function buildContext(extras: Record<string, unknown>): vm.Context {
  const sandbox: Record<string, unknown> = {
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Map,
    Set,
    Symbol,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    console: noopConsole,
    ...extras,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  return vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
}

function runInSandbox(
  code: string,
  extras: Record<string, unknown>,
  filename: string,
): unknown {
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("code must be a non-empty string");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`code exceeds ${MAX_CODE_LENGTH} characters`);
  }
  const context = buildContext(extras);
  const wrapped = `'use strict';\n(function () {\n${code}\n})();`;
  const script = new vm.Script(wrapped, { filename });
  return script.runInContext(context, { timeout: EXEC_TIMEOUT_MS });
}

/**
 * `(input) => output`. Used by polling fetchers to shape raw data
 * before broadcasting. Async signature kept for forward-compat with a
 * future worker-thread / forked sandbox.
 */
export async function runTransform(
  code: string,
  input: unknown,
): Promise<unknown> {
  try {
    return runInSandbox(code, { input }, "datasource-transform.js");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`transform failed: ${message}`);
  }
}

/**
 * `(state, input) => newState`. Used by stateful actions: caller is
 * expected to have acquired the runner's mutex so two actions can't
 * read the same `state` and race.
 */
export async function runAction(
  code: string,
  state: unknown,
  input: unknown,
): Promise<unknown> {
  try {
    return runInSandbox(code, { state, input }, "datasource-action.js");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`action failed: ${message}`);
  }
}
