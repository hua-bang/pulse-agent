import { useMemo, type ClipboardEventHandler, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';
import type { CanvasModelStatus, ChatImageAttachment } from '../../types';
import { ImageIcon, PlusIcon } from '../icons';
import { MentionNodeIcon } from './utils/mentions';
import { ModelSwitcher } from './ModelSettings';
import type { SelectedContextChip } from './types';
import { useI18n } from '../../i18n';
import { CHAT_MENTION_LISTBOX_ID, chatMentionOptionId } from './ChatMentionPopup';
import { ChatInputAttachments } from './ChatInputAttachments';
import { Button } from '../ui';

interface ChatInputProps {
  loading: boolean;
  input: string;
  selectedContext?: SelectedContextChip[];
  showContextChips?: boolean;
  onRemoveContext?: (key: string) => void;
  attachments?: ChatImageAttachment[];
  contextComposer?: boolean;
  knowledgeMode?: boolean;
  placeholder?: string;
  /** Blocks submitting the current draft, for example while a session opens. */
  sendDisabled?: boolean;
  /** Blocks controls that could mutate the conversation while a session opens. */
  interactionDisabled?: boolean;
  runInputDisabled?: boolean;
  modelStatus?: CanvasModelStatus;
  modelSelection?: { mode: 'auto' | 'model'; providerId?: string; modelId?: string };
  modelLabel?: string;
  onSelectModel?: (providerId: string, modelId: string) => Promise<void>;
  onOpenModelSettings?: () => void;
  editableRef: RefObject<HTMLDivElement>;
  mentionPopup?: ReactNode;
  mentionOpen?: boolean;
  mentionIndex?: number;
  onInput: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPaste: ClipboardEventHandler<HTMLDivElement>;
  onAttachFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  onSend: () => Promise<boolean>;
  onQueue?: () => Promise<boolean>;
  onSteer?: () => Promise<boolean>;
  onAbort: () => Promise<boolean>;
  /** Focus/navigate to a clicked mention chip's target (node or workspace). */
  onMentionNavigate?: (chip: HTMLElement) => void;
}

export const ChatInput = ({
  loading,
  input,
  selectedContext,
  showContextChips: showContextChipsProp = true,
  onRemoveContext,
  attachments = [],
  contextComposer = false,
  knowledgeMode = false,
  placeholder,
  sendDisabled = false,
  interactionDisabled = false,
  runInputDisabled = false,
  modelStatus,
  modelSelection = { mode: 'auto' },
  modelLabel,
  onSelectModel,
  onOpenModelSettings,
  editableRef,
  mentionPopup,
  mentionOpen = false,
  mentionIndex = 0,
  onInput,
  onKeyDown,
  onPaste,
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onSend,
  onQueue,
  onSteer,
  onAbort,
  onMentionNavigate,
}: ChatInputProps) => {
  const { t } = useI18n();
  const contextChips = (selectedContext && selectedContext.length > 0)
    ? selectedContext
    : [];
  const showContextChips = showContextChipsProp && contextComposer && contextChips.length > 0 && !loading;
  const readyAttachments = useMemo(
    () => attachments.filter(attachment => (attachment.status ?? 'ready') === 'ready' && attachment.path),
    [attachments],
  );
  const attachmentSendBlocked = attachments.some(
    attachment => attachment.status === 'uploading' || attachment.status === 'failed',
  );
  const hasSendableContent = Boolean(input.trim() || readyAttachments.length > 0);
  const canSend = hasSendableContent && !sendDisabled && !attachmentSendBlocked;
  return (
    <div className="chat-input-container">
      {mentionPopup}
      {contextComposer && loading && (
        <div className="chat-generating-status">{t('chat.generatingCanContinue')}</div>
      )}
      <div className={`chat-input-box${loading ? ' chat-input-box--generating' : ''}`}>
        {showContextChips && (
          <div className="chat-context-chips" aria-label={t('chat.currentContext')}>
            {contextChips.map(chip => (
              <span
                key={chip.key}
                className="chat-context-chip"
                data-context-kind={chip.kind}
                data-node-type={chip.nodeType}
              >
                <span className="chat-context-chip-icon">
                  {chip.kind === 'tag'
                    ? <span className="chat-context-chip-hash">#</span>
                    : <MentionNodeIcon nodeType={chip.kind === 'canvas' ? 'workspace' : (chip.nodeType ?? 'file')} size={13} />}
                </span>
                <span className="chat-context-chip-label">{chip.label}</span>
                {onRemoveContext && (
                  <button
                    type="button"
                    className="chat-context-chip-remove"
                    onClick={() => onRemoveContext(chip.key)}
                    disabled={interactionDisabled}
                    aria-label={t('chat.removeContext', { name: chip.label })}
                    title={t('chat.removeContext', { name: chip.label })}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <ChatInputAttachments
          attachments={attachments}
          readyAttachments={readyAttachments}
          interactionDisabled={interactionDisabled}
          onRemoveAttachment={onRemoveAttachment}
          onRetryAttachment={onRetryAttachment}
        />
        <div
          ref={editableRef}
          className="chat-input"
          contentEditable={!interactionDisabled}
          role="combobox"
          aria-disabled={interactionDisabled || undefined}
          aria-label={t('chat.messageInput')}
          aria-multiline="true"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={mentionOpen}
          aria-controls={mentionOpen ? CHAT_MENTION_LISTBOX_ID : undefined}
          aria-activedescendant={mentionOpen ? chatMentionOptionId(mentionIndex) : undefined}
          data-placeholder={placeholder ?? (knowledgeMode
            ? (contextChips.length === 1 && contextChips[0]?.kind === 'node'
              ? t('chat.askCurrentNode')
              : contextChips.length > 0
                ? t('chat.askKnowledgeScope')
                : t('chat.askKnowledge'))
            : contextComposer
              ? (contextChips.length > 0 ? t('chat.askSelectedNodes') : t('chat.askCanvas'))
            : (loading ? t('chat.generatingPlaceholder') : t('chat.askAnything')))}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onClick={(event) => {
            const chip = (event.target as HTMLElement).closest<HTMLElement>(
              '.chat-mention-chip--clickable',
            );
            if (chip) onMentionNavigate?.(chip);
          }}
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
                disabled={interactionDisabled}
                onClick={() => {
                  editableRef.current?.focus();
                  document.execCommand('insertText', false, '@');
                  onInput();
                }}
              >
                <PlusIcon size={18} strokeWidth={1.35} />
              </button>
              {onAttachFiles && <button
                type="button"
                className="chat-input-icon-btn"
                title={t('chat.addImage')}
                aria-label={t('chat.addImage')}
                disabled={interactionDisabled}
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
              </button>}
              </>
            ) : loading ? (
              <div className="chat-generating-indicator">
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <span className="chat-generating-label">{t('chat.generating')}</span>
              </div>
            ) : null}
          </div>
          <div className="chat-input-footer-right">
            {contextComposer && onSelectModel && onOpenModelSettings && (
              <ModelSwitcher
                status={modelStatus}
                selection={modelSelection}
                label={modelLabel ?? t('models.auto')}
                disabled={interactionDisabled || loading}
                onSelectModel={onSelectModel}
                onOpenSettings={onOpenModelSettings}
              />
            )}
            {loading ? (<>
              {onQueue && <Button
                variant="secondary"
                size="sm"
                onClick={() => void onQueue()}
                disabled={runInputDisabled || !canSend || attachments.length > 0}
                title={t('chat.queueMessage')}
                aria-label={t('chat.queueMessage')}
              >{t('chat.queue')}</Button>}
              {onSteer && <Button
                variant="primary"
                size="sm"
                onClick={() => void onSteer()}
                disabled={runInputDisabled || !canSend || attachments.length > 0}
                title={t('chat.steerCurrentResponse')}
                aria-label={t('chat.steerCurrentResponse')}
              >{t('chat.steer')}</Button>}
              <button
                className="chat-send-btn chat-send-btn--stop"
                onClick={async (event) => {
                  const trigger = event.currentTarget;
                  const stopped = await onAbort();
                  if (
                    stopped
                    && (document.activeElement === trigger || document.activeElement === document.body)
                  ) {
                    editableRef.current?.focus();
                  }
                }}
                title={t('chat.stopGenerating')}
                aria-label={t('chat.stopGenerating')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            </>) : (
              <button
                className={`chat-send-btn${canSend ? ' chat-send-btn--active' : ''}`}
                onClick={() => void onSend()}
                disabled={!canSend}
                title={t('chat.sendMessage')}
                aria-label={t('chat.sendMessage')}
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
