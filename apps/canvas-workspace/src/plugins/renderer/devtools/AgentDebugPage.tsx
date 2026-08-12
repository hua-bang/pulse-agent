import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentDebugRunDetail,
  AgentDebugRunSummary,
  AgentDebugTrace,
} from '../../../renderer/src/types';
import type { RendererCtx } from '../../types';
import {
  buildTraceTimeline,
  runtimeDisplayName,
  runtimeOwner,
  type PerformanceOwner,
  type TraceTimelineItem,
} from './performance-model';
import './AgentDebugPage.css';

interface AgentDebugPageProps {
  invoke: RendererCtx['invoke'];
  selectedRunId?: string | null;
  onSelectRun: (runId: string) => void;
  onBackToCanvas: () => void;
}

const shortId = (value: string, length = 8) => value.length <= length ? value : value.slice(0, length);
const formatDuration = (value?: number) => value == null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
const formatTime = (value?: number) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const ownerLabel = (owner: string) => owner === 'canvas-host' ? 'Canvas Host' : owner === 'renderer' ? 'Renderer' : owner === 'pi' ? 'Pi' : owner === 'engine' ? 'Engine' : 'Runtime';
const milestoneLabel = (label: string) => ({
  'ui.request-dispatched': 'UI request dispatched',
  'runtime.first-activity': 'TTFA · first activity',
  'runtime.first-text': 'TTFT · first text',
  'ui.first-content-rendered': 'UI first content rendered',
}[label] ?? label);

export const AgentDebugPage = ({ invoke, selectedRunId, onSelectRun, onBackToCanvas }: AgentDebugPageProps) => {
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
      setRuns(await invoke<AgentDebugRunSummary[]>('list-runs'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRuns(false);
    }
  }, [invoke]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => {
    if (!selectedRunId && runs[0]) onSelectRun(runs[0].runId);
  }, [onSelectRun, runs, selectedRunId]);
  useEffect(() => {
    if (!selectedRunId) { setDetail(null); return; }
    let canceled = false;
    setLoadingDetail(true);
    setError(null);
    invoke<AgentDebugRunDetail>('get-run', selectedRunId)
      .then(run => { if (!canceled) setDetail(run); })
      .catch(err => {
        if (!canceled) {
          setDetail(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => { if (!canceled) setLoadingDetail(false); });
    return () => { canceled = true; };
  }, [invoke, selectedRunId]);

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter(run => [run.workspaceName, run.sessionId, run.runId, run.userPromptPreview, run.modelLabel]
      .some(value => value?.toLowerCase().includes(needle)));
  }, [query, runs]);

  return (
    <div className="agent-debug-page">
      <aside className="agent-debug-rail">
        <div className="agent-debug-brand">
          <div><span className="agent-debug-logo">⌁</span><strong>Agent DevTools</strong></div>
          <button type="button" onClick={onBackToCanvas} title="Back to Canvas">×</button>
        </div>
        <div className="agent-debug-search">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter runs…" />
          <button type="button" onClick={() => void loadRuns()} title="Refresh">↻</button>
        </div>
        <div className="agent-debug-rail-heading"><span>Recent runs</span><code>{filteredRuns.length}</code></div>
        {loadingRuns ? <Empty>Loading traces…</Empty> : filteredRuns.length === 0 ? (
          <Empty>No traces yet. Run a Canvas chat turn.</Empty>
        ) : (
          <div className="agent-debug-run-list">
            {filteredRuns.map(run => (
              <button
                key={`${run.sessionId}:${run.runId}`}
                type="button"
                className={`agent-debug-run-item${run.runId === selectedRunId ? ' is-active' : ''}`}
                onClick={() => onSelectRun(run.runId)}
              >
                <span className={`agent-debug-runtime-dot is-${runtimeOwner(run.runtimeId)}`} />
                <span className="agent-debug-run-copy">
                  <strong>{run.userPromptPreview || '(empty prompt)'}</strong>
                  <small>{run.workspaceName} · {formatTime(run.startedAt)}</small>
                </span>
                <span className="agent-debug-run-duration">{formatDuration(run.durationMs)}</span>
              </button>
            ))}
          </div>
        )}
        <footer className="agent-debug-rail-footer">Local trace sink · timing metadata only</footer>
      </aside>

      <main className="agent-debug-main">
        {error && <div className="agent-debug-error">{error}</div>}
        {loadingDetail ? <Empty main>Loading run…</Empty> : detail ? (
          <RunDetail detail={detail} />
        ) : <Empty main>Select a run to inspect its critical path.</Empty>}
      </main>
    </div>
  );
};

const Empty = ({ children, main = false }: { children: React.ReactNode; main?: boolean }) => (
  <div className={`agent-debug-empty${main ? ' is-main' : ''}`}>{children}</div>
);

const RunDetail = ({ detail }: { detail: AgentDebugRunDetail }) => {
  const trace = detail.trace;
  const timeline = buildTraceTimeline(trace);
  const runtime = runtimeDisplayName(trace.runtime?.id);
  const status = trace.finishedAt ? 'Complete' : 'Running';
  return (
    <div className="agent-debug-detail">
      <header className="agent-debug-run-header">
        <div className="agent-debug-breadcrumb">Runs / {detail.workspaceName} / <code>{shortId(trace.runId)}</code></div>
        <div className="agent-debug-title-row">
          <div>
            <h1>{detail.userPromptPreview || 'Untitled run'}</h1>
            <div className="agent-debug-meta">
              <span className="agent-debug-status-dot" /> {status}
              <span>{runtime}</span><span>{trace.model?.model ?? 'Auto model'}</span>
              <span>{formatTime(trace.startedAt)}</span>
            </div>
          </div>
          <button type="button" className="agent-debug-copy" onClick={() => void navigator.clipboard?.writeText(trace.runId)}>Copy run ID</button>
        </div>
      </header>

      <section className="agent-debug-diagnosis">
        <Stat label="Total" value={formatDuration(timeline?.totalMs ?? trace.durationMs)} />
        <Stat label="TTFA" value={formatDuration(timeline?.milestones.ttfa ?? trace.performance?.timeToFirstEventMs)} accent="cyan" />
        <Stat label="TTFT" value={formatDuration(timeline?.milestones.ttft ?? trace.performance?.timeToFirstTextMs)} accent="green" />
        <Stat label="First render" value={formatDuration(timeline?.milestones.render)} accent="purple" />
        <Stat label="Bottleneck" value={timeline?.bottleneck?.label ?? '—'} detail={formatDuration(timeline?.bottleneck?.durationMs)} accent="orange" />
      </section>

      {timeline ? <Waterfall trace={trace} timeline={timeline} /> : (
        <section className="agent-debug-panel"><Empty>No timing data recorded for this run.</Empty></section>
      )}

      <section className="agent-debug-lower-grid">
        <ContextPanel trace={trace} />
        <ToolPanel trace={trace} />
      </section>
      <PromptPanel trace={trace} />
    </div>
  );
};

const Stat = ({ label, value, detail, accent }: { label: string; value: string; detail?: string; accent?: string }) => (
  <div className={`agent-debug-stat${accent ? ` is-${accent}` : ''}`}>
    <span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}
  </div>
);

const Waterfall = ({ trace, timeline }: { trace: AgentDebugTrace; timeline: NonNullable<ReturnType<typeof buildTraceTimeline>> }) => {
  const runtime = runtimeOwner(trace.runtime?.id);
  const lanes: Array<PerformanceOwner | 'renderer'> = ['canvas-host', runtime, 'renderer'];
  const total = Math.max(1, timeline.totalMs);
  return (
    <section className="agent-debug-panel agent-debug-waterfall">
      <div className="agent-debug-panel-title">
        <div><strong>Critical path</strong><span>Host → {ownerLabel(runtime)} → UI</span></div>
        <div className="agent-debug-legend"><i className="is-phase" /> phase <i className="is-generation" /> generation <i className="is-tool" /> tool</div>
      </div>
      <div className="agent-debug-ruler">
        <span /><span>0</span><span>{formatDuration(total * .25)}</span><span>{formatDuration(total * .5)}</span><span>{formatDuration(total * .75)}</span><span>{formatDuration(total)}</span>
      </div>
      {lanes.map(owner => {
        const items = timeline.items.filter(item => item.owner === owner);
        return (
          <div className={`agent-debug-lane is-${owner}`} key={owner}>
            <div className="agent-debug-lane-label"><span className={`agent-debug-runtime-dot is-${owner}`} /><strong>{ownerLabel(owner)}</strong><small>{items.length} events</small></div>
            <div className="agent-debug-lane-rows">
              {items.length === 0 ? <div className="agent-debug-lane-empty">No events</div> : items.map(item => (
                <TimelineRow key={item.id} item={item} total={total} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};

const TimelineRow = ({ item, total }: { item: TraceTimelineItem; total: number }) => {
  const left = Math.min(100, (item.startMs / total) * 100);
  const width = item.durationMs === 0 ? 0 : Math.max(1, Math.min(100 - left, (item.durationMs / total) * 100));
  return (
    <div className="agent-debug-timeline-row">
      <div className="agent-debug-event-label">
        <strong>{item.kind === 'milestone' ? milestoneLabel(item.label) : item.label}</strong>
        <span>{item.detail ?? (item.durationMs > 0 ? formatDuration(item.durationMs) : `+${formatDuration(item.startMs)}`)}</span>
      </div>
      <div className="agent-debug-track">
        {item.kind === 'milestone' || item.kind === 'compaction' ? (
          <i className={`agent-debug-marker is-${item.kind}`} style={{ left: `${left}%` }} />
        ) : (
          <i className={`agent-debug-bar is-${item.kind}${item.status === 'error' ? ' is-error' : ''}`} style={{ left: `${left}%`, width: `${width}%` }} />
        )}
      </div>
    </div>
  );
};

const ContextPanel = ({ trace }: { trace: AgentDebugTrace }) => (
  <section className="agent-debug-panel">
    <div className="agent-debug-panel-title"><div><strong>Request context</strong><span>Canvas Host</span></div></div>
    <dl className="agent-debug-kv">
      <div><dt>Scope</dt><dd>{trace.request.scope ?? 'current_canvas'}</dd></div>
      <div><dt>Mode</dt><dd>{trace.request.executionMode ?? 'auto'}</dd></div>
      <div><dt>Attachments</dt><dd>{trace.request.attachmentCount}</dd></div>
      <div><dt>Canvas nodes</dt><dd>{trace.request.workspace?.nodeCount ?? '—'}</dd></div>
      <div><dt>Read nodes</dt><dd>{trace.readNodes.length}</dd></div>
      <div><dt>Session</dt><dd><code>{shortId(trace.sessionId, 12)}</code></dd></div>
    </dl>
  </section>
);

const ToolPanel = ({ trace }: { trace: AgentDebugTrace }) => (
  <section className="agent-debug-panel">
    <div className="agent-debug-panel-title"><div><strong>Tool calls</strong><span>{trace.toolCalls.length} total</span></div></div>
    {trace.toolCalls.length === 0 ? <Empty>No tool calls.</Empty> : (
      <div className="agent-debug-tool-list">{trace.toolCalls.map((tool, index) => (
        <details key={`${tool.toolCallId ?? tool.name}-${index}`}>
          <summary><span className={`agent-debug-tool-status is-${tool.status}`} /><strong>{tool.name}</strong><small>{formatDuration(tool.durationMs)}</small></summary>
          {tool.argsPreview && <CodeBlock title="Args" value={tool.argsPreview} />}
          {tool.resultSummary && <CodeBlock title="Result" value={tool.resultSummary} />}
        </details>
      ))}</div>
    )}
  </section>
);

const PromptPanel = ({ trace }: { trace: AgentDebugTrace }) => (
  <details className="agent-debug-panel agent-debug-prompt-panel">
    <summary><div><strong>Prompt & message snapshot</strong><span>{trace.prompt.systemPromptChars.toLocaleString()} system chars · {trace.messageSnapshot?.messageCount ?? 0} messages</span></div><small>Inspect payload</small></summary>
    <CodeBlock title="User prompt" value={trace.request.userPromptPreview} />
    <CodeBlock title="System prompt" value={trace.messageSnapshot?.systemPrompt ?? trace.prompt.systemPromptPreview} />
    {trace.messageSnapshot && <CodeBlock title="Messages" value={trace.messageSnapshot.messagesJson} />}
  </details>
);

const CodeBlock = ({ title, value }: { title: string; value?: string }) => (
  <div className="agent-debug-code-block"><div>{title}</div><pre>{value || '—'}</pre></div>
);
