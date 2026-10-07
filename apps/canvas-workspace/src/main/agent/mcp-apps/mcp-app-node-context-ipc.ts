import { ipcMain } from 'electron';

// Register synchronously; load node validation and lease handlers on first use.
// canvas-agent:mcp-app-context-open/update/close: document-lifetime node snapshots.
export function setupMcpAppNodeContextIpc(): void {
  let handlers: Promise<ReturnType<typeof import('./mcp-app-node-context-handlers').createMcpAppNodeContextHandlers>> | undefined;
  const load = () => handlers ??= import('./mcp-app-node-context-handlers')
    .then(module => module.createMcpAppNodeContextHandlers());
  ipcMain.handle('canvas-agent:mcp-app-context-open', async (event, target) => (
    (await load()).open(event, target)
  ));
  ipcMain.handle('canvas-agent:mcp-app-context-update', async (event, payload) => (
    (await load()).update(event, payload)
  ));
  ipcMain.handle('canvas-agent:mcp-app-context-close', async (event, payload) => (
    (await load()).close(event, payload)
  ));
}
