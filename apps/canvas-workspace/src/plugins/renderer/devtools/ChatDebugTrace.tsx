import { useState } from 'react';
import './ChatDebugTrace.css';
import type { AgentDebugTrace } from '../../../renderer/src/types';

interface ChatDebugTraceProps {
  trace: AgentDebugTrace;
}

const shortId = (value: string, length = 8) => value.length <= length ? value : value.slice(0, length);

const formatDuration = (durationMs?: number) => {
  if (durationMs == null) return 'running';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
};

const formatTime = (timestamp?: number) => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const CopyButton = ({ value, label }: { value: string; label: string }) => (
  <button
    type="button"
    className="chat-debug-copy"
    onClick={() => void navigator.clipboard?.writeText(value)}
    title={`Copy ${label}`}
  >
    copy
  </button>
);

const TraceText = ({ value }: { value?: string }) => {
  if (!value) return <span className="chat-debug-muted">—</span>;
  return <pre className="chat-debug-pre">{value}</pre>;
};

export const ChatDebugTrace = ({ trace }: ChatDebugTraceProps) => {
  const [open, setOpen] = useState(false);
  const readNodeCount = trace.readNodes.length;
  const toolCount = trace.toolCalls.length;
  const debugHref = `#/debug?sessionId=${encodeURIComponent(trace.sessionId)}&runId=${encodeURIComponent(trace.runId)}`;

  return (
    <div className={`chat-debug-trace${open ? ' chat-debug-trace--open' : ''}`}>
      <button type="button" className="chat-debug-summary" onClick={() => setOpen(value => !value)}>
        <span className="chat-debug-dot" />
        <span className="chat-debug-title">Debug Trace</span>
        <span className="chat-debug-pill">run {shortId(trace.runId)}</span>
        <span className="chat-debug-pill">{toolCount} tools</span>
        <span className="chat-debug-pill">read {readNodeCount} nodes</span>
        <span className="chat-debug-pill">{formatDuration(trace.durationMs)}</span>
        <span className="chat-debug-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="chat-debug-body">
          <section className="chat-debug-section">
            <div className="chat-debug-section-title">Run</div>
            <div className="chat-debug-grid">
              <span>sessionId</span>
              <code>{trace.sessionId}</code>
              <CopyButton value={trace.sessionId} label="sessionId" />
              <span>runId</span>
              <code>{trace.runId}</code>
              <CopyButton value={trace.runId} label="runId" />
              <span>started</span>
              <code>{formatTime(trace.startedAt)}</code>
              <span />
              <span>duration</span>
              <code>{formatDuration(trace.durationMs)}</code>
              <span />
              <span>model</span>
              <code>{[trace.model?.provider, trace.model?.model].filter(Boolean).join(' / ') || '—'}</code>
              <span />
            </div>
            <a className="chat-debug-open-link" href={trace.debugUrl ?? debugHref}>
              Open debugger
            </a>
          </section>

          <section className="chat-debug-section">
            <div className="chat-debug-section-title">Context</div>
            <div className="chat-debug-meta-row">
              <span>mode: <code>{trace.request.executionMode ?? 'auto'}</code></span>
              <span>scope: <code>{trace.request.scope ?? 'current_canvas'}</code></span>
              {trace.request.quickAction && <span>action: <code>{trace.request.quickAction}</code></span>}
              {trace.request.workspace && (
                <span>{trace.request.workspace.name} · {trace.request.workspace.nodeCount} nodes</span>
              )}
            </div>
            <div className="chat-debug-subtitle">User prompt preview</div>
            <TraceText value={trace.request.userPromptPreview} />

            {trace.request.selectedNodes.length > 0 && (
              <>
                <div className="chat-debug-subtitle">Selected nodes</div>
                <NodeList nodes={trace.request.selectedNodes} />
              </>
            )}

            {trace.request.mentionedCanvases.length > 0 && (
              <>
                <div className="chat-debug-subtitle">Mentioned canvases</div>
                <div className="chat-debug-list">
                  {trace.request.mentionedCanvases.map(canvas => (
                    <div key={canvas.id} className="chat-debug-list-item">
                      <strong>{canvas.name}</strong>
                      <code>{canvas.id}</code>
                    </div>
                  ))}
                </div>
              </>
            )}

            <details className="chat-debug-details">
              <summary>System prompt preview · {trace.prompt.systemPromptChars.toLocaleString()} chars</summary>
              <TraceText value={trace.prompt.systemPromptPreview} />
            </details>
          </section>

          <section className="chat-debug-section">
            <div className="chat-debug-section-title">Tools</div>
            {trace.toolCalls.length === 0 ? (
              <div className="chat-debug-muted">No tool calls recorded.</div>
            ) : (
              <div className="chat-debug-tool-list">
                {trace.toolCalls.map((tool, index) => (
                  <details key={`${tool.toolCallId ?? tool.name}-${index}`} className="chat-debug-tool">
                    <summary>
                      <span className={`chat-debug-status chat-debug-status--${tool.status}`} />
                      <strong>{tool.name}</strong>
                      <span>{formatDuration(tool.durationMs)}</span>
                      {tool.readNodes?.length ? <span>{tool.readNodes.length} nodes</span> : null}
                    </summary>
                    {tool.argsPreview && (
                      <>
                        <div className="chat-debug-subtitle">Args</div>
                        <TraceText value={tool.argsPreview} />
                      </>
                    )}
                    {tool.resultSummary && (
                      <>
                        <div className="chat-debug-subtitle">Result</div>
                        <TraceText value={tool.resultSummary} />
                      </>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>

          {trace.readNodes.length > 0 && (
            <section className="chat-debug-section">
              <div className="chat-debug-section-title">Read Nodes</div>
              <NodeList nodes={trace.readNodes} />
            </section>
          )}

          {trace.truncated && (
            <div className="chat-debug-warning">Trace truncated to keep the dev session lightweight.</div>
          )}
        </div>
      )}
    </div>
  );
};

const NodeList = ({ nodes }: { nodes: AgentDebugTrace['readNodes'] }) => (
  <div className="chat-debug-list">
    {nodes.map((node, index) => (
      <div key={`${node.workspaceId ?? ''}-${node.id}-${node.source ?? ''}-${index}`} className="chat-debug-list-item">
        <strong>{node.title}</strong>
        <span>{node.type}</span>
        <code>{node.id}</code>
        {node.contentChars != null && <span>{node.contentChars.toLocaleString()} chars</span>}
        {node.workspaceName && <span>{node.workspaceName}</span>}
      </div>
    ))}
  </div>
);
