import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { SpinnerIcon } from '../icons';
import type { I18nKey } from '../../i18n/messages';
import type { ToolCallStatus } from './types';
import { ChatToolCallDetails } from './ChatToolCallDetails';

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

const TOOL_LABEL_SLUGS: Record<string, string> = {
  canvas_read_context: 'readCanvasContext',
  canvas_read_node: 'readNode',
  knowledge_search_nodes: 'searchKnowledgeNodes',
  knowledge_read_node: 'readKnowledgeNode',
  knowledge_analyze_image: 'analyzeKnowledgeImage',
  canvas_create_node: 'createNode',
  canvas_create_agent_node: 'createAgentNode',
  canvas_create_terminal_node: 'createTerminalNode',
  canvas_update_node: 'updateNode',
  canvas_delete_node: 'deleteNode',
  canvas_move_node: 'moveNode',
  canvas_send_to_agent: 'sendToAgent',
  read: 'readFile',
  write: 'writeFile',
  edit: 'editFile',
  grep: 'search',
  ls: 'listDir',
  bash: 'runCommand',
  session_search: 'searchSession',
  session_summary: 'summarizeSession',
};

function formatToolLabel(name: string, status: ToolCallStatus['status'], t: (key: I18nKey) => string): string {
  if (status === 'failed') return t('chat.toolCalls.failed');
  if (status === 'cancelled') return t('chat.toolCalls.cancelled');
  if (status === 'queued') return t('chat.toolCalls.queued');
  const slug = TOOL_LABEL_SLUGS[name];
  const state = status === 'running' ? 'running' : 'done';
  if (slug) {
    return t(`toolCall.${slug}.${state}` as I18nKey);
  }
  return t(`toolCall.default.${state}`);
}

export const ChatToolCalls = ({
  tools,
  collapsed,
  expandedTools,
  showSectionHeader,
  onToggleSection,
  onToggleToolExpand,
  onSessionJump,
}: ChatToolCallsProps) => {
  const { t } = useI18n();
  const counts = useMemo(() => ({
    queued: tools.filter(tool => tool.status === 'queued').length,
    running: tools.filter(tool => tool.status === 'running').length,
    succeeded: tools.filter(tool => tool.status === 'succeeded').length,
    failed: tools.filter(tool => tool.status === 'failed').length,
    cancelled: tools.filter(tool => tool.status === 'cancelled').length,
  }), [tools]);
  const completedLabel = counts.running > 0 || counts.queued > 0
    ? t('chat.toolCalls.runningSummary', {
        running: counts.running + counts.queued,
        succeeded: counts.succeeded,
        failed: counts.failed,
      })
    : counts.failed > 0 || counts.cancelled > 0
      ? t('chat.toolCalls.summary', counts)
      : t('chat.toolCalls.completed', { count: counts.succeeded });

  if (collapsed) {
    return (
      <button
        type="button"
        className="chat-tool-calls chat-tool-calls--collapsed"
        aria-expanded="false"
        aria-label={t('chat.toolCalls.expandSection', { count: tools.length })}
        onClick={onToggleSection}
      >
        <span className="chat-tool-call-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="chat-tool-calls-summary">{completedLabel}</span>
        <span className="chat-tool-call-chevron">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div className="chat-tool-calls">
      {showSectionHeader && tools.length > 0 && (
        <button
          type="button"
          className="chat-tool-calls-section-header"
          aria-expanded="true"
          aria-label={t('chat.toolCalls.collapseSection', { count: tools.length })}
          onClick={onToggleSection}
        >
          <span className="chat-tool-calls-summary">{completedLabel}</span>
          <span className="chat-tool-call-chevron chat-tool-call-chevron--open">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      )}
      {tools.map(tool => {
        const canToggle = tool.status !== 'running'
          && tool.status !== 'queued'
          && !!(tool.result || tool.error || tool.args !== undefined);
        const expanded = tool.status === 'failed' || expandedTools.has(tool.id);
        const headerContent = (
          <>
            <span className="chat-tool-call-icon">
              {tool.status === 'running' || tool.status === 'queued' ? (
                <SpinnerIcon size={12} className="chat-tool-call-spinner" />
              ) : tool.status === 'failed' ? (
                <span aria-hidden="true">!</span>
              ) : tool.status === 'cancelled' ? (
                <span aria-hidden="true">×</span>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="chat-tool-call-sig" title={formatToolSignature(tool.name, tool.args)}>
              <span className="chat-tool-call-label">{formatToolLabel(tool.name, tool.status, t)}</span>
              <span className="chat-tool-call-name">{tool.name}</span>
            </span>
            {canToggle && (
              <span className={`chat-tool-call-chevron${expanded ? ' chat-tool-call-chevron--open' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </>
        );

        return (
          <div key={tool.id} className={`chat-tool-call chat-tool-call--${tool.status}`}>
            {canToggle ? (
              <button
                type="button"
                className="chat-tool-call-header chat-tool-call-header--expandable"
                aria-expanded={expanded}
                aria-label={expanded
                  ? t('chat.toolCalls.collapseResult', { name: tool.name })
                  : t('chat.toolCalls.expandResult', { name: tool.name })}
                onClick={() => onToggleToolExpand(tool.id)}
              >
                {headerContent}
              </button>
            ) : (
              <div className="chat-tool-call-header">
                {headerContent}
              </div>
            )}
            <ChatToolCallDetails tool={tool} expanded={expanded} />
          </div>
        );
      })}
    </div>
  );
};
