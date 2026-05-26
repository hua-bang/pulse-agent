/**
 * Datasource plugin — main half.
 *
 * Registers ONE canvas-agent tool (`datasource_node_create`) that lets
 * the LLM put a "live data node" on the canvas: a small iframe pointed
 * at a localhost server backed by a per-node child process.
 *
 * Also starts the reconciler so on every relaunch the persisted specs
 * fork their children again, and orphan specs / children get cleaned up
 * within ~30s.
 *
 * No `enabledWhen` gate — the tool is harmless when unused and we want
 * the agent to discover it. Add an experimental flag if/when we need
 * one (mirror `webview-page-control`).
 */

import type { MainCanvasPlugin } from "../../types";
import { DataSourceManager } from "./manager";
import { startReconciler } from "./reconciler";
import { createDatasourceTools } from "./tools";

export const DatasourcePlugin: MainCanvasPlugin = {
  id: "datasource",
  activate(ctx) {
    const manager = new DataSourceManager();
    ctx.registerCanvasTool((workspaceId) =>
      createDatasourceTools(workspaceId, manager, ctx.store),
    );
    startReconciler(manager, ctx.store);
  },
};
