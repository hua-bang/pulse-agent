import type { Dispatch, SetStateAction } from 'react';
import type { ToolCallStatus } from '../../../types';
import { ChatToolCalls } from './ChatToolCalls';
import { McpAppFramesLazy } from './McpAppFramesLazy';
import { CopyGeneratedImageButton } from './GeneratedImageActions';
import {
  ChatArtifactCard,
  ChatInlineVisual,
  parseVisualToolResult,
} from '../../artifacts';
import type { GeneratedChatImage } from './useChatMessageController';

interface Props {
  tools: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  loading: boolean;
  isStreaming: boolean;
  liveToolDetailsOpen: boolean;
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
  workspaceId: string;
  messageTimestamp: number;
  messageIndex: number;
  generatedImages: GeneratedChatImage[];
  attachmentCount: number;
  setLightboxIndex: Dispatch<SetStateAction<number | null>>;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
}

export const ChatMessageToolResults = ({
  tools,
  collapsed,
  expandedTools,
  loading,
  isStreaming,
  liveToolDetailsOpen,
  onToggleSection,
  onToggleToolExpand,
  onSessionJump,
  workspaceId,
  messageTimestamp,
  messageIndex,
  generatedImages,
  attachmentCount,
  setLightboxIndex,
  onAddImageToCanvas,
}: Props) => (
  <>
    <ChatToolCalls
      tools={tools}
      collapsed={collapsed}
      expandedTools={expandedTools}
      showSectionHeader={!loading}
      isStreaming={isStreaming}
      liveDetailsOpen={liveToolDetailsOpen}
      onToggleSection={onToggleSection}
      onToggleToolExpand={onToggleToolExpand}
      onSessionJump={onSessionJump}
    />
    <McpAppFramesLazy
      tools={tools}
      instanceScope={`${workspaceId}:${messageTimestamp}:${messageIndex}`}
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setLightboxIndex(openIndex);
                  }
                }}
              />
              <figcaption>
                <span>{image.title ?? 'Generated image'}</span>
                <span className="chat-generated-image-card__actions">
                  <CopyGeneratedImageButton imagePath={image.outputPath} />
                  <button
                    type="button"
                    className="chat-generated-image-card__action chat-generated-image-card__action--primary"
                    onClick={() => void onAddImageToCanvas?.(image.outputPath, image.title)}
                  >
                    Add to canvas
                  </button>
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    )}
    {tools.map(tool => {
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
      if ((tool.name === 'artifact_create' || tool.name === 'artifact_update') && !tool.result) return null;
      const visual = parseVisualToolResult(tool.name, tool.result);
      if (!visual) return null;
      return visual.kind === 'visual_render' ? (
        <ChatInlineVisual
          key={`visual-${tool.id}`}
          workspaceId={workspaceId}
          payload={visual.payload}
        />
      ) : (
        <ChatArtifactCard
          key={`artifact-${tool.id}`}
          workspaceId={workspaceId}
          payload={visual.payload}
        />
      );
    })}
  </>
);
