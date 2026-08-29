import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';

import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin.js';
import { TOOL_OFFLOAD_DIR, TOOL_OFFLOAD_THRESHOLD } from '../../config/index.js';
import { offloadToolOutput, type OffloadStore } from './offload.js';

export { measurePayloadSize, buildStub, offloadToolOutput } from './offload.js';
export type { OffloadStore, OffloadResult, OffloadOptions } from './offload.js';

export interface ToolOffloadPluginOptions {
  /**
   * Absolute directory to store offloaded results under. Overrides the
   * env/user-dir default. Defaults to `TOOL_OFFLOAD_DIR` if set, otherwise
   * `~/.pulse-coder/offload` — user-scoped so no host (even one with an
   * unpredictable cwd) ever writes runtime data into a source tree. Hosts that
   * want per-workspace isolation (e.g. the Canvas app) pass an explicit dir.
   */
  dir?: string;
  /** Payload-size threshold in chars. Defaults to TOOL_OFFLOAD_THRESHOLD. */
  threshold?: number;
}

function resolveOffloadDir(dir?: string): string {
  if (dir) {
    return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  }
  if (TOOL_OFFLOAD_DIR) {
    return path.isAbsolute(TOOL_OFFLOAD_DIR)
      ? TOOL_OFFLOAD_DIR
      : path.resolve(process.cwd(), TOOL_OFFLOAD_DIR);
  }
  return path.join(homedir(), '.pulse-coder', 'offload');
}

/**
 * Filesystem-backed {@link OffloadStore}. Writes are async (the engine runs on
 * GUI main threads — blocking I/O is forbidden, see AGENTS.md §6) and idempotent:
 * file names are content hashes, so an existing file with the same name already
 * holds identical bytes and the write is skipped.
 */
function createFsStore(dir: string): OffloadStore {
  let ensured: Promise<void> | undefined;
  const ensureDir = () => {
    if (!ensured) ensured = fs.mkdir(dir, { recursive: true }).then(() => undefined);
    return ensured;
  };

  return {
    dir,
    async write(fileName, content) {
      const filePath = path.join(dir, fileName);
      await ensureDir();
      try {
        await fs.access(filePath);
        // Same content hash ⇒ identical bytes already on disk; skip rewrite.
        return filePath;
      } catch {
        // Not present yet — write it.
      }
      await fs.writeFile(filePath, content, 'utf-8');
      return filePath;
    },
  };
}

/**
 * Built-in plugin: offloads oversized tool results to disk and replaces them in
 * the message history with a compact stub, so the model can read the full output
 * on demand instead of carrying it inline. Centralized in an `afterToolCall`
 * hook, it covers every tool in the set — built-in, MCP, and plugin tools alike.
 *
 * Built-in tools that already cap a single field at MAX_TOOL_OUTPUT_LENGTH
 * (read/bash/grep) stay below the threshold and are left untouched; the real
 * beneficiaries are uncapped sources like MCP tools and aggregate results such
 * as tavily's multi-result arrays.
 *
 * Retention policy — cache, NO automatic cleanup (by design). The offload
 * directory is treated as a content-addressed cache: files are named by content
 * hash (so identical results dedupe) and are intentionally never swept on a
 * timer, session end, or size limit. This is deliberate: a stub in the message
 * history is a durable pointer, and deleting the file it references would make
 * old sessions/sub-agents lose the full result. Do NOT add a background cleanup
 * sweep here — if disk pressure ever demands eviction, make it opt-in (env-gated
 * size/age cap) and pair it with graceful read-degradation for missing files.
 * The write path is decoupled from any eviction, so adding one later is easy.
 */
export function createToolOffloadPlugin(options: ToolOffloadPluginOptions = {}): EnginePlugin {
  return {
    name: 'pulse-coder-engine/built-in-tool-offload',
    version: '1.0.0',

    async initialize(context: EnginePluginContext): Promise<void> {
      const threshold = options.threshold ?? TOOL_OFFLOAD_THRESHOLD;
      if (!Number.isFinite(threshold) || threshold <= 0) {
        context.logger.warn('[ToolOffload] disabled: invalid threshold', { threshold });
        return;
      }

      const dir = resolveOffloadDir(options.dir);
      const store = createFsStore(dir);

      context.registerHook('afterToolCall', async ({ name, output, toolContext }) => {
        try {
          const apps = context.getService<{
            captureToolResult?: (toolName: string, toolCallId: string, result: unknown) => void;
          }>('mcp:__apps__');
          if (toolContext?.toolCallId) {
            apps?.captureToolResult?.(name, toolContext.toolCallId, output);
          }
          const result = await offloadToolOutput(output, { toolName: name, threshold, store });
          if (!result) return;
          context.logger.info('[ToolOffload] offloaded oversized tool output', {
            tool: name,
            payloadSize: result.payloadSize,
            path: result.path,
          });
          return { output: result.output };
        } catch (error) {
          // Best-effort: never let offloading failure break the tool call. Fall
          // back to returning the original (large) output unchanged.
          context.logger.warn('[ToolOffload] offload failed; keeping inline output', {
            tool: name,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      });

      context.logger.info('[ToolOffload] registered afterToolCall offloader', { dir, threshold });
    },
  };
}

/**
 * Default instance for the built-in plugin list (env/user-dir based). Hosts
 * that want per-workspace isolation (e.g. the Canvas app) should use
 * {@link createToolOffloadPlugin} with an explicit `dir` instead.
 */
export const builtInToolOffloadPlugin: EnginePlugin = createToolOffloadPlugin();

export default builtInToolOffloadPlugin;
