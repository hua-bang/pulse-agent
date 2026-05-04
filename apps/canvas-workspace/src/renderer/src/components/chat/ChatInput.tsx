import type { ClipboardEventHandler, KeyboardEventHandler, ReactNode, RefObject } from 'react';
import type { CanvasNode } from '../../types';
import { PlusIcon } from '../icons';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { MentionNodeIcon } from './utils/mentions';

interface ChatInputProps {
  loading: boolean;
  input: string;
  selectedNodes?: CanvasNode[];
  contextComposer?: boolean;
  editableRef: RefObject<HTMLDivElement>;
  mentionPopup?: ReactNode;
  onInput: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onPaste: ClipboardEventHandler<HTMLDivElement>;
  onSend: () => Promise<boolean>;
  onAbort: () => Promise<void>;
}

export const ChatInput = ({
  loading,
  input,
  selectedNodes,
  contextComposer = false,
  editableRef,
  mentionPopup,
  onInput,
  onKeyDown,
  onPaste,
  onSend,
  onAbort,
}: ChatInputProps) => {
  const contextNodes = (selectedNodes && selectedNodes.length > 0)
    ? selectedNodes
    : [];

  return (
    <div className="chat-input-container">
      {mentionPopup}
      {contextComposer && loading && (
        <div className="chat-generating-status" aria-live="polite">正在生成，可继续输入</div>
      )}
      <div className={`chat-input-box${loading ? ' chat-input-box--generating' : ''}`}>
        {contextComposer && contextNodes.length > 0 && (
          <div className="chat-context-chips" aria-label="当前上下文">
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
        <div
          ref={editableRef}
          className="chat-input"
          contentEditable={true}
          role="textbox"
          data-placeholder={contextComposer
            ? (contextNodes.length > 0 ? '问问这些节点…' : '问问当前画布…')
            : (loading ? 'Generating… you can type your next message' : 'Ask anything...')}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="chat-input-footer">
          <div className="chat-input-footer-left">
            {contextComposer ? (
              <button
                type="button"
                className="chat-input-icon-btn"
                title="添加上下文"
                aria-label="添加上下文"
                onClick={() => {
                  editableRef.current?.focus();
                  document.execCommand('insertText', false, '@');
                  onInput();
                }}
              >
                <PlusIcon size={18} strokeWidth={1.35} />
              </button>
            ) : loading ? (
              <div className="chat-generating-indicator" aria-live="polite">
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <div className="chat-loading-dot" />
                <span className="chat-generating-label">Generating…</span>
              </div>
            ) : null}
          </div>
          <div className="chat-input-footer-right">
            {contextComposer && (
              <span className="chat-auto-mode" title="Auto: 意图明确时可直接操作画布">Auto</span>
            )}
            {loading ? (
              <button
                className="chat-send-btn chat-send-btn--stop"
                onClick={() => void onAbort()}
                title="Stop generating"
                aria-label="Stop generating"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className={`chat-send-btn${input.trim() ? ' chat-send-btn--active' : ''}`}
                onClick={() => void onSend()}
                disabled={!input.trim()}
                title="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 12V4M8 4l-3.5 3.5M8 4l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
