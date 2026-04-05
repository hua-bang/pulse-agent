/**
 * Fire-and-forget notifier that tells a running canvas-workspace Electron
 * instance about canvas mutations made via canvas-cli.
 *
 * The Electron main process listens on a local socket (Unix domain socket
 * on POSIX, named pipe on Windows). If no instance is running, the notify
 * call silently no-ops — CLI mutations still hit disk, and any running
 * Electron instance that opens the workspace later will load from disk.
 *
 * Protocol: single line of JSON, then close:
 *   {"type":"canvas:updated","workspaceId":"...","nodeIds":["..."],"source":"cli"}
 */
import net from 'net';
import { join } from 'path';
import { homedir, platform } from 'os';

export interface CanvasUpdateEvent {
  type: 'canvas:updated';
  workspaceId: string;
  /** IDs of nodes that were created/modified. Empty means "reload all". */
  nodeIds: string[];
  /** Mutation kind for optional UI affordances (highlight style, etc). */
  kind?: 'create' | 'update' | 'delete';
  source: 'cli';
}

export function getIpcSocketPath(): string {
  if (platform() === 'win32') {
    return '\\\\.\\pipe\\pulse-coder-canvas-ipc';
  }
  return join(homedir(), '.pulse-coder', 'canvas-ipc.sock');
}

/**
 * Send an update event to the Electron main process. Never throws; any
 * connection error is swallowed (Electron may simply not be running).
 * Resolves once the line has been written, or immediately on error.
 */
export function notifyCanvasUpdated(event: Omit<CanvasUpdateEvent, 'type' | 'source'>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    let socket: net.Socket;
    try {
      socket = net.createConnection(getIpcSocketPath());
    } catch {
      done();
      return;
    }

    // Generous timeout: when the Electron main process is busy serving
    // canvas:save traffic from the renderer (e.g. the scrollback autosave
    // interval firing while an agent produces output), the server's
    // `accept()` may be delayed well beyond the ~1ms a local Unix socket
    // usually takes. A tight timeout here silently loses notifications
    // exactly in the scenario they matter most. 2s is still short enough
    // to not noticeably stall CLI commands if Electron isn't running.
    socket.setTimeout(2000);

    socket.once('connect', () => {
      const payload: CanvasUpdateEvent = {
        type: 'canvas:updated',
        source: 'cli',
        workspaceId: event.workspaceId,
        nodeIds: event.nodeIds,
        kind: event.kind,
      };
      socket.end(JSON.stringify(payload) + '\n');
    });

    socket.once('error', () => done());
    socket.once('timeout', () => {
      socket.destroy();
      done();
    });
    socket.once('close', () => done());
  });
}
