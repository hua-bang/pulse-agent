/**
 * Minimal in-process sandbox for the LLM-authored `transform` step.
 *
 * Uses Node's `vm` module with a stripped-down global object — no
 * fetch / require / process / Buffer / timers, and `codeGeneration`
 * disabled so eval / new Function / wasm can't escape. Runs inside the
 * datasource child process so a misbehaving transform can crash that
 * child but not the Electron main process.
 *
 * Safety boundaries we DO enforce:
 *   - no host I/O (network / fs / process control)
 *   - no eval / new Function / wasm
 *   - sync infinite loops killed by vm's `timeout` option
 *
 * Safety boundaries we do NOT enforce — by design, MVP:
 *   - heap is shared with the host child (a transform that builds a
 *     huge object will OOM the child, not "the sandbox")
 *   - async loops cannot be timed out (we run sync only — see below)
 *   - this is NOT a security boundary against an adversarial author.
 *     For that we'd switch to worker_threads or a forked child; the
 *     export shape stays Promise-returning so upgrading later is a
 *     pure implementation swap.
 *
 * Contract for `code`: a function body. Has `input` as a global (the
 * raw fetched value) and must `return` the shaped output. NO `await` —
 * the body runs synchronously; returning a Promise will surface that
 * Promise as the result (caller is welcome to await it but the
 * sandbox doesn't).
 */

import vm from "node:vm";

const TRANSFORM_TIMEOUT_MS = 1_000;
const MAX_CODE_LENGTH = 20_000;

/**
 * Expose a narrow set of built-ins. Anything not listed here is
 * `undefined` inside the sandbox — which is the right default for
 * data-shaping code.
 */
function buildContext(input: unknown): vm.Context {
  // `console` is a no-op proxy: transforms that accidentally log
  // shouldn't spam the child's stderr.
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

  const sandbox: Record<string, unknown> = {
    input,
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
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  return vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
}

/**
 * Async signature kept on purpose: callers don't need to change when we
 * eventually swap the implementation for a worker thread / forked
 * process to get hard isolation.
 */
export async function runTransform(
  code: string,
  input: unknown,
): Promise<unknown> {
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("transform: code must be a non-empty string");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(
      `transform: code exceeds ${MAX_CODE_LENGTH} characters`,
    );
  }

  const context = buildContext(input);
  // Wrap so the body can `return`. Strict mode locks down a few
  // historic footguns (octal literals, implicit globals, etc.).
  const wrapped = `'use strict';\n(function () {\n${code}\n})();`;
  const script = new vm.Script(wrapped, {
    filename: "datasource-transform.js",
  });

  try {
    return script.runInContext(context, {
      timeout: TRANSFORM_TIMEOUT_MS,
      // breakOnSigint not set — we never SIGINT a datasource child
      // mid-transform; the parent kills with SIGTERM and the runner
      // cleans up on the way out.
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`transform failed: ${message}`);
  }
}
