import { useCallback, useEffect, useRef } from 'react';
import type { McpAppContextSource, McpAppNodeContextTarget } from '../../../../../../shared/mcp-apps';
import { useMcpAppNodeContext } from './useMcpAppNodeContext';

export interface McpAppContextSink {
  publish(source: McpAppContextSource, context: unknown): void;
  clear(): void;
}

/** Nodes retain their validated main lease; global views publish turn snapshots. */
export function useMcpAppContext(
  target: McpAppNodeContextTarget | undefined,
  sink: McpAppContextSink | undefined,
  result: unknown,
  error?: string,
) {
  const current = useRef({ target, sink, error });
  current.current = { target, sink, error };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const publishNode = useMcpAppNodeContext(error ? undefined : target, result);
  useEffect(() => {
    if (!sink) return;
    if (!error) {
      try {
        sink.publish('tool-result', result ?? {});
      } catch (error) {
        console.warn('[mcp-app-context]', error);
      }
    } else sink.clear();
    return () => sink.clear();
  }, [sink, result, error]);
  const publish = useCallback(async (source: McpAppContextSource, context: unknown) => {
    const state = current.current;
    if (!mounted.current || state.error) return;
    if (state.target) await publishNode(source, context);
    state.sink?.publish(source, context);
  }, [publishNode]);
  return { enabled: Boolean(target || sink), publish };
}
