import { useI18n } from '../../i18n';
import type { ToolCallStatus } from './types';

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

interface Props {
  tool: ToolCallStatus;
  expanded: boolean;
}

const SESSION_TOOL_NAMES = new Set(['session_search', 'session_summary']);

const formatArgs = (args: unknown): string => {
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const parseSessionRefs = (tool: ToolCallStatus): SessionRef[] | null => {
  if (
    tool.status !== 'succeeded'
    || !SESSION_TOOL_NAMES.has(tool.name)
    || !tool.result
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(tool.result) as {
      ok?: boolean;
      sessions?: Array<Record<string, unknown>>;
    };
    if (!parsed?.ok || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      return null;
    }
    return parsed.sessions.map((session) => {
      const snippets = Array.isArray(session.snippets)
        ? session.snippets as Array<{ messageIndex?: number }>
        : [];
      const firstMatchIndex = snippets[0]?.messageIndex;
      return {
        sessionId: String(session.sessionId ?? ''),
        workspaceId: String(session.workspaceId ?? ''),
        workspaceName: String(session.workspaceName ?? ''),
        date: String(session.date ?? ''),
        messageCount: typeof session.messageCount === 'number' ? session.messageCount : 0,
        preview: typeof session.preview === 'string' ? session.preview : undefined,
        firstMatchIndex: typeof firstMatchIndex === 'number' ? firstMatchIndex : undefined,
      };
    }).filter(ref => ref.sessionId && ref.workspaceId);
  } catch {
    return null;
  }
};

export const ChatToolCallDetails = ({ tool, expanded }: Props) => {
  const { t } = useI18n();
  const sessionRefs = parseSessionRefs(tool);
  const hasDetails = tool.result || tool.error || tool.args !== undefined;

  return (
    <>
      {sessionRefs && (
        <div className="chat-session-refs">
          {sessionRefs.map(ref => (
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
              <span className="chat-session-ref-count">
                {t('chat.toolCalls.messageCount', { count: ref.messageCount })}
              </span>
              {ref.preview && (
                <span className="chat-session-ref-preview">
                  {ref.preview.length > 40 ? `${ref.preview.slice(0, 38)}…` : ref.preview}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {expanded && hasDetails && (
        <div className="chat-tool-call-result">
          {tool.args !== undefined && (
            <div className="chat-tool-call-section">
              <div className="chat-tool-call-section-label">
                {tool.name} · {t('chat.toolCalls.input')}
              </div>
              <pre>{formatArgs(tool.args)}</pre>
            </div>
          )}
          {tool.result && (
            <div className="chat-tool-call-section">
              <div className="chat-tool-call-section-label">{t('chat.toolCalls.output')}</div>
              <pre>
                {tool.result.length > 2000
                  ? `${tool.result.slice(0, 2000)}\n${t('chat.toolCalls.truncated')}`
                  : tool.result}
              </pre>
            </div>
          )}
          {tool.error && tool.error !== tool.result && (
            <div className="chat-tool-call-section chat-tool-call-section--error">
              <div className="chat-tool-call-section-label">{t('chat.toolCalls.error')}</div>
              <pre>{tool.error}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
};
