/**
 * Adapter around pulse-sandbox for running the pure-JS `transform` step
 * of a datasource spec.
 *
 * pulse-sandbox's contract: code body runs inside `(async () => { … })()`
 * with `input` as a global and must `return` a value. We pass it through
 * unchanged — the spec already documents this contract to the LLM.
 *
 * Each call forks a fresh runner process (pulse-sandbox internal), runs
 * with a 1s timeout, then exits. That's the right safety model for an
 * MVP: even at 1Hz polling the fork cost is negligible, and the LLM
 * cannot accumulate state across calls.
 */

import { createJsExecutor, type JsExecutor } from "pulse-sandbox";

let executor: JsExecutor | undefined;

function getExecutor(): JsExecutor {
  if (!executor) {
    executor = createJsExecutor({
      timeoutMs: 1_000,
      memoryLimitMb: 64,
      maxOutputChars: 20_000,
      maxCodeLength: 20_000,
    });
  }
  return executor;
}

export async function runTransform(
  code: string,
  input: unknown,
): Promise<unknown> {
  const result = await getExecutor().execute({ code, input });
  if (!result.ok) {
    const err = result.error;
    throw new Error(
      err ? `transform failed (${err.code}): ${err.message}` : "transform failed",
    );
  }
  return result.result;
}
