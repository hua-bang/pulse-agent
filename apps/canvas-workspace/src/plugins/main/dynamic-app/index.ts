/**
 * Dynamic-app plugin — main half.
 *
 * Registers three canvas-agent tools (`dynamic_app_create`,
 * `dynamic_app_list`, `dynamic_app_update`) that let the LLM put live,
 * server-backed iframe nodes on the canvas. Two flavours: polling
 * (external data on a schedule) and stateful (own state, mutated via
 * POST actions).
 *
 * Spec persistence lives directly under
 * `~/.pulse-coder/canvas/<workspaceId>/dynamic-apps/`, co-located with
 * canvas.json / nodes/ / artifacts.json. PluginStore is intentionally
 * NOT used — splitting workspace state across Electron's userData and
 * `~/.pulse-coder` was awkward for backup, inspection, and per-workspace
 * cleanup.
 *
 * Gated behind the `dynamic-app` experimental flag — when off the
 * plugin does not activate, the agent never sees the tools, the
 * reconciler does not run, and the shared HTTP server never binds.
 *
 * Also starts the reconciler so on every relaunch the persisted specs
 * fork their runners again, and orphan specs / runners get cleaned up
 * within ~30s.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { MainCanvasPlugin } from "../../types";
import {
  EXPERIMENTAL_FLAG_DYNAMIC_APP,
  resolveFeatureValues,
} from "../../../shared/experimental-features";
import { DynamicAppManager } from "./manager";
import { startReconciler } from "./reconciler";
import { createDynamicAppTools } from "./tools";
import { deleteState, getSpec } from "./store";

function experimentalFlagsPath(): string {
  const envPath = process.env.PULSE_CANVAS_EXPERIMENTAL_FEATURES?.trim();
  return (
    envPath ||
    join(homedir(), ".pulse-coder", "canvas", "experimental-features.json")
  );
}

/**
 * Synchronous flag read — `enabledWhen` runs at plugin registration time
 * (before the renderer is up), so we cannot round-trip through IPC.
 * Missing / unparseable file falls through to registry defaults (flag
 * off → plugin inactive).
 */
function isDynamicAppEnabled(): boolean {
  let overrides: Record<string, boolean> = {};
  try {
    const raw = readFileSync(experimentalFlagsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") overrides[k] = v;
      }
    }
  } catch {
    overrides = {};
  }
  return resolveFeatureValues(overrides)[EXPERIMENTAL_FLAG_DYNAMIC_APP] === true;
}

export const DynamicAppPlugin: MainCanvasPlugin = {
  id: "dynamic-app",
  enabledWhen: isDynamicAppEnabled,
  activate(ctx) {
    const manager = new DynamicAppManager();
    ctx.registerCanvasTool((workspaceId) =>
      createDynamicAppTools(workspaceId, manager),
    );
    startReconciler(manager);

    // Renderer-side inspector IPC. Channels auto-prefixed `plugin:dynamic-app:`
    // by the plugin registry.

    ctx.handle("get-spec", async (_event, ...args: unknown[]) => {
      const [workspaceId, dynamicAppId] = args as [string, string];
      try {
        const persisted = await getSpec(workspaceId, dynamicAppId);
        if (!persisted) return { ok: false, error: "spec not found" };
        return { ok: true, spec: persisted.spec, createdAt: persisted.createdAt };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    /** Restart the runner with the existing persisted spec. State (for
     *  stateful apps) survives — `manager.start` reads the state file
     *  on init. Returns the new URL so the renderer can refresh the
     *  iframe with a cache buster. */
    ctx.handle("restart", async (_event, ...args: unknown[]) => {
      const [workspaceId, dynamicAppId] = args as [string, string];
      try {
        const persisted = await getSpec(workspaceId, dynamicAppId);
        if (!persisted) return { ok: false, error: "spec not found" };
        const { url } = await manager.start(
          workspaceId,
          dynamicAppId,
          persisted.spec,
        );
        return { ok: true, url };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    /** Stateful only: wipe the persisted state file, then restart the
     *  runner. `manager.start` will fall back to `spec.state.initial`
     *  because no state file exists. */
    ctx.handle("reset-state", async (_event, ...args: unknown[]) => {
      const [workspaceId, dynamicAppId] = args as [string, string];
      try {
        const persisted = await getSpec(workspaceId, dynamicAppId);
        if (!persisted) return { ok: false, error: "spec not found" };
        if (persisted.spec.kind !== "stateful") {
          return {
            ok: false,
            error: "reset-state only applies to stateful apps",
          };
        }
        await manager.stop(dynamicAppId);
        await deleteState(workspaceId, dynamicAppId);
        const { url } = await manager.start(
          workspaceId,
          dynamicAppId,
          persisted.spec,
        );
        return { ok: true, url };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  },
};
