import { promises as fs } from 'fs';
import path from 'path';

import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin.js';
import { TOOL_OFFLOAD_DIR, TOOL_OFFLOAD_THRESHOLD } from '../../config/index.js';
import { offloadToolOutput, type OffloadStore } from './offload.js';

export { measurePayloadSize, buildStub, offloadToolOutput } from './offload.js';
export type { OffloadStore, OffloadResult, OffloadOptions } from './offload.js';

function resolveOffloadDir(): string {
  if (TOOL_OFFLOAD_DIR) {
    return path.isAbsolute(TOOL_OFFLOAD_DIR)
      ? TOOL_OFFLOAD_DIR
      : path.resolve(process.cwd(), TOOL_OFFLOAD_DIR);
  }
  return path.resolve(process.cwd(), '.pulse-coder', 'offload');
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
 */
export const builtInToolOffloadPlugin: EnginePlugin = {
  name: 'pulse-coder-engine/built-in-tool-offload',
  version: '1.0.0',

  async initialize(context: EnginePluginContext): Promise<void> {
    const threshold = TOOL_OFFLOAD_THRESHOLD;
    if (!Number.isFinite(threshold) || threshold <= 0) {
      context.logger.warn('[ToolOffload] disabled: invalid TOOL_OFFLOAD_THRESHOLD', { threshold });
      return;
    }

    const dir = resolveOffloadDir();
    const store = createFsStore(dir);

    context.registerHook('afterToolCall', async ({ name, output }) => {
      try {
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

export default builtInToolOffloadPlugin;
