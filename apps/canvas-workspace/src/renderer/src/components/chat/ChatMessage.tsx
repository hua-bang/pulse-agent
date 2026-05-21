import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import type { AgentChatMessage, CanvasNode } from '../../types';
import { toFileUrl } from '../../utils/fileUrl';
import { AvatarIcon, PencilIcon, RefreshIcon } from '../icons';
import type { ToolCallStatus } from './types';
import { renderMdWithMentions, renderUserContent } from './utils/mentions';
import { renderMermaidIn } from './utils/mermaid';
import { formatAbsoluteTime, formatRelativeTime } from './utils/time';
import { ChatToolCalls } from './ChatToolCalls';
import { PluginChatCardForMessage } from '../../../../plugins/renderer';
import {
  ChatArtifactCard,
  ChatInlineVisual,
  parseVisualToolResult,
} from '../artifacts';

const CopyMessageButton = memo(({ content }: { content: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }, [content]);
  return (
    <button
      type="button"
      className={`chat-message-toolbar-btn${copied ? ' chat-message-toolbar-btn--copied' : ''}`}
      title="Copy message (markdown source)"
      onClick={handleCopy}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
});
CopyMessageButton.displayName = 'CopyMessageButton';

interface GeneratedImagePayload {
  ok?: boolean;
  type?: string;
  title?: string;
  outputPath?: string;
  mimeType?: string;
  addToCanvasAction?: { workspaceId?: string; imagePath?: string };
}

const parseGeneratedImage = (result?: string): GeneratedImagePayload | null => {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as GeneratedImagePayload;
    return parsed?.ok && parsed?.type === 'generated_image' && parsed.outputPath ? parsed : null;
  } catch {
    return null;
  }
};

interface ChatMessageProps {
  message: AgentChatMessage;
  /** Index in the parent's `messages` array — used by edit / regenerate. */
  index: number;
  isStreaming: boolean;
  loading: boolean;
  tools?: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  nodes?: CanvasNode[];
  workspaceId: string;
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  /** DOM id used by ChatAnchors to scroll this message into view. */
  anchorId?: string;
  /** Replace this user message with `newContent` and re-run the turn. */
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  /** Re-run the user turn that produced this assistant message. */
  onRegenerate?: (index: number) => Promise<boolean> | void;
}

const LoadingDots = () => (
  <div className="chat-loading">
    <div className="chat-loading-dot" />
    <div className="chat-loading-dot" />
    <div className="chat-loading-dot" />
  </div>
);

export const ChatMessage = ({
  message,
  index,
  isStreaming,
  loading,
  tools,
  collapsed,
  expandedTools,
  nodes,
  workspaceId,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  anchorId,
  onEditUserMessage,
  onRegenerate,
}: ChatMessageProps) => {
  const assistantHtml = useMemo(
    () => (message.role === 'assistant'
      ? renderMdWithMentions(message.content, nodes)
      : ''),
    [message.role, message.content, nodes],
  );
  const userBody = useMemo(
    () => (message.role === 'user'
      ? renderUserContent(message.content, nodes)
      : null),
    [message.role, message.content, nodes],
  );
  const showCopyToolbar = message.role === 'assistant'
    && !isStreaming
    && !!message.content;
  const relativeTime = formatRelativeTime(message.timestamp);
  const absoluteTime = formatAbsoluteTime(message.timestamp);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const canEdit = message.role === 'user'
    && !!onEditUserMessage
    && !loading
    && !isStreaming;
  const canRegenerate = message.role === 'assistant'
    && !!onRegenerate
    && !loading
    && !isStreaming;

  const handleStartEdit = useCallback(() => {
    setEditValue(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!onEditUserMessage) return;
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setIsEditing(false);
    await onEditUserMessage(index, trimmed);
  }, [editValue, index, onEditUserMessage]);

  const handleEditKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSaveEdit();
    }
  }, [handleCancelEdit, handleSaveEdit]);

  const handleRegenerate = useCallback(() => {
    if (!onRegenerate) return;
    void onRegenerate(index);
  }, [index, onRegenerate]);

  const handleImageError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const card = event.currentTarget.closest('.chat-message-image-card');
    card?.classList.add('chat-message-image-card--broken');
  }, []);

  // After every (re-)render of the assistant body, render any pending
  // mermaid placeholders. We skip while streaming because partial
  // diagrams will always fail to parse — they get picked up once the
  // stream completes.
  const assistantBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message.role !== 'assistant' || isStreaming) return;
    renderMermaidIn(assistantBodyRef.current);
  }, [assistantHtml, isStreaming, message.role]);

  return (
    <div className={`chat-message chat-message-${message.role}`} id={anchorId}>
    {message.role === 'assistant' && (
      <div className="chat-message-avatar">
        <AvatarIcon size={14} />
      </div>
    )}
    <div className="chat-message-body">
      {message.attachments && message.attachments.length > 0 && (
        <div className="chat-message-images">
          {message.attachments.map(attachment => (
            <figure key={attachment.id} className="chat-message-image-card">
              <img
                src={toFileUrl(attachment.path)}
                alt={attachment.fileName ?? 'image'}
                loading="lazy"
                decoding="async"
                onError={handleImageError}
              />
              {attachment.fileName && <figcaption>{attachment.fileName}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {message.role === 'assistant' && tools && tools.length > 0 && (
        <>
          <ChatToolCalls
            tools={tools}
            collapsed={collapsed}
            expandedTools={expandedTools}
            showSectionHeader={!loading}
            onToggleSection={onToggleSection}
            onToggleToolExpand={onToggleToolExpand}
          />
          <div className="chat-generated-images">
            {tools.map(tool => {
              const image = parseGeneratedImage(tool.result);
              if (!image?.outputPath) return null;
              return (
                <figure key={`generated-${tool.id}`} className="chat-generated-image-card">
                  <img src={toFileUrl(image.outputPath)} alt={image.title ?? 'Generated image'} />
                  <figcaption>
                    <span>{image.title ?? 'Generated image'}</span>
                    <button
                      type="button"
                      onClick={() => void onAddImageToCanvas?.(image.outputPath!, image.title)}
                    >
                      Add to canvas
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          {tools.map(tool => {
            // visual_render in flight: drive an inline streaming preview.
            // Prefer `streamedContent` (the tool's own side-channel chunks)
            // when present — works on any LLM/provider — and fall back to
            // partial JSON extraction if the upstream model genuinely
            // streams tool args.
            if (tool.name === 'visual_render' && !tool.result) {
              return (
                <ChatInlineVisual
                  key={`visual-${tool.id}`}
                  workspaceId={workspaceId}
                  streamedContent={tool.streamedContent}
                  partialInput={tool.partialInput}
                  streaming
                />
              );
            }
            // visual_render finished but the side-channel stream may still
            // be flushing the final frames. Until streamedDone, keep using
            // the streaming view so the swap to the script-enabled iframe
            // happens at the END of the animation, not on tool-result.
            if (tool.name === 'visual_render' && tool.result && !tool.streamedDone && tool.streamedContent) {
              return (
                <ChatInlineVisual
                  key={`visual-${tool.id}`}
                  workspaceId={workspaceId}
                  streamedContent={tool.streamedContent}
                  streaming
                />
              );
            }
            // artifact_create / _update in flight → no inline preview at
            // all; the tool-call chip above signals progress and the
            // artifact card lands once the tool returns. Drawer is the
            // right place for a live artifact preview, not the chat.
            if (
              (tool.name === 'artifact_create' || tool.name === 'artifact_update')
              && !tool.result
            ) {
              return null;
            }
            const visual = parseVisualToolResult(tool.name, tool.result);
            if (!visual) return null;
            if (visual.kind === 'visual_render') {
              return (
                <ChatInlineVisual
                  key={`visual-${tool.id}`}
                  workspaceId={workspaceId}
                  payload={visual.payload}
                />
              );
            }
            return (
              <ChatArtifactCard
                key={`artifact-${tool.id}`}
                workspaceId={workspaceId}
                payload={visual.payload}
              />
            );
          })}
        </>
      )}
      {message.role === 'assistant' ? (
        isStreaming ? (
          message.content ? (
            <div
              ref={assistantBodyRef}
              className="chat-message-content chat-md chat-md--streaming"
              dangerouslySetInnerHTML={{ __html: assistantHtml }}
            />
          ) : (!tools || tools.length === 0) ? (
            <LoadingDots />
          ) : null
        ) : (
          <div
            ref={assistantBodyRef}
            className="chat-message-content chat-md"
            dangerouslySetInnerHTML={{ __html: assistantHtml }}
          />
        )
      ) : isEditing ? (
        <div className="chat-message-edit">
          <textarea
            className="chat-message-edit-input"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={handleEditKeyDown}
            autoFocus
            rows={Math.min(8, Math.max(2, editValue.split('\n').length))}
          />
          <div className="chat-message-edit-actions">
            <span className="chat-message-edit-hint">⌘↵ to save · Esc to cancel</span>
            <button
              type="button"
              className="chat-message-toolbar-btn"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--primary"
              onClick={() => void handleSaveEdit()}
              disabled={!editValue.trim()}
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-message-content">{userBody}</div>
      )}
      <PluginChatCardForMessage message={message} />
      {!isEditing && (showCopyToolbar || canEdit || canRegenerate || relativeTime) && (
        <div className="chat-message-toolbar">
          {relativeTime && (
            <time
              className="chat-message-timestamp"
              dateTime={new Date(message.timestamp).toISOString()}
              title={absoluteTime}
            >
              {relativeTime}
            </time>
          )}
          {canEdit && (
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
              title="Edit & resend"
              aria-label="Edit and resend"
              onClick={handleStartEdit}
            >
              <PencilIcon size={12} />
            </button>
          )}
          {canRegenerate && (
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
              title="Regenerate response"
              aria-label="Regenerate response"
              onClick={handleRegenerate}
            >
              <RefreshIcon size={12} />
            </button>
          )}
          {showCopyToolbar && <CopyMessageButton content={message.content} />}
        </div>
      )}
    </div>
  </div>
  );
};
