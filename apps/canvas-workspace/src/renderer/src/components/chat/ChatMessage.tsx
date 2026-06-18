import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import type { AgentChatMessage, CanvasNode } from '../../types';
import { toFileUrl } from '../../utils/fileUrl';
import { BotAvatarIcon, CheckIcon, CopyIcon, PencilIcon, RefreshIcon } from '../icons';
import type { ToolCallStatus } from './types';
import { renderMdWithMentions } from './utils/mentions';
import { isImeComposing } from '../../utils/ime';
import { renderMermaidIn } from './utils/mermaid';
import { formatAbsoluteTime, formatRelativeTime } from './utils/time';
import { ChatToolCalls } from './ChatToolCalls';
import { ChatImageLightbox, type LightboxImage } from './ChatImageLightbox';
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
      className={`chat-message-toolbar-btn chat-message-toolbar-btn--icon${copied ? ' chat-message-toolbar-btn--copied' : ''}`}
      title={copied ? 'Copied!' : 'Copy message (markdown source)'}
      aria-label="Copy message"
      onClick={handleCopy}
    >
      {copied ? <CheckIcon size={12} strokeWidth={1.8} /> : <CopyIcon size={12} />}
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
  /** Jump to a session/message from a session_search result chip. */
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
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
  onSessionJump,
}: ChatMessageProps) => {
  const assistantHtml = useMemo(
    () => (message.role === 'assistant'
      ? renderMdWithMentions(message.content, nodes)
      : ''),
    [message.role, message.content, nodes],
  );
  const userHtml = useMemo(
    () => (message.role === 'user'
      ? renderMdWithMentions(message.content, nodes)
      : ''),
    [message.role, message.content, nodes],
  );
  // Copy is offered for any settled message (user or assistant) with a body.
  const showCopyToolbar = !isStreaming && !!message.content;
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
    // Close the editor only when the rewind+resend actually went through —
    // otherwise (e.g. another turn is still streaming) the user's edited
    // text would be silently discarded.
    const ok = await onEditUserMessage(index, trimmed);
    if (ok !== false) setIsEditing(false);
  }, [editValue, index, onEditUserMessage]);

  const handleEditKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape/Enter during IME composition dismiss/confirm the candidate
    // text — cancelling the edit or saving there would eat CJK input.
    if (isImeComposing(event)) return;
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

  // Click-to-zoom: any image in this message (user attachments first, then
  // generated images) opens a shared fullscreen viewer at its position.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const generatedImages = useMemo(() => {
    if (message.role !== 'assistant' || !tools) return [];
    const out: Array<{ key: string; src: string; outputPath: string; title?: string }> = [];
    for (const tool of tools) {
      const image = parseGeneratedImage(tool.result);
      if (!image?.outputPath) continue;
      out.push({
        key: `generated-${tool.id}`,
        src: toFileUrl(image.outputPath),
        outputPath: image.outputPath,
        title: image.title,
      });
    }
    return out;
  }, [message.role, tools]);

  const attachmentCount = message.attachments?.length ?? 0;

  const lightboxImages = useMemo<LightboxImage[]>(() => [
    ...(message.attachments ?? []).map(attachment => ({
      src: toFileUrl(attachment.path),
      caption: attachment.fileName,
    })),
    ...generatedImages.map(image => ({ src: image.src, caption: image.title })),
  ], [message.attachments, generatedImages]);

  const handleImageKeyOpen = useCallback(
    (event: KeyboardEvent<HTMLImageElement>, openIndex: number) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setLightboxIndex(openIndex);
      }
    },
    [],
  );

  // After every (re-)render of a message body, render any pending mermaid
  // placeholders. Applies to both assistant output and pasted user content
  // (a user can paste a ```mermaid block too). We skip while streaming
  // because partial diagrams always fail to parse — they get picked up
  // once the stream completes.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isStreaming) return;
    renderMermaidIn(bodyRef.current);
  }, [assistantHtml, userHtml, isStreaming]);

  return (
    <div className={`chat-message chat-message-${message.role}`} id={anchorId}>
    {message.role === 'assistant' && (
      <div className="chat-message-avatar">
        <BotAvatarIcon size={20} />
      </div>
    )}
    <div className="chat-message-body">
      {message.attachments && message.attachments.length > 0 && (
        <div className="chat-message-images">
          {message.attachments.map((attachment, attachmentIndex) => (
            <figure key={attachment.id} className="chat-message-image-card">
              <img
                src={toFileUrl(attachment.path)}
                alt={attachment.fileName ?? 'image'}
                loading="lazy"
                decoding="async"
                className="chat-image-clickable"
                role="button"
                tabIndex={0}
                onClick={() => setLightboxIndex(attachmentIndex)}
                onKeyDown={(event) => handleImageKeyOpen(event, attachmentIndex)}
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
            onSessionJump={onSessionJump}
          />
          {generatedImages.length > 0 && (
            <div className="chat-generated-images">
              {generatedImages.map((image, generatedIndex) => {
                const openIndex = attachmentCount + generatedIndex;
                return (
                  <figure key={image.key} className="chat-generated-image-card">
                    <img
                      src={image.src}
                      alt={image.title ?? 'Generated image'}
                      className="chat-image-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxIndex(openIndex)}
                      onKeyDown={(event) => handleImageKeyOpen(event, openIndex)}
                    />
                    <figcaption>
                      <span>{image.title ?? 'Generated image'}</span>
                      <button
                        type="button"
                        onClick={() => void onAddImageToCanvas?.(image.outputPath, image.title)}
                      >
                        Add to canvas
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
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
              ref={bodyRef}
              className="chat-message-content chat-md chat-md--streaming"
              dangerouslySetInnerHTML={{ __html: assistantHtml }}
            />
          ) : (!tools || tools.length === 0) ? (
            <LoadingDots />
          ) : null
        ) : (
          <div
            ref={bodyRef}
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
        <div
          ref={bodyRef}
          className="chat-message-content chat-md"
          dangerouslySetInnerHTML={{ __html: userHtml }}
        />
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
    {lightboxIndex !== null && lightboxImages[lightboxIndex] && (
      <ChatImageLightbox
        images={lightboxImages}
        startIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    )}
  </div>
  );
};
