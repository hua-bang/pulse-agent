import type { IpcRenderer } from "electron";
import type { SendLog } from "./logging";

const truthy = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && ["1", "true", "on", "yes"].includes(normalized);
};

export const readPluginFlags = (
  ipcRenderer: IpcRenderer,
  sendLog: SendLog
): Record<string, boolean> => {
  let baseFlags: Record<string, boolean> = {};

  try {
    const result = ipcRenderer.sendSync("experimental:read-sync");
    if (result && typeof result === "object") {
      baseFlags = result as Record<string, boolean>;
    }
  } catch (err) {
    sendLog("preload", "experimental:read-sync failed", String(err));
  }

  return truthy(process.env.CANVAS_AGENT_DEBUG_TRACE)
    ? { ...baseFlags, "canvas-agent-debug-trace": true }
    : baseFlags;
};
