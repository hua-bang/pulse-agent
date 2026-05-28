import { BrowserWindow } from 'electron';

/**
 * Push a partial visual content snapshot to every renderer window so the
 * chat-side inline visual can morph progressively — used by `visual_render`
 * to drive the streaming preview when the upstream LLM/provider does NOT
 * emit `tool-input-delta` events itself (which is the common case for
 * OpenAI-compatible endpoints fronting non-streaming providers).
 *
 * Renderer correlates the chunk to a tool-call frame by `toolCallId`.
 */
export function broadcastVisualStream(payload: {
  workspaceId: string;
  toolCallId: string;
  content: string;
  done?: boolean;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas-agent:visual-stream', payload);
  }
}

export function broadcastUpdate(workspaceId: string, nodeIds: string[]): void {
  const payload = {
    type: 'canvas:updated' as const,
    workspaceId,
    nodeIds,
    source: 'canvas-agent' as const,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:external-update', payload);
  }
}
