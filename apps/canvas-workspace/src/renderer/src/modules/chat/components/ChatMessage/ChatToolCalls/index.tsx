import { useMemo } from 'react';
import { useI18n } from '../../../../../i18n';
import { SpinnerIcon } from '../../../../../components/icons';
import type { ToolCallStatus } from '../../../../../types';
import { ChatToolCallDetails } from './ChatToolCallDetails';
import './index.css';

interface ChatToolCallsProps {
  tools: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  showSectionHeader: boolean;
  isStreaming?: boolean;
  liveDetailsOpen?: boolean;
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

import {
  TOOL_LABEL_SLUGS,
  displayToolStatus,
  formatToolDescription,
  formatToolLabel,
  formatToolSignature,
} from './toolFormatting';
export { displayToolStatus, formatToolDescription, formatToolLabel } from './toolFormatting';

export const ChatToolCalls = ({
  tools,
  collapsed,
  expandedTools,
  showSectionHeader,
  isStreaming = false,
  liveDetailsOpen = false,
  onToggleSection,
  onToggleToolExpand,
  onSessionJump,
}: ChatToolCallsProps) => {
  const { t } = useI18n();
  const displayTools = useMemo(() => tools.map(tool => ({
    tool,
    status: displayToolStatus(tool),
  })), [tools]);
  const counts = useMemo(() => ({
    queued: displayTools.filter(({ status }) => status === 'queued').length,
    running: displayTools.filter(({ status }) => status === 'running').length,
    succeeded: displayTools.filter(({ status }) => status === 'succeeded').length,
    failed: displayTools.filter(({ status }) => status === 'failed').length,
    cancelled: displayTools.filter(({ status }) => status === 'cancelled').length,
  }), [displayTools]);
  const completedLabel = counts.running > 0 || counts.queued > 0
    ? t('chat.toolCalls.runningSummary', {
        running: counts.running + counts.queued,
        succeeded: counts.succeeded,
        failed: counts.failed,
      })
    : counts.failed > 0 || counts.cancelled > 0
      ? t('chat.toolCalls.summary', counts)
      : t('chat.toolCalls.completed', { count: counts.succeeded });
  const hasLiveTools = counts.running > 0 || counts.queued > 0;

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
          {hasLiveTools ? (
            <SpinnerIcon size={12} className="chat-tool-call-spinner" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
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

  const toolList = (
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
      {displayTools.map(({ tool, status }) => {
        const canToggle = status !== 'running'
          && status !== 'queued'
          && !!(tool.result || tool.error || tool.args !== undefined);
        const expanded = expandedTools.has(tool.id);
        const description = formatToolDescription(tool);
        const label = description ?? formatToolLabel(tool.name, status, t);
        const signature = formatToolSignature(tool.name, tool.args);
        const showRawName = !description && (
          !TOOL_LABEL_SLUGS[tool.name]
          || status === 'failed'
          || status === 'cancelled'
        );
        const headerTitle = description ? `${description} · ${signature}` : signature;
        const headerContent = (
          <>
            <span className="chat-tool-call-icon">
              {status === 'running' || status === 'queued' ? (
                <SpinnerIcon size={12} className="chat-tool-call-spinner" />
              ) : status === 'failed' ? (
                <span aria-hidden="true">!</span>
              ) : status === 'cancelled' ? (
                <span aria-hidden="true">×</span>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="chat-tool-call-sig" title={headerTitle}>
              <span className="chat-tool-call-label">{label}</span>
              {showRawName && <span className="chat-tool-call-name">{tool.name}</span>}
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
          <div key={tool.id} className={`chat-tool-call chat-tool-call--${status}`}>
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

  if (isStreaming) {
    return (
      <div
        className={`chat-tool-details-reveal${liveDetailsOpen ? ' chat-tool-details-reveal--open' : ''}`}
        aria-hidden={!liveDetailsOpen}
      >
        <div className="chat-tool-details-reveal__inner">
          {toolList}
        </div>
      </div>
    );
  }

  return toolList;
};
