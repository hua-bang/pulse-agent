/**
 * Dynamic-app plugin — main half.
 *
 * Registers ONE canvas-agent tool (`dynamic_app_create`) that lets
 * the LLM put a "live data node" on the canvas: a small iframe pointed
 * at a localhost server backed by a per-node in-process runner.
 *
 * Spec persistence lives directly under
 * `~/.pulse-coder/canvas/<workspaceId>/dynamic-apps/`, co-located with
 * canvas.json / nodes/ / artifacts.json. PluginStore is intentionally
 * NOT used — splitting workspace state across Electron's userData and
 * `~/.pulse-coder` was awkward for backup, inspection, and per-workspace
 * cleanup.
 *
 * Also starts the reconciler so on every relaunch the persisted specs
 * fork their runners again, and orphan specs / runners get cleaned up
 * within ~30s.
 */

import type { MainCanvasPlugin } from "../../types";
import { DynamicAppManager } from "./manager";
import { startReconciler } from "./reconciler";
import { createDynamicAppTools } from "./tools";

export const DynamicAppPlugin: MainCanvasPlugin = {
  id: "dynamic-app",
  activate(ctx) {
    const manager = new DynamicAppManager();
    ctx.registerCanvasTool((workspaceId) =>
      createDynamicAppTools(workspaceId, manager),
    );
    startReconciler(manager);
  },
};
