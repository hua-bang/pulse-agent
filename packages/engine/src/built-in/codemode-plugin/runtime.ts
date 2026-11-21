import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { CODEMODE_WORKER_SOURCE } from './worker-source.js';
import { truncateCodemodeText } from './output.js';

export interface CodemodeCatalogEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

export interface CodemodeCall {
  id: string;
  parentToolCallId: string;
  name: string;
  status: 'queued' | 'running' | 'succeeded' | 'intercepted' | 'failed' | 'cancelled';
  durationMs?: number;
  error?: string;
}

export interface CodemodeResult {
  ok: boolean;
  output: string[];
  value?: unknown;
  error?: string;
  calls: CodemodeCall[];
  /** Explicit text was clipped; output is a preview, never a complete artifact. */
  outputTruncated?: boolean;
}

export interface CodemodeRuntimeOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  /** Per-call UTF-8 argument budget; host-reviewed, at most the 1 MiB queue budget. */
  maxToolArgumentBytes?: number;
  /** Absolute quickjs-emscripten-core module entry for bundled hosts. */
  runtimeModulePath?: string;
  /** Absolute release-sync variant entry for bundled hosts. */
  wasmVariantModulePath?: string;
  /** Absolute CommonJS Emscripten loader entry for bundled hosts. */
  wasmLoaderModulePath?: string;
}

export async function runCodemode(options: CodemodeRuntimeOptions & {
  code: string;
  catalog: CodemodeCatalogEntry[];
  parentToolCallId: string;
  signal?: AbortSignal;
  executeTool(name: string, input: unknown, signal: AbortSignal, id: string, onIntercepted: () => void): Promise<unknown>;
  onCall?: (call: CodemodeCall) => void;
}): Promise<CodemodeResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const memoryLimitBytes = options.memoryLimitBytes ?? 64 * 1024 * 1024;
  const maxToolArgumentBytes = options.maxToolArgumentBytes ?? 64 * 1024;
  for (const [name, value] of Object.entries({ timeoutMs, memoryLimitBytes, maxToolArgumentBytes })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid Codemode ${name}`);
  }
  if (maxToolArgumentBytes > 1024 * 1024) throw new Error('Codemode argument budget exceeds the 1 MiB queue budget');
  const output: string[] = [];
  let outputTruncated = false;
  const calls: CodemodeCall[] = [];
  const boundOutput = (budget: number) => {
    const preview = truncateCodemodeText(output.join(''), budget, true);
    output.splice(0, output.length, ...(preview ? [preview] : []));
    outputTruncated = true;
  };
  const failure = (error: string): CodemodeResult => {
    if (outputTruncated) boundOutput(30_000);
    return { ok: false, output, calls, error,
      ...(outputTruncated ? { outputTruncated: true } : {}),
    };
  };
  if (Buffer.byteLength(options.code, 'utf8') > 64 * 1024) return failure('Codemode source limit exceeded');
  if (options.signal?.aborted) return failure('Codemode aborted');
  const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  let modulePath: string;
  let variantPath: string;
  let loaderPath: string;
  try {
    modulePath = options.runtimeModulePath ?? require.resolve('quickjs-emscripten-core');
    variantPath = options.wasmVariantModulePath ?? require.resolve('@jitl/quickjs-wasmfile-release-sync');
    loaderPath = options.wasmLoaderModulePath ?? require.resolve('@jitl/quickjs-wasmfile-release-sync/emscripten-module');
  } catch (error) {
    return failure(`Codemode runtime unavailable: ${String(error)}`);
  }
  const controller = new AbortController();
  const worker = new Worker(CODEMODE_WORKER_SOURCE, {
    eval: true,
    execArgv: [], // Trusted JS bootstrap must not inherit ESM/TS loader flags.
    workerData: {
      code: options.code, catalog: options.catalog, modulePath, variantPath, loaderPath,
      memoryLimitBytes, deadline: Date.now() + timeoutMs,
      maxToolArgumentBytes, maxCalls: 100, maxOutputChars: 30_000,
    },
  });
  let stopped = false;
  let totalResultBytes = 0;
  let totalOutputChars = 0;
  let queuedArgumentBytes = 0;
  let tail = Promise.resolve();
  const notify = (call: CodemodeCall) => {
    try { options.onCall?.({ ...call }); } catch { /* Observers cannot alter execution. */ }
  };
  return new Promise<CodemodeResult>((resolve) => {
    const finish = async (result: CodemodeResult) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      controller.abort();
      for (const call of calls) {
        if (call.status === 'running' || call.status === 'queued') {
          call.status = 'cancelled';
          notify(call);
        }
      }
      await worker.terminate();
      resolve(result);
    };
    const abort = () => { void finish(failure('Codemode aborted; completed calls were not undone')); };
    const timer = setTimeout(() => {
      void finish(failure('Codemode timed out; completed calls were not undone'));
    }, timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.on('error', error => { void finish(failure(`Codemode worker failed: ${String(error)}`)); });
    worker.on('exit', code => {
      if (!stopped) void finish(failure(`Codemode worker exited before completion (${code})`));
    });
    worker.on('message', (message) => {
      if (stopped) return;
      if (message.type === 'output-truncated') {
        outputTruncated = true;
        return;
      }
      if (message.type === 'output') {
        const remaining = 30_000 - totalOutputChars;
        const text = truncateCodemodeText(message.text, remaining);
        outputTruncated ||= message.truncated === true || text.length < message.text.length;
        totalOutputChars += text.length;
        if (text) output.push(text);
        return;
      }
      if (message.type === 'done') {
        if (!message.ok) {
          void finish(failure(`${String(message.error).slice(0, 1000)}; completed calls were not undone`));
        } else if (message.json !== undefined && message.json.length > 30_000) {
          void finish(failure('Codemode output limit exceeded'));
        } else {
          try {
            const value = message.json === undefined ? undefined : JSON.parse(message.json);
            const budget = 30_000 - (message.json?.length ?? 0);
            if (totalOutputChars > budget || outputTruncated) boundOutput(budget);
            void finish({ ok: true, output, calls, value,
              ...(outputTruncated ? { outputTruncated: true } : {}),
            });
          } catch {
            void finish(failure('Codemode returned invalid JSON'));
          }
        }
        return;
      }
      if (message.type !== 'call') return;
      if (calls.length >= 100) {
        void finish(failure('Codemode tool call limit exceeded'));
        return;
      }
      const call: CodemodeCall = {
        id: `${options.parentToolCallId}:${message.id}`,
        parentToolCallId: options.parentToolCallId,
        name: message.name,
        status: 'queued',
      };
      calls.push(call);
      notify(call);
      const argumentBytes = typeof message.args === 'string' ? Buffer.byteLength(message.args, 'utf8') : Infinity;
      if (argumentBytes > maxToolArgumentBytes || queuedArgumentBytes + argumentBytes > 1024 * 1024) {
        call.status = 'failed';
        call.error = 'Codemode tool argument or queue limit exceeded';
        worker.postMessage({ type: 'result', id: message.id, ok: false, error: call.error });
        notify(call);
        return;
      }
      queuedArgumentBytes += argumentBytes;
      tail = tail.then(async () => {
        queuedArgumentBytes -= argumentBytes;
        if (stopped) return;
        call.status = 'running';
        notify(call);
        const startedAt = Date.now();
        try {
          if (!options.catalog.some(item => item.name === message.name)) throw new Error('Tool is not authorized for Codemode');
          let intercepted = false;
          const result = await options.executeTool(message.name, JSON.parse(message.args), controller.signal, call.id, () => { intercepted = true; });
          if (stopped) return;
          const json = JSON.stringify(result);
          if (json === undefined) throw new Error('Tool result is not JSON serializable');
          const bytes = Buffer.byteLength(json);
          totalResultBytes += bytes;
          if (bytes > 2 * 1024 * 1024 || totalResultBytes > 16 * 1024 * 1024) throw new Error('Codemode tool result limit exceeded');
          call.status = intercepted ? 'intercepted' : 'succeeded';
          worker.postMessage({ type: 'result', id: message.id, ok: true, json });
        } catch (error) {
          if (stopped) return;
          call.status = 'failed';
          call.error = String(error).slice(0, 300);
          worker.postMessage({ type: 'result', id: message.id, ok: false, error: call.error });
        } finally {
          if (!stopped) {
            call.durationMs = Date.now() - startedAt;
            notify(call);
          }
        }
      });
    });
  });
}
