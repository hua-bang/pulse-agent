import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  McpAppToolApprovalDecision,
  McpAppToolApprovalRequest,
} from '../../../../shared/mcp-apps';

export const useMcpAppApproval = () => {
  const resolverRef = useRef<((decision: McpAppToolApprovalDecision) => void) | null>(null);
  const [request, setRequest] = useState<McpAppToolApprovalRequest>();

  useEffect(() => () => {
    resolverRef.current?.('cancel');
    resolverRef.current = null;
  }, []);

  const ask = useCallback((nextRequest: McpAppToolApprovalRequest) => (
    new Promise<McpAppToolApprovalDecision>((resolve) => {
      if (resolverRef.current) {
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
