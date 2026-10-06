import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  McpAppToolApprovalDecision,
  McpAppToolApprovalRequest,
} from '../../../../../../shared/mcp-apps';

export const useMcpAppApproval = (closed = false) => {
  const mountedRef = useRef(false);
  const closedRef = useRef(closed);
  closedRef.current = closed;
  const resolverRef = useRef<((decision: McpAppToolApprovalDecision) => void) | null>(null);
  const [request, setRequest] = useState<McpAppToolApprovalRequest>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      resolverRef.current?.('cancel');
      resolverRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!closed) return;
    resolverRef.current?.('cancel');
    resolverRef.current = null;
    setRequest(undefined);
  }, [closed]);

  const ask = useCallback((nextRequest: McpAppToolApprovalRequest) => (
    new Promise<McpAppToolApprovalDecision>((resolve) => {
      if (!mountedRef.current || closedRef.current || resolverRef.current) {
        resolve('cancel');
        return;
      }
      resolverRef.current = resolve;
      setRequest(nextRequest);
    })
  ), []);

  const answer = useCallback((decision: McpAppToolApprovalDecision) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(undefined);
    resolve?.(decision);
  }, []);

  return { request, ask, answer };
};
