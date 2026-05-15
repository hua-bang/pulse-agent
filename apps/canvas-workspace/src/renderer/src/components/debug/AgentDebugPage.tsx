import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentDebugRunDetail, AgentDebugRunSummary, AgentDebugTrace } from '../../types';
import './AgentDebugPage.css';

interface AgentDebugPageProps {
  selectedSessionId?: string | null;
  selectedRunId?: string | null;
  onSelectRun: (sessionId: string, runId: string) => void;
  onBackToCanvas: () => void;
}

const shortId = (value: string, length = 8) => value.length <= length ? value : value.slice(0, length);
const formatDuration = (durationMs?: number) => durationMs == null ? '—' : durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
const formatDateTime = (timestamp?: number) => timestamp ? new Date(timestamp).toLocaleString() : '—';

export const AgentDebugPage = ({
  selectedSessionId,
  selectedRunId,
  onSelectRun,
  onBackToCanvas,
}: AgentDebugPageProps) => {
  const [runs, setRuns] = useState<AgentDebugRunSummary[]>([]);
  const [detail, setDetail] = useState<AgentDebugRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);
    try {
      const result = await window.canvasWorkspace.agent.listDebugRuns();
      if (!result.ok) throw new Error(result.error ?? 'Failed to load debug runs');
      setRuns(result.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const firstRun = runs[0];
    if (!selectedSessionId && !selectedRunId && firstRun) {
      onSelectRun(firstRun.sessionId, firstRun.runId);
    }
  }, [onSelectRun, runs, selectedRunId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !selectedRunId) {
      setDetail(null);
      return;
    }

    let canceled = false;
    setLoadingDetail(true);
    setError(null);
    void window.canvasWorkspace.agent.getDebugRun(selectedSessionId, selectedRunId)
      .then(result => {
        if (canceled) return;
        if (!result.ok || !result.run) throw new Error(result.error ?? 'Debug run not found');
        setDetail(result.run);
      })
      .catch(err => {
        if (!canceled) {
          setDetail(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!canceled) setLoadingDetail(false);
      });

    return () => {
      canceled = true;
    };
  }, [selectedRunId, selectedSessionId]);

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter(run => [
      run.workspaceName,
      run.workspaceId,
      run.sessionId,
      run.runId,
      run.userPromptPreview,
      run.assistantPreview,
      run.modelLabel,
    ].some(value => value?.toLowerCase().includes(needle)));
  }, [query, runs]);

  const runGroups = useMemo(() => {
    const groups = new Map<string, AgentDebugRunSummary[]>();
    for (const run of filteredRuns) {
      const key = `${run.workspaceName} · ${shortId(run.sessionId, 10)}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    return Array.from(groups.entries());
  }, [filteredRuns]);

  return (
    <div className="agent-debug-page">
      <aside className="agent-debug-rail">
        <div className="agent-debug-brand">
          <div>
            <div className="agent-debug-kicker">Canvas Agent</div>
            <h1>DevTools</h1>
          </div>
          <button type="button" onClick={onBackToCanvas}>← Back</button>
        </div>

        <div className="agent-debug-search">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search session, run, prompt..."
          />
          <button type="button" onClick={() => void loadRuns()}>Refresh</button>
        </div>

        {loadingRuns ? (
          <div className="agent-debug-empty">Loading debug runs...</div>
        ) : runGroups.length === 0 ? (
          <div className="agent-debug-empty">No dev traces yet. Start Canvas in dev mode and run a chat turn.</div>
        ) : (
          <div className="agent-debug-run-groups">
            {runGroups.map(([groupName, groupRuns]) => (
              <section key={groupName} className="agent-debug-run-group">
                <div className="agent-debug-group-title">{groupName}</div>
                {groupRuns.map(run => {
                  const active = run.sessionId === selectedSessionId && run.runId === selectedRunId;
                  return (
                    <button
                      key={`${run.sessionId}:${run.runId}`}
                      type="button"
                      className={`agent-debug-run-item${active ? ' agent-debug-run-item--active' : ''}`}
                      onClick={() => onSelectRun(run.sessionId, run.runId)}
                    >
                      <span className="agent-debug-run-time">{formatDateTime(run.startedAt)}</span>
                      <strong>{run.userPromptPreview || '(empty prompt)'}</strong>
                      <span>{run.toolCount} tools · {run.readNodeCount} reads · {formatDuration(run.durationMs)}</span>
                      <code>run {shortId(run.runId)}</code>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </aside>

      <main className="agent-debug-main">
        {error && <div className="agent-debug-error">{error}</div>}
        {loadingDetail ? (
          <div className="agent-debug-empty agent-debug-empty--main">Loading run detail...</div>
        ) : detail ? (
          <RunDetail detail={detail} onBackToCanvas={onBackToCanvas} />
        ) : (
          <div className="agent-debug-empty agent-debug-empty--main">Select a run to inspect session/run level traces.</div>
        )}
      </main>
    </div>
  );
};

const RunDetail = ({ detail, onBackToCanvas }: { detail: AgentDebugRunDetail; onBackToCanvas: () => void }) => {
  const trace = detail.trace;
  return (
    <div className="agent-debug-detail">
      <header className="agent-debug-hero">
        <div>
          <button type="button" className="agent-debug-back-button" onClick={onBackToCanvas}>← Back to Canvas</button>
          <div className="agent-debug-kicker">{detail.workspaceName}</div>
          <h2>{detail.userPromptPreview || 'Untitled run'}</h2>
          <p>{detail.assistantPreview}</p>
        </div>
        <div className="agent-debug-hero-metrics">
          <Metric label="Duration" value={formatDuration(trace.durationMs)} />
          <Metric label="Tools" value={String(trace.toolCalls.length)} />
          <Metric label="Read Nodes" value={String(trace.readNodes.length)} />
        </div>
      </header>

      <section className="agent-debug-card agent-debug-card--ids">
        <Metric label="Session ID" value={trace.sessionId} copy />
        <Metric label="Run ID" value={trace.runId} copy />
        <Metric label="Turn ID" value={trace.turnId} copy />
        <Metric label="Started" value={formatDateTime(trace.startedAt)} />
        <Metric label="Model" value={[trace.model?.provider, trace.model?.model].filter(Boolean).join(' / ') || '—'} />
        <Metric label="Scope" value={trace.request.scope ?? 'current_canvas'} />
      </section>

      <section className="agent-debug-grid-layout">
        <ContextCard trace={trace} />
        <PromptCard trace={trace} />
      </section>

      <section className="agent-debug-card">
        <div className="agent-debug-card-title">Tool Timeline</div>
        {trace.toolCalls.length === 0 ? (
          <div className="agent-debug-muted">No tools recorded.</div>
        ) : (
          <div className="agent-debug-timeline">
            {trace.toolCalls.map((tool, index) => (
              <details key={`${tool.toolCallId ?? tool.name}-${index}`} className="agent-debug-tool-row">
                <summary>
                  <span className={`agent-debug-status agent-debug-status--${tool.status}`} />
                  <strong>{tool.name}</strong>
                  <span>{formatDuration(tool.durationMs)}</span>
                  {tool.readNodes?.length ? <span>{tool.readNodes.length} nodes</span> : null}
                </summary>
                {tool.argsPreview && <CodeBlock title="Args" value={tool.argsPreview} />}
                {tool.resultSummary && <CodeBlock title="Result" value={tool.resultSummary} />}
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="agent-debug-card">
        <div className="agent-debug-card-title">Read Nodes</div>
        {trace.readNodes.length === 0 ? (
          <div className="agent-debug-muted">No node reads recorded.</div>
        ) : (
          <div className="agent-debug-node-grid">
            {trace.readNodes.map((node, index) => (
              <div key={`${node.workspaceId ?? ''}-${node.id}-${node.source ?? ''}-${index}`} className="agent-debug-node-card">
                <strong>{node.title}</strong>
                <span>{node.type} · {node.source}</span>
                <code>{node.id}</code>
                {node.contentChars != null && <span>{node.contentChars.toLocaleString()} chars</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const ContextCard = ({ trace }: { trace: AgentDebugTrace }) => (
  <section className="agent-debug-card">
    <div className="agent-debug-card-title">Request Context</div>
    <div className="agent-debug-tags">
      <span>mode: {trace.request.executionMode ?? 'auto'}</span>
      <span>scope: {trace.request.scope ?? 'current_canvas'}</span>
      <span>attachments: {trace.request.attachmentCount}</span>
      {trace.request.workspace && <span>{trace.request.workspace.nodeCount} canvas nodes</span>}
    </div>
    <CodeBlock title="User prompt" value={trace.request.userPromptPreview} />
    {trace.request.selectedNodes.length > 0 && (
      <div className="agent-debug-mini-list">
        <div className="agent-debug-card-title agent-debug-card-title--small">Selected Nodes</div>
        {trace.request.selectedNodes.map(node => <span key={node.id}>{node.title} · {node.type}</span>)}
      </div>
    )}
  </section>
);

const PromptCard = ({ trace }: { trace: AgentDebugTrace }) => {
  const [expanded, setExpanded] = useState(false);
  const snapshot = trace.messageSnapshot;
  return (
    <section className="agent-debug-card">
      <div className="agent-debug-card-title-row">
        <div className="agent-debug-card-title">Prompt Snapshot</div>
        <button type="button" onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="agent-debug-tags">
        <span>system {trace.prompt.systemPromptChars.toLocaleString()} chars</span>
        {trace.prompt.currentCanvasSummaryChars != null && (
          <span>canvas summary {trace.prompt.currentCanvasSummaryChars.toLocaleString()} chars</span>
        )}
        {snapshot && <span>{snapshot.messageCount} messages</span>}
        {(trace.truncated || snapshot?.truncated) && <span>snapshot truncated</span>}
      </div>
      {expanded && snapshot ? (
        <>
          <CodeBlock title={`System prompt snapshot · ${snapshot.systemPromptChars.toLocaleString()} chars`} value={snapshot.systemPrompt} />
          <CodeBlock title={`Messages snapshot · ${snapshot.messagesChars.toLocaleString()} chars`} value={snapshot.messagesJson} />
        </>
      ) : (
        <CodeBlock title="System prompt preview" value={trace.prompt.systemPromptPreview} />
      )}
    </section>
  );
};

const Metric = ({ label, value, copy }: { label: string; value: string; copy?: boolean }) => (
  <div className="agent-debug-metric">
    <span>{label}</span>
    <code>{value}</code>
    {copy && (
      <button type="button" onClick={() => void navigator.clipboard?.writeText(value)}>copy</button>
    )}
  </div>
);

const CodeBlock = ({ title, value }: { title: string; value?: string }) => (
  <div className="agent-debug-code-block">
    <div>{title}</div>
    <pre>{value || '—'}</pre>
  </div>
);
