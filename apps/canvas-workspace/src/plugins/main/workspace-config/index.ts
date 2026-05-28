/**
 * Workspace-config engine plugin — bridges the per-workspace + global
 * MCP / skills config (stored on disk by `main/config/workspace-config-store.ts`)
 * into the canvas-agent Engine.
 *
 * Lifecycle:
 *   - `initialize(ctx)`: read the merged config once, connect every MCP
 *     server, materialise every remote/inline skill, register the resulting
 *     tools on the engine, and start a fs.watch debounced loop that flips
 *     `pendingHash` whenever any of the four config files changes.
 *   - `beforeRun` hook: if `pendingHash !== appliedHash`, run a reconcile
 *     pass before the next agent turn starts. Reconcile is at run-boundary
 *     so an in-flight turn keeps its frozen tool snapshot — the user sees
 *     no interruption, the next turn sees the new tool set.
 *
 * MCP reconcile diffs server-name → config-hash. Removed servers are
 * disconnected and their `mcp_<server>_*` tools dropped via
 * `ctx.unregisterTool`. Added / changed servers connect fresh.
 *
 * Skills reconcile is trivial: re-fetch + re-scan into the engine's
 * `BuiltInSkillRegistry` via its new `reload({ extraSkills })` entrypoint.
 * The `skill` tool itself is a single dispatcher that closes over the
 * registry, so no tool re-registration is needed; we just refresh the
 * description prompt by registering a new tool with the same name.
 */

import { watch, type FSWatcher } from 'fs';
import { createHash } from 'crypto';
import { z } from 'zod';
import {
  type EnginePlugin,
  type EnginePluginContext,
  type BuiltInSkillRegistry,
  type SkillInfo,
  type NormalizedMCPServerConfig,
  type RawMCPServerConfig,
  normalizeServerConfig,
  createTransport,
} from 'pulse-coder-engine';
import { createMCPClient } from '@ai-sdk/mcp';
import {
  readMergedConfig,
  configPaths,
  type WorkspaceSkillEntry,
} from '../../../main/config/workspace-config-store';
import { materialiseSkills } from '../../../main/config/remote-skill-fetcher';

// ---------------------------------------------------------------------------
// MCP server tracking
// ---------------------------------------------------------------------------

interface ConnectedServer {
  /** sha256 of the normalised config — re-connect only when this changes. */
  configHash: string;
  client: Awaited<ReturnType<typeof createMCPClient>>;
  toolNames: string[];
}

function hashServerConfig(cfg: RawMCPServerConfig): string {
  const canonical = JSON.stringify(cfg, Object.keys(cfg).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

async function connectServer(
  serverName: string,
  raw: RawMCPServerConfig,
): Promise<{ client: ConnectedServer['client']; toolNames: string[]; tools: Record<string, unknown> } | null> {
  const normalised: NormalizedMCPServerConfig | null = normalizeServerConfig(serverName, raw);
  if (!normalised) return null;
  const transport = createTransport(normalised);
  const client = await createMCPClient({ transport });
  const tools = await client.tools();
  const namespaced: Record<string, unknown> = {};
  const toolNames: string[] = [];
  const deferLoading = normalised.deferTools === true;
  for (const [name, tool] of Object.entries(tools)) {
    const ns = `mcp_${serverName}_${name}`;
    namespaced[ns] = deferLoading ? { ...(tool as any), defer_loading: true } : tool;
    toolNames.push(ns);
  }
  return { client, toolNames, tools: namespaced };
}

async function closeServer(name: string, server: ConnectedServer): Promise<void> {
  try {
    await server.client.close?.();
  } catch (err) {
    console.warn(`[workspace-config] close MCP "${name}" failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Skill tool (mirrors built-in skills plugin's dispatcher)
// ---------------------------------------------------------------------------

function buildSkillTool(registry: BuiltInSkillRegistry) {
  const all = registry.getAll();
  const description = [
    "If the query matches an available skill's description, call the `skill` tool with its name to fetch step-by-step instructions before acting.",
    'Skills available:',
    '<available_skills>',
    ...all.flatMap((s) => [`  <skill><name>${s.name}</name><description>${s.description}</description></skill>`]),
    '</available_skills>',
  ].join(' ');
  return {
    name: 'skill',
    description,
    inputSchema: z.object({ name: z.string().describe('Skill name to load') }),
    execute: async ({ name }: { name: string }) => {
      const skill = registry.get(name);
      if (!skill) throw new Error(`Skill ${name} not found`);
      return skill;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface WorkspaceConfigPluginOptions {
  workspaceId: string;
  /** Override for tests — defaults to a real BuiltInSkillRegistry. */
  skillRegistry?: BuiltInSkillRegistry;
  /** Override for tests — skips fs.watch. */
  disableWatch?: boolean;
}

export function createWorkspaceConfigPlugin(opts: WorkspaceConfigPluginOptions): EnginePlugin {
  const { workspaceId } = opts;
  const connected = new Map<string, ConnectedServer>();
  let appliedHash = '';
  let pendingHash = '';
  let reconciling: Promise<void> | null = null;
  let watchers: FSWatcher[] = [];
  let registry: BuiltInSkillRegistry;
  let ctxRef: EnginePluginContext | null = null;

  async function reconcile(): Promise<void> {
    if (!ctxRef) return;
    const ctx = ctxRef;
    const merged = await readMergedConfig(workspaceId);

    // -- MCP diff --
    const desiredHashes = new Map<string, string>();
    for (const [name, cfg] of Object.entries(merged.mcpServers)) {
      desiredHashes.set(name, hashServerConfig(cfg));
    }

    // Remove gone / changed.
    for (const [name, server] of [...connected.entries()]) {
      const desired = desiredHashes.get(name);
      if (desired && desired === server.configHash) continue;
      for (const tool of server.toolNames) ctx.unregisterTool(tool);
      await closeServer(name, server);
      connected.delete(name);
    }

    // Add / re-connect.
    for (const [name, cfg] of Object.entries(merged.mcpServers)) {
      if (connected.has(name)) continue;
      try {
        const result = await connectServer(name, cfg);
        if (!result) continue;
        ctx.registerTools(result.tools as Record<string, any>);
        connected.set(name, {
          configHash: desiredHashes.get(name)!,
          client: result.client,
          toolNames: result.toolNames,
        });
      } catch (err) {
        console.warn(
          `[workspace-config] connect MCP "${name}" failed: ${(err as Error).message}`,
        );
      }
    }

    // -- Skills reconcile --
    const extraSkills = await materialiseSkills(merged.skills);
    await registry.reload({ extraSkills });
    // Re-register the skill tool so its description reflects the new set.
    ctx.registerTool('skill', buildSkillTool(registry));

    appliedHash = merged.configHash;
    console.log(
      `[workspace-config] reconciled workspace=${workspaceId} ` +
        `mcp=${connected.size} skills=${registry.getAll().length}`,
    );
  }

  function scheduleReconcileIfPending(): Promise<void> {
    if (appliedHash === pendingHash) return Promise.resolve();
    if (reconciling) return reconciling;
    reconciling = (async () => {
      try {
        await reconcile();
      } finally {
        reconciling = null;
      }
    })();
    return reconciling;
  }

  function startWatchers(): void {
    if (opts.disableWatch) return;
    const paths = configPaths(workspaceId);
    let debounce: NodeJS.Timeout | null = null;
    const onChange = async () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          const merged = await readMergedConfig(workspaceId);
          pendingHash = merged.configHash;
        } catch (err) {
          console.warn(`[workspace-config] watcher re-read failed: ${(err as Error).message}`);
        }
      }, 200);
    };
    for (const p of Object.values(paths)) {
      try {
        // fs.watch on a non-existent file throws; watch its parent dir
        // instead so creation also triggers.
        const parent = p.substring(0, p.lastIndexOf('/'));
        const w = watch(parent, { persistent: false }, (_, filename) => {
          if (filename && p.endsWith(filename.toString())) void onChange();
        });
        watchers.push(w);
      } catch {
        // Directory doesn't exist yet — we'll miss this file until it's
        // created via the IPC save path (which creates the dir + file
        // and then triggers a manual reconcile through a future hook).
      }
    }
  }

  return {
    name: `canvas-workspace/workspace-config:${workspaceId}`,
    version: '1.0.0',
    async initialize(context: EnginePluginContext) {
      ctxRef = context;
      registry =
        opts.skillRegistry ??
        ((context.getService('skillRegistry') as BuiltInSkillRegistry | undefined) ??
          (await (async () => {
            const mod = await import('pulse-coder-engine');
            return new mod.BuiltInSkillRegistry();
          })()));
      // Always (re)expose the registry so other consumers see it.
      context.registerService('skillRegistry', registry);

      // Prime initial state.
      const merged = await readMergedConfig(workspaceId);
      pendingHash = merged.configHash;
      await reconcile();

      // Reconcile on every run start — invisible if nothing changed
      // (hash compare is O(1)).
      context.registerHook('beforeRun', async () => {
        await scheduleReconcileIfPending();
      });

      startWatchers();
    },
    async destroy() {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      watchers = [];
      for (const [name, server] of connected.entries()) {
        await closeServer(name, server);
      }
      connected.clear();
    },
  };
}
