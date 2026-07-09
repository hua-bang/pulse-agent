import { useCallback, useEffect, useState } from "react";
import { useAppShell } from "../AppShellProvider";

/** What the main-side `get-spec` IPC returns. */
interface GetSpecOk {
  ok: true;
  spec: { kind: "polling" | "stateful"; [k: string]: unknown };
  createdAt: number;
}
interface IpcError {
  ok: false;
  error: string;
}
type GetSpecResult = GetSpecOk | IpcError;
type ActionResult = { ok: true; url: string } | IpcError;

type Tab = "spec" | "payload" | "actions";

const PLUGIN_ID = "dynamic-app";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // PluginBridge exposed via preload — `window.canvasWorkspace.plugin.invoke`
  // resolves to ipcMain handlers registered by the plugin's main half.
  return (
    window as unknown as {
      canvasWorkspace: {
        plugin: { invoke: <R>(p: string, c: string, ...a: unknown[]) => Promise<R> };
      };
    }
  ).canvasWorkspace.plugin.invoke<T>(PLUGIN_ID, channel, ...args);
}

interface DynamicAppInspectorProps {
  workspaceId: string;
  dynamicAppId: string;
  apiUrl: string;
  /** Notify parent when an action (restart / reset) returns a fresh
   *  URL so the iframe can reload with the cache-buster. */
  onUrlChanged(url: string): void;
}

export function DynamicAppInspector({
  workspaceId,
  dynamicAppId,
  apiUrl,
  onUrlChanged,
}: DynamicAppInspectorProps) {
  const [tab, setTab] = useState<Tab>("spec");
  const [spec, setSpec] = useState<GetSpecOk | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);

  // Spec — fetched once on mount; immutable for the life of the runner
  // (an `dynamic_app_update` re-mounts the iframe by changing the
  // URL, which re-triggers the inspector's effect).
  useEffect(() => {
    let cancelled = false;
    setSpec(null);
    setSpecError(null);
    invoke<GetSpecResult>("get-spec", workspaceId, dynamicAppId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setSpec(res);
        else setSpecError(res.error);
      })
      .catch((err) => {
        if (!cancelled) setSpecError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, dynamicAppId]);

  return (
    <div className="dynamic-app-inspector">
      <div className="dynamic-app-inspector-tabs">
        <button
          className={`dynamic-app-inspector-tab ${tab === "spec" ? "active" : ""}`}
          onClick={() => setTab("spec")}
        >
          Spec
        </button>
        <button
          className={`dynamic-app-inspector-tab ${tab === "payload" ? "active" : ""}`}
          onClick={() => setTab("payload")}
        >
          Payload
        </button>
        <button
          className={`dynamic-app-inspector-tab ${tab === "actions" ? "active" : ""}`}
          onClick={() => setTab("actions")}
        >
          Actions
        </button>
      </div>
      <div className="dynamic-app-inspector-body">
        {tab === "spec" &&
          (specError ? (
            <div className="dynamic-app-inspector-toast error">{specError}</div>
          ) : !spec ? (
            <div className="dynamic-app-inspector-empty">loading…</div>
          ) : (
            <pre className="dynamic-app-inspector-pre">
              {JSON.stringify(spec.spec, null, 2)}
            </pre>
          ))}
        {tab === "payload" && <PayloadTab apiUrl={apiUrl} />}
        {tab === "actions" && (
          <ActionsTab
            workspaceId={workspaceId}
            dynamicAppId={dynamicAppId}
            kind={spec?.spec.kind}
            onUrlChanged={onUrlChanged}
          />
        )}
      </div>
    </div>
  );
}

// ─── Payload tab ──────────────────────────────────────────────────

function PayloadTab({ apiUrl }: { apiUrl: string }) {
  const [latest, setLatest] = useState<unknown>(undefined);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    setLatest(undefined);
    setStreamError(null);
    const es = new EventSource(`${apiUrl}/stream`);
    es.onmessage = (e) => {
      try {
        setLatest(JSON.parse(e.data));
      } catch (err) {
        setStreamError(`parse error: ${String(err)}`);
      }
    };
    es.addEventListener("error", (e) => {
      // Server-side errors come as named SSE 'error' events with a JSON
      // body. EventSource transport errors arrive on the same handler
      // but without a `data` field — branch on that.
      const msg = (e as MessageEvent).data;
      if (typeof msg === "string" && msg.length > 0) {
        try {
          const parsed = JSON.parse(msg);
          setStreamError(parsed.message ?? msg);
        } catch {
          setStreamError(msg);
        }
      } else {
        setStreamError("stream disconnected");
      }
    });
    return () => es.close();
  }, [apiUrl]);

  if (streamError) {
    return <div className="dynamic-app-inspector-toast error">{streamError}</div>;
  }
  if (latest === undefined) {
    return <div className="dynamic-app-inspector-empty">no payload yet</div>;
  }
  return (
    <pre className="dynamic-app-inspector-pre">
      {JSON.stringify(latest, null, 2)}
    </pre>
  );
}

// ─── Actions tab ──────────────────────────────────────────────────

function ActionsTab({
  workspaceId,
  dynamicAppId,
  kind,
  onUrlChanged,
}: {
  workspaceId: string;
  dynamicAppId: string;
  kind: "polling" | "stateful" | undefined;
  onUrlChanged(url: string): void;
}) {
  const { notify } = useAppShell();
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const run = useCallback(
    async (channel: "restart" | "reset-state", successMsg: string) => {
      setBusy(true);
      try {
        const res = await invoke<ActionResult>(channel, workspaceId, dynamicAppId);
        if (res.ok) {
          notify({ tone: "success", title: successMsg });
          onUrlChanged(res.url);
        } else {
          notify({ tone: "error", title: res.error });
        }
      } catch (err) {
        notify({ tone: "error", title: String(err) });
      } finally {
        setBusy(false);
        setConfirmingReset(false);
      }
    },
    [workspaceId, dynamicAppId, onUrlChanged, notify],
  );

  return (
    <div className="dynamic-app-inspector-section">
      <button
        className="dynamic-app-inspector-action"
        onClick={() => void run("restart", "runner restarted")}
        disabled={busy}
      >
        Restart runner
      </button>
      <p className="dynamic-app-inspector-action-hint">
        Stops and re-forks. State (if stateful) survives.
      </p>

      {kind === "stateful" &&
        (confirmingReset ? (
          <>
            <button
              className="dynamic-app-inspector-action danger"
              onClick={() => void run("reset-state", "state reset to initial")}
              disabled={busy}
            >
              Confirm — wipe state
            </button>
            <button
              className="dynamic-app-inspector-action"
              onClick={() => setConfirmingReset(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="dynamic-app-inspector-action danger"
              onClick={() => setConfirmingReset(true)}
              disabled={busy}
            >
              Reset state
            </button>
            <p className="dynamic-app-inspector-action-hint">
              Discards every mutation since the spec's `state.initial`.
              Cannot be undone.
            </p>
          </>
        ))}
    </div>
  );
}
