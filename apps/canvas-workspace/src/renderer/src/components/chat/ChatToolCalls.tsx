import { useMemo } from 'react';
import type { ToolCallStatus } from './types';

interface ChatToolCallsProps {
  tools: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  showSectionHeader: boolean;
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function formatToolSignature(name: string, args: any): string {
  if (!args) return `${name}()`;

  const parts: string[] = [];
  if (name === 'read' || name === 'write') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
  } else if (name === 'edit') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
    if (args.old_string) parts.push(JSON.stringify(truncate(args.old_string, 30)));
  } else if (name === 'bash') {
    if (args.command) parts.push(JSON.stringify(truncate(args.command, 60)));
  } else if (name === 'grep') {
    if (args.pattern) parts.push(JSON.stringify(args.pattern));
    if (args.path) parts.push(JSON.stringify(args.path));
  } else if (name === 'ls') {
    if (args.path) parts.push(JSON.stringify(args.path));
  } else {
    for (const value of Object.values(args)) {
      if (parts.length >= 3) break;
      if (typeof value === 'string') parts.push(JSON.stringify(truncate(value, 40)));
      else if (typeof value === 'number') parts.push(String(value));
    }
  }

  return `${name}(${parts.join(', ')})`;
}

function formatToolLabel(name: string, status: ToolCallStatus['status']): string {
  const prefix = status === 'running' ? '正在' : '已';
  switch (name) {
    case 'canvas_read_context':
      return `${prefix}读取画布上下文`;
    case 'canvas_read_node':
      return `${prefix}读取节点内容`;
    case 'canvas_create_node':
      return `${prefix}创建画布节点`;
    case 'canvas_create_agent_node':
      return `${prefix}创建 Agent 节点`;
    case 'canvas_create_terminal_node':
      return `${prefix}创建 Terminal 节点`;
    case 'canvas_update_node':
      return `${prefix}更新画布节点`;
    case 'canvas_delete_node':
      return `${prefix}删除画布节点`;
    case 'canvas_move_node':
      return `${prefix}移动画布节点`;
    case 'canvas_send_to_agent':
      return `${prefix}发送给 Agent`;
    case 'read':
      return `${prefix}读取文件`;
    case 'write':
      return `${prefix}写入文件`;
    case 'edit':
      return `${prefix}编辑文件`;
    case 'grep':
      return `${prefix}搜索内容`;
    case 'ls':
      return `${prefix}查看目录`;
    case 'bash':
      return `${prefix}运行命令`;
    case 'session_search':
      return `${prefix}检索会话`;
    case 'session_summary':
      return `${prefix}获取会话摘要`;
    default:
      return status === 'running' ? '正在执行' : '已执行';
  }
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

// ─── Session references from session_search / session_summary ──────

interface SessionRef {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  messageCount: number;
  preview?: string;
  /** First matched message index — used for scroll-to on jump. */
  firstMatchIndex?: number;
}

const SESSION_TOOL_NAMES = new Set(['session_search', 'session_summary']);

function parseSessionRefs(tool: ToolCallStatus): SessionRef[] | null {
  if (!SESSION_TOOL_NAMES.has(tool.name) || !tool.result) return null;
  try {
    const parsed = JSON.parse(tool.result) as { ok?: boolean; sessions?: Array<Record<string, unknown>> };
    if (!parsed?.ok || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null;
    return parsed.sessions.map((s) => {
      // For session_search, snippets[0].messageIndex gives the first hit.
      const snippets = Array.isArray(s.snippets) ? s.snippets as Array<{ messageIndex?: number }> : [];
      const firstMatchIndex = snippets[0]?.messageIndex;
      return {
        sessionId: String(s.sessionId ?? ''),
        workspaceId: String(s.workspaceId ?? ''),
        workspaceName: String(s.workspaceName ?? ''),
        date: String(s.date ?? ''),
        messageCount: typeof s.messageCount === 'number' ? s.messageCount : 0,
        preview: typeof s.preview === 'string' ? s.preview : undefined,
        firstMatchIndex: typeof firstMatchIndex === 'number' ? firstMatchIndex : undefined,
      };
    }).filter((r) => r.sessionId && r.workspaceId);
  } catch {
    return null;
  }
}

const SessionRefChips = ({ refs }: { refs: SessionRef[] }) => (
  <div className="chat-session-refs">
    {refs.map((ref) => (
      <button
        key={`${ref.workspaceId}:${ref.sessionId}`}
        type="button"
        className="chat-session-ref-chip"
        data-action="session-jump"
        data-session-id={ref.sessionId}
        data-workspace-id={ref.workspaceId}
        data-message-index={ref.firstMatchIndex}
        title={ref.preview || ref.sessionId}
      >
        <span className="chat-session-ref-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2.5h5M4 6h5M4 9.5h5M2 2.5h.01M2 6h.01M2 9.5h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="chat-session-ref-name">{ref.workspaceName}</span>
        <span className="chat-session-ref-date">{ref.date}</span>
        <span className="chat-session-ref-count">{ref.messageCount} msgs</span>
        {ref.preview && <span className="chat-session-ref-preview">{ref.preview.length > 40 ? `${ref.preview.slice(0, 38)}…` : ref.preview}</span>}
      </button>
    ))}
  </div>
);

export const ChatToolCalls = ({
  tools,
  collapsed,
  expandedTools,
  showSectionHeader,
  onToggleSection,
  onToggleToolExpand,
  onSessionJump,
}: ChatToolCallsProps) => {
  const sessionRefsByToolId = useMemo(() => {
    const map = new Map<number, SessionRef[]>();
    for (const tool of tools) {
      if (tool.status !== 'done') continue;
      const refs = parseSessionRefs(tool);
      if (refs) map.set(tool.id, refs);
    }
    return map;
  }, [tools]);
  if (collapsed) {
    return (
      <div className="chat-tool-calls chat-tool-calls--collapsed" onClick={onToggleSection}>
        <span className="chat-tool-call-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="chat-tool-calls-summary">已完成 {tools.length} 个操作</span>
        <span className="chat-tool-call-chevron">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <div className="chat-tool-calls">
      {showSectionHeader && tools.length > 0 && (
        <div className="chat-tool-calls-section-header" onClick={onToggleSection}>
          <span className="chat-tool-calls-summary">已完成 {tools.length} 个操作</span>
          <span className="chat-tool-call-chevron chat-tool-call-chevron--open">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      )}
      {tools.map(tool => (
        <div key={tool.id} className={`chat-tool-call chat-tool-call--${tool.status}`}>
          <div
            className="chat-tool-call-header"
            onClick={tool.status === 'done' && tool.result ? () => onToggleToolExpand(tool.id) : undefined}
            style={tool.status === 'done' && tool.result ? { cursor: 'pointer' } : undefined}
          >
            <span className="chat-tool-call-icon">
              {tool.status === 'running' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="chat-tool-call-spinner">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="chat-tool-call-sig" title={formatToolSignature(tool.name, tool.args)}>
              <span className="chat-tool-call-label">{formatToolLabel(tool.name, tool.status)}</span>
              <span className="chat-tool-call-name">{tool.name}</span>
            </span>
            {tool.status === 'done' && tool.result && (
              <span className={`chat-tool-call-chevron${expandedTools.has(tool.id) ? ' chat-tool-call-chevron--open' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
          {sessionRefsByToolId.has(tool.id) && (
            <SessionRefChips refs={sessionRefsByToolId.get(tool.id)!} />
          )}
          {expandedTools.has(tool.id) && (tool.result || tool.args !== undefined) && (
            <div className="chat-tool-call-result">
              {tool.args !== undefined && (
                <div className="chat-tool-call-section">
                  <div className="chat-tool-call-section-label">{tool.name} · input</div>
                  <pre>{formatArgs(tool.args)}</pre>
                </div>
              )}
              {tool.result && (
                <div className="chat-tool-call-section">
                  <div className="chat-tool-call-section-label">output</div>
                  <pre>{tool.result.length > 2000 ? `${tool.result.slice(0, 2000)}\n...(truncated)` : tool.result}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
