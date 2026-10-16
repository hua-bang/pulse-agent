import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AgentDebugPage } from './AgentDebugPage';
import type { AgentDebugRunDetail } from '../../../renderer/src/types';
import type { RendererCtx } from '../../types';
import '../../../renderer/src/styles.css';
import './log-viewer.css';

const payload = JSON.parse(document.getElementById('trace-data')!.textContent!) as {
  runs: AgentDebugRunDetail[];
  selectedRunId?: string;
  sessionId?: string;
  workspaceId: string;
};
const invoke: RendererCtx['invoke'] = async <T,>(channel: string, ...args: unknown[]): Promise<T> => {
  if (channel === 'list-runs') return payload.runs as T;
  if (channel === 'get-run') {
    const run = payload.runs.find(run => run.runId === args[0]);
    if (run) return run as T;
    throw new Error('Run is not in this snapshot.');
  }
  throw new Error(`Unsupported snapshot operation: ${channel}`);
};

function LogViewer() {
  const [selected, setSelected] = useState(payload.selectedRunId ?? null);
  return <AgentDebugPage
    invoke={invoke}
    selectedRunId={selected}
    sessionId={payload.sessionId}
    workspaceId={payload.workspaceId}
    snapshot
    onSelectRun={setSelected}
    onBackToCanvas={() => window.close()}
  />;
}

createRoot(document.getElementById('root')!).render(<LogViewer />);
