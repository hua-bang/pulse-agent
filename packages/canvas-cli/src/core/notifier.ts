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

    // Short timeout — we don't want CLI commands to hang if Electron is wedged.
    socket.setTimeout(200);

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
