import { useCallback, useEffect, useRef } from 'react';
import type { McpAppContextSource, McpAppNodeContextTarget } from '../../../../../../shared/mcp-apps';
import { flushWorkspacePersistence } from '../../../../shared/workspacePersistence';

interface ContextSession {
  token: Promise<string>;
  pending: Promise<unknown>;
}

/** Keep publications ordered and close only the lease belonging to this mount. */
export function useMcpAppNodeContext(target: McpAppNodeContextTarget | undefined, result: unknown) {
  const sessionRef = useRef<ContextSession>();
  useEffect(() => {
    if (!target) return;
    let disposed = false;
    const api = window.canvasWorkspace.agent.mcpApps;
    const token = api.openNodeContext(target).then(async (response) => {
      if (!response.ok && response.code === 'node-not-persisted' && !disposed) {
        // Newly created nodes can mount before the document's debounced save.
        // Await the owning writer, then retry once without relaxing main validation.
        await flushWorkspacePersistence(target.workspaceId);
        if (disposed) throw new Error('MCP App context mount is closed');
        response = await api.openNodeContext(target);
      }
      if (!response.ok || !response.token) throw new Error(response.error ?? 'Could not open MCP App context');
      return response.token;
    });
    const pending = token.then(value => api.updateNodeContext(value, 'tool-result', result ?? {}));
    const session = { token, pending };
    sessionRef.current = session;
    void pending.catch(error => console.warn('[mcp-app-context]', error));
    return () => {
      disposed = true;
      if (sessionRef.current === session) sessionRef.current = undefined;
      void session.pending.catch(() => undefined).then(() => token)
        .then(value => api.closeNodeContext(value)).catch(() => undefined);
    };
  }, [target?.workspaceId, target?.nodeId, target?.serverName, target?.toolName, target?.resourceUri, result]);

  return useCallback(async (source: McpAppContextSource, context: unknown) => {
    const session = sessionRef.current;
    if (!session) return;
    const api = window.canvasWorkspace.agent.mcpApps;
    const next = session.pending.catch(() => undefined).then(async () => {
      const response = await api.updateNodeContext(await session.token, source, context);
      if (!response.ok) throw new Error(response.error ?? 'Could not update MCP App context');
    });
    session.pending = next;
    await next;
  }, []);
}
