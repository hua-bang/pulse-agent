import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentChatMcpApp, AgentScope } from '../../../types';

type EntrypointState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; result: unknown };

export interface McpAppEntrypointTarget {
  serverName: string;
  toolName: string;
  resourceUri: string;
}

export interface McpAppEntrypointHandle {
  /** Set once the `{}` entrypoint call returns a result. */
  app?: AgentChatMcpApp;
  error?: string;
  retry: () => void;
}

/**
 * Opens a static MCP App entrypoint. The host calls the entrypoint tool with
 * `{}`, as OpenAI global/thread entrypoints require, and the app renders from
 * that first result instead of calling the tool again.
 */
export function useMcpAppEntrypoint(
  scope: AgentScope,
  target: McpAppEntrypointTarget | undefined,
): McpAppEntrypointHandle {
  const serverName = target?.serverName;
  const toolName = target?.toolName;
  const resourceUri = target?.resourceUri;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EntrypointState>({ status: 'loading' });

  useEffect(() => {
    if (!serverName || !toolName) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void window.canvasWorkspace.agent.mcpApps
      .openEntrypoint(scope, serverName, toolName)
      .then((result) => {
        if (cancelled) return;
        setState(result.ok
          ? { status: 'ready', result: result.value }
          : { status: 'error', error: result.error ?? 'Failed to open MCP App' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: String(error) });
      });
    return () => { cancelled = true; };
  }, [attempt, scope, serverName, toolName]);

  const app = useMemo<AgentChatMcpApp | undefined>(() => (
    serverName && toolName && resourceUri && state.status === 'ready'
      ? { serverName, toolName, resourceUri, result: state.result }
      : undefined
  ), [resourceUri, serverName, state, toolName]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  return {
    app,
    error: state.status === 'error' ? state.error : undefined,
    retry,
  };
}
