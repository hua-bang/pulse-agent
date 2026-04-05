/**
 * Local IPC socket server that accepts canvas-update events from the
 * canvas-cli notifier and rebroadcasts them to all renderer windows.
 *
 * Listens on a Unix domain socket (POSIX) or named pipe (Windows) at the
 * well-known path returned by canvas-cli's `getIpcSocketPath`. Each client
 * connection sends one line of JSON then disconnects:
 *
 *   {"type":"canvas:updated","workspaceId":"...","nodeIds":["..."],"source":"cli"}
 *
 * On receipt, the event is forwarded to every BrowserWindow via
 * webContents.send('canvas:external-update', payload).
 */
import net from 'net';
import { promises as fs, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';

/**
 * Must stay in sync with `getIpcSocketPath` in
 * packages/canvas-cli/src/core/notifier.ts. Keeping a local copy avoids
 * introducing a workspace dep from the Electron main bundle into the CLI
 * package, which would require bundling its source into the Electron build.
 */
const getIpcSocketPath = (): string => {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\pulse-coder-canvas-ipc';
  }
  return join(homedir(), '.pulse-coder', 'canvas-ipc.sock');
};

interface CanvasUpdateEvent {
  type: 'canvas:updated';
  workspaceId: string;
  nodeIds: string[];
  kind?: 'create' | 'update' | 'delete';
  source: 'cli';
}

let server: net.Server | null = null;

const broadcast = (event: CanvasUpdateEvent) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:external-update', event);
  }
};

const handleConnection = (socket: net.Socket) => {
  let buffer = '';
  let gotLine = false;
  socket.setEncoding('utf-8');
  socket.setTimeout(5000);

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line) as CanvasUpdateEvent;
        if (event && event.type === 'canvas:updated' && event.workspaceId) {
          broadcast(event);
        }
        gotLine = true;
      } catch {
        // malformed line — ignore, keep reading
      }
    }
    // The client sends one event and closes — once we've processed a
    // line, actively close our half so the client's `'close'` event
    // fires promptly (and its inactivity timer doesn't falsely trip).
    if (gotLine) {
      socket.end();
    }
  });

  socket.once('timeout', () => socket.destroy());
  socket.once('error', () => socket.destroy());
};

export const startCanvasIpcServer = async (): Promise<void> => {
  const socketPath = getIpcSocketPath();

  // On POSIX, stale socket files from a previous crash block binding.
  if (process.platform !== 'win32') {
    await fs.mkdir(dirname(socketPath), { recursive: true }).catch(() => undefined);
    if (existsSync(socketPath)) {
      // Try connecting — if nothing answers, remove the stale file.
      await new Promise<void>((resolve) => {
        const probe = net.createConnection(socketPath);
        probe.once('connect', () => {
          probe.end();
          resolve();
        });
        probe.once('error', async () => {
          await fs.unlink(socketPath).catch(() => undefined);
          resolve();
        });
      });
    }
  }

  return new Promise((resolve, reject) => {
    const srv = net.createServer(handleConnection);
    srv.once('error', (err) => {
      console.warn('[canvas-ipc] failed to start server:', err);
      reject(err);
    });
    srv.listen(socketPath, () => {
      server = srv;
      resolve();
    });
  });
};

export const stopCanvasIpcServer = (): void => {
  if (!server) return;
  try {
    server.close();
  } catch {
    // ignore
  }
  server = null;
  if (process.platform !== 'win32') {
    try {
      const socketPath = getIpcSocketPath();
      if (existsSync(socketPath)) {
        void fs.unlink(socketPath).catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }
};
