import type { AgentChatMessage, CanvasNode } from '../../types';
import { AvatarIcon } from '../icons';
import type { ToolCallStatus } from './types';
import { renderMdWithMentions, renderUserContent } from './utils/mentions';
import { ChatToolCalls } from './ChatToolCalls';
import {
  ChatArtifactCard,
  ChatInlineVisual,
  parseVisualToolResult,
} from '../artifacts';

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
}: ChatMessageProps) => (
  <div className={`chat-message chat-message-${message.role}`}>
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
              <img src={`file://${attachment.path}`} alt={attachment.fileName ?? 'image'} />
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
                  <img src={`file://${image.outputPath}`} alt={image.title ?? 'Generated image'} />
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
              className="chat-message-content chat-md chat-md--streaming"
              dangerouslySetInnerHTML={{ __html: renderMdWithMentions(message.content, nodes) }}
            />
          ) : (!tools || tools.length === 0) ? (
            <LoadingDots />
          ) : null
        ) : (
          <div
            className="chat-message-content chat-md"
            dangerouslySetInnerHTML={{ __html: renderMdWithMentions(message.content, nodes) }}
          />
        )
      ) : (
        <div className="chat-message-content">{renderUserContent(message.content, nodes)}</div>
      )}
    </div>
  </div>
);
