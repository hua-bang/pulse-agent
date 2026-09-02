import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import type { AgentChatMessage, CanvasNode, ToolCallStatus } from '../../../types';
import { toFileUrl } from '../../../utils/fileUrl';
import { useRoleColors, useRoleNameColors } from '../../../agent-chat/mentions/roleMentionItems';
import { renderMdWithMentions } from '../utils/mentions';
import { isImeComposing } from '../../../utils/ime';
import { renderMermaidIn } from '../../../utils/mermaid';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import { parseGeneratedImage } from './GeneratedImageActions';
import type { LightboxImage } from '../ChatImageLightbox';
import { useI18n } from '../../../i18n';

interface Options {
  message: AgentChatMessage;
  index: number;
  isStreaming: boolean;
  loading: boolean;
  tools?: ToolCallStatus[];
  nodes?: CanvasNode[];
  rootFolder?: string;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
}

export interface GeneratedChatImage {
  key: string;
  src: string;
  outputPath: string;
  title?: string;
}

export const useChatMessageController = ({
  message,
  index,
  isStreaming,
  loading,
  tools,
  nodes,
  rootFolder,
  onEditUserMessage,
  onRegenerate,
}: Options) => {
  const { t } = useI18n();
  const roleColors = useRoleColors();
  const roleNames = useRoleNameColors();
  const assistantHtml = useMemo(
    () => (message.role === 'assistant'
      ? renderMdWithMentions(message.content, nodes, { streaming: isStreaming, rootFolder, roleColors, roleNames })
      : ''),
    [message.role, message.content, nodes, isStreaming, rootFolder, roleColors, roleNames],
  );
  const userHtml = useMemo(
    () => (message.role === 'user'
      ? renderMdWithMentions(message.content, nodes, { rootFolder, roleColors })
      : ''),
    [message.role, message.content, nodes, rootFolder, roleColors],
  );
  const showCopyToolbar = !isStreaming && !!message.content;
  const relativeTime = formatRelativeTime(message.timestamp);
  const absoluteTime = formatAbsoluteTime(message.timestamp);
  const speakerLabel = message.speakerRoleName
    ?? (message.role === 'assistant' ? t('chat.assistantSpeaker') : t('chat.userSpeaker'));
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [liveToolDetailsOpen, setLiveToolDetailsOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const canEdit = message.role === 'user' && !!onEditUserMessage && !loading && !isStreaming;
  const canRegenerate = message.role === 'assistant'
    && !!onRegenerate
    && !loading
    && !isStreaming
    && !message.turnStatus;
  const canRecoverTurn = !!onRegenerate && !loading && !isStreaming;

  const handleStartEdit = useCallback(() => {
    setEditValue(message.content);
    setIsEditing(true);
  }, [message.content]);
  const handleCancelEdit = useCallback(() => setIsEditing(false), []);
  const handleSaveEdit = useCallback(async () => {
    if (!onEditUserMessage) return;
    const trimmed = editValue.trim();
    if (!trimmed) return;
    const accepted = await onEditUserMessage(index, trimmed);
    if (accepted !== false) setIsEditing(false);
  }, [editValue, index, onEditUserMessage]);
  const handleEditKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSaveEdit();
    }
  }, [handleCancelEdit, handleSaveEdit]);
  const handleRegenerate = useCallback(() => {
    if (onRegenerate) void onRegenerate(index);
  }, [index, onRegenerate]);
  const handleImageError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.closest('.chat-message-image-card')?.classList.add('chat-message-image-card--broken');
  }, []);
  const generatedImages = useMemo<GeneratedChatImage[]>(() => {
    if (message.role !== 'assistant' || !tools) return [];
    return tools.flatMap(tool => {
      const image = parseGeneratedImage(tool.result);
      return image?.outputPath ? [{
        key: `generated-${tool.id}`,
        src: toFileUrl(image.outputPath),
        outputPath: image.outputPath,
        title: image.title,
      }] : [];
    });
  }, [message.role, tools]);
  const attachmentCount = message.attachments?.length ?? 0;
  const lightboxImages = useMemo<LightboxImage[]>(() => [
    ...(message.attachments ?? []).map(attachment => ({
      src: toFileUrl(attachment.path),
      filePath: attachment.path,
      caption: attachment.fileName,
    })),
    ...generatedImages.map(image => ({
      src: image.src,
      filePath: image.outputPath,
      caption: image.title,
    })),
  ], [message.attachments, generatedImages]);
  const handleImageKeyOpen = useCallback((event: KeyboardEvent<HTMLImageElement>, openIndex: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setLightboxIndex(openIndex);
  }, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isStreaming) renderMermaidIn(bodyRef.current);
  }, [assistantHtml, userHtml, isStreaming]);

  return {
    absoluteTime,
    assistantHtml,
    attachmentCount,
    bodyRef,
    canEdit,
    canRecoverTurn,
    canRegenerate,
    editValue,
    generatedImages,
    handleCancelEdit,
    handleEditKeyDown,
    handleImageError,
    handleImageKeyOpen,
    handleRegenerate,
    handleSaveEdit,
    handleStartEdit,
    isEditing,
    lightboxImages,
    lightboxIndex,
    liveToolDetailsOpen,
    relativeTime,
    setEditValue,
    setLightboxIndex,
    setLiveToolDetailsOpen,
    showCopyToolbar,
    speakerLabel,
    userHtml,
  };
};
