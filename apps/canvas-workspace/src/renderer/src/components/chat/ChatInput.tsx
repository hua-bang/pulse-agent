import type { ClipboardEventHandler, KeyboardEventHandler, ReactNode, RefObject } from 'react';
import type { CanvasModelStatus, CanvasNode, ChatImageAttachment } from '../../types';
import { ImageIcon, PlusIcon } from '../icons';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { toFileUrl } from '../../utils/fileUrl';
import { MentionNodeIcon } from './utils/mentions';
import { ModelSwitcher } from './ModelSettings';
import { useI18n } from '../../i18n';

interface ChatInputProps {
  loading: boolean;
  input: string;
  selectedNodes?: CanvasNode[];
  attachments?: ChatImageAttachment[];
  contextComposer?: boolean;
  executionMode?: 'auto' | 'ask';
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectAutoModel?: () => Promise<void>;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
  editableRef: RefObject<HTMLDivElement>;
  mentionPopup?: ReactNode;
  onInput: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPaste: ClipboardEventHandler<HTMLDivElement>;
  onAttachFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onSend: () => Promise<boolean>;
  onAbort: () => Promise<void>;
  onToggleExecutionMode?: () => void;
}

export const ChatInput = ({
  loading,
  input,
  selectedNodes,
  attachments = [],
  contextComposer = false,
  executionMode = 'auto',
  modelStatus,
  modelSelection = { mode: 'auto' },
  modelLabel = 'Auto',
  onSelectAutoModel,
  onSelectModel,
  onOpenModelSettings,
  editableRef,
  mentionPopup,
  onInput,
  onKeyDown,
  onPaste,
  onAttachFiles,
  onRemoveAttachment,
  onSend,
  onAbort,
  onToggleExecutionMode,
}: ChatInputProps) => {
  const { t } = useI18n();
  const contextNodes = (selectedNodes && selectedNodes.length > 0)
    ? selectedNodes
    : [];

  return (
    <div className="chat-input-container">
      {mentionPopup}
      {contextComposer && loading && (
        <div className="chat-generating-status" aria-live="polite">{t('chat.generatingCanContinue')}</div>
      )}
      <div className={`chat-input-box${loading ? ' chat-input-box--generating' : ''}`}>
        {contextComposer && contextNodes.length > 0 && (
          <div className="chat-context-chips" aria-label={t('chat.currentContext')}>
            {contextNodes.map(node => (
              <span key={node.id} className="chat-context-chip" data-node-type={node.type}>
                <span className="chat-context-chip-icon">
                  <MentionNodeIcon nodeType={node.type} size={13} />
                </span>
                <span className="chat-context-chip-label">{getNodeDisplayLabel(node)}</span>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="chat-attachment-strip" aria-label={t('chat.pendingImages')}>
            {attachments.map(attachment => (
              <div key={attachment.id} className="chat-attachment-chip">
                <img src={toFileUrl(attachment.path)} alt={attachment.fileName ?? t('chat.attachmentAlt')} />
                <span>{attachment.fileName ?? t('chat.imageFallback')}</span>
                <button type="button" onClick={() => onRemoveAttachment?.(attachment.id)} aria-label={t('chat.removeImage')}>×</button>
              </div>
            ))}
          </div>
        )}
        <div
          ref={editableRef}
          className="chat-input"
          contentEditable={true}
          role="textbox"
          data-placeholder={contextComposer
            ? (contextNodes.length > 0 ? t('chat.askSelectedNodes') : t('chat.askCanvas'))
            : (loading ? t('chat.generatingPlaceholder') : t('chat.askAnything'))}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="chat-input-footer">
          <div className="chat-input-footer-left">
            {contextComposer ? (
              <>
              <button
                type="button"
                className="chat-input-icon-btn"
                title={t('chat.addContext')}
                aria-label={t('chat.addContext')}
                onClick={() => {
                  editableRef.current?.focus();
                  document.execCommand('insertText', false, '@');
                  onInput();
                }}
              >
                <PlusIcon size={18} strokeWidth={1.35} />
              </button>
              <button
                type="button"
                className="chat-input-icon-btn"
                title={t('chat.addImage')}
                aria-label={t('chat.addImage')}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.multiple = true;
                  input.onchange = () => {
                    if (input.files) onAttachFiles?.(input.files);
                  };
                  input.click();
                }}
              >
                <ImageIcon size={18} strokeWidth={1.35} />
              </button>
              </>
            ) : loading ? (
              <div className="chat-generating-indicator" aria-live="polite">
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <span className="chat-generating-label">{t('chat.generating')}</span>
              </div>
            ) : null}
          </div>
          <div className="chat-input-footer-right">
            {contextComposer && onSelectAutoModel && onSelectModel && onOpenModelSettings && (
              <ModelSwitcher
                status={modelStatus}
                selection={modelSelection}
                label={modelLabel}
                onSelectAuto={onSelectAutoModel}
                onSelectModel={onSelectModel}
                onOpenSettings={onOpenModelSettings}
              />
            )}
            {/* Auto/Ask execution-mode toggle hidden — onToggleExecutionMode
                + executionMode state are still wired through so this can be
                re-enabled by uncommenting once the UX lands. */}
            {loading ? (
              <button
                className="chat-send-btn chat-send-btn--stop"
                onClick={() => void onAbort()}
                title={t('chat.stopGenerating')}
                aria-label={t('chat.stopGenerating')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className={`chat-send-btn${(input.trim() || attachments.length > 0) ? ' chat-send-btn--active' : ''}`}
                onClick={() => void onSend()}
                disabled={!input.trim() && attachments.length === 0}
                title={t('chat.sendMessage')}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13V4.5M8 4.5l-3.5 3.5M8 4.5l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
