/**
 * Renderer-side body for `type: 'dynamic-app'` canvas nodes.
 *
 * The body is much simpler than `IframeNodeBody` — no URL editor, no
 * mode tabs, no draft state. The runner's URL is set by the dynamic-app
 * tools (and patched by the reconciler on respawn); we just load it.
 *
 * The toolbar adds three things on top of the bare iframe:
 *   - a `polling` / `stateful` kind badge fetched from the persisted
 *     spec via the plugin IPC bridge
 *   - a refresh button that bumps a key on the iframe to force-reload
 *   - a settings toggle that opens an inline inspector drawer (Spec /
 *     Payload / Actions tabs)
 *
 * No interaction with main-process file paths; everything goes through
 * `window.canvasWorkspace.plugin.invoke('dynamic-app', ...)`.
 */

import { useCallback, useEffect, useState } from "react";
import "./index.css";
import { DynamicAppInspector } from "./Inspector";
import type { CanvasNode, DynamicAppNodeData } from "../../types";

interface DynamicAppNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isResizing?: boolean;
  readOnly?: boolean;
}

interface GetSpecOk {
  ok: true;
  spec: { kind: "polling" | "stateful" };
}
interface IpcError {
  ok: false;
  error: string;
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (
    window as unknown as {
      canvasWorkspace: {
        plugin: { invoke: <R>(p: string, c: string, ...a: unknown[]) => Promise<R> };
      };
    }
  ).canvasWorkspace.plugin.invoke<T>("dynamic-app", channel, ...args);
}

/** Strip query and fragment to recover the canonical API base.
 *  data.url has a `?v=<ts>` cache-buster appended by tools.ts /
 *  reconciler; the inspector wants the bare `/api/<id>` to fetch from. */
function apiBaseFromUiUrl(uiUrl: string): string {
  const noQuery = uiUrl.split(/[?#]/)[0];
  // /ui/<id> → /api/<id>
  return noQuery.replace(/\/ui\//, "/api/");
}

export const DynamicAppNodeBody = ({
  node,
  workspaceId,
  readOnly: _readOnly,
  isResizing: _isResizing,
}: DynamicAppNodeBodyProps) => {
  // The dispatcher only routes `type === 'dynamic-app'` here, so
  // node.data narrows to DynamicAppNodeData. Be defensive about the
  // shape in case canvas.json was hand-edited.
  const data = node.data as Partial<DynamicAppNodeData> | undefined;
  const url = data?.url ?? "";
  const dynamicAppId = data?.dynamicAppId ?? "";

  const [iframeKey, setIframeKey] = useState(0);
  // Allow inspector actions (restart / reset) to swap in a fresh URL
  // so the iframe loads the cache-busted version. Falls back to the
  // node's persisted URL when nothing has run.
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [kind, setKind] = useState<"polling" | "stateful" | null>(null);

  // Fetch kind once per dynamicAppId so the toolbar can show the badge.
  // Don't block render — kind appears once the IPC returns.
  useEffect(() => {
    if (!workspaceId || !dynamicAppId) return;
    let cancelled = false;
    invoke<GetSpecOk | IpcError>("get-spec", workspaceId, dynamicAppId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setKind(res.spec.kind);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, dynamicAppId]);

  const effectiveUrl = overrideUrl ?? url;
  const apiUrl = effectiveUrl ? apiBaseFromUiUrl(effectiveUrl) : "";

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const handleUrlChanged = useCallback((next: string) => {
    // Append our own cache-buster so the iframe actually reloads even
    // when restart returned the same canonical URL.
    const bust = `${next}${next.includes("?") ? "&" : "?"}v=${Date.now()}`;
    setOverrideUrl(bust);
    setIframeKey((k) => k + 1);
  }, []);

  if (!effectiveUrl || !workspaceId || !dynamicAppId) {
    return (
      <div className="dynamic-app-body">
        <div className="dynamic-app-empty">
          Dynamic app not initialized (no URL or id on this node).
        </div>
      </div>
    );
  }

  return (
    <div className="dynamic-app-body">
      <div className="dynamic-app-toolbar">
        {kind && (
          <span className={`dynamic-app-kind ${kind}`}>{kind}</span>
        )}
        <span className="dynamic-app-toolbar-spacer" />
        <button
          type="button"
          className="dynamic-app-tool-btn"
          title="Refresh — reload the iframe (does not restart the runner)"
          onClick={handleRefresh}
        >
          ↻
        </button>
        <button
          type="button"
          className={`dynamic-app-tool-btn ${inspectorOpen ? "active" : ""}`}
          title="Inspect: spec, payload, runner actions"
          onClick={() => setInspectorOpen((v) => !v)}
        >
          ⚙
        </button>
      </div>
      <div className="dynamic-app-content">
        <iframe
          key={iframeKey}
          className="dynamic-app-iframe"
          src={effectiveUrl}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
        {inspectorOpen && (
          <DynamicAppInspector
            workspaceId={workspaceId}
            dynamicAppId={dynamicAppId}
            apiUrl={apiUrl}
            onUrlChanged={handleUrlChanged}
          />
        )}
      </div>
    </div>
  );
};
