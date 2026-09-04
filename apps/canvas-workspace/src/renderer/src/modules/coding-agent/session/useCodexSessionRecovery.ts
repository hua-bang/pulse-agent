import { useEffect } from 'react';
import type { AgentNodeData, CodexSessionsApi } from '../../../types';

interface UseCodexSessionRecoveryOptions {
  data: AgentNodeData;
  disabled: boolean;
  rootFolder?: string;
  api?: Pick<CodexSessionsApi, 'findByMarker'>;
  onRecovered: (sessionId: string) => void;
}

export const useCodexSessionRecovery = ({
  data,
  disabled,
  rootFolder,
  api,
  onRecovered,
}: UseCodexSessionRecoveryOptions): void => {
  useEffect(() => {
    if (disabled || data.agentType !== 'codex' || data.codexSessionId || !data.codexSessionMarker || !api) {
      return undefined;
    }
    let cancelled = false;
    void api.findByMarker({
      marker: data.codexSessionMarker,
      cwd: data.cwd || rootFolder || undefined,
    }).then((result) => {
      if (!cancelled && result.ok && result.session?.id) onRecovered(result.session.id);
    });
    return () => { cancelled = true; };
  }, [
    api,
    data.agentType,
    data.codexSessionId,
    data.codexSessionMarker,
    data.cwd,
    disabled,
    onRecovered,
    rootFolder,
  ]);
};
