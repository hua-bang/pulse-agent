import type { RefObject } from 'react';
import { useI18n } from '../../../../../i18n';
import type { EditMode } from './types';

interface IframeEditorProps {
  cancel: () => void;
  canCancel: boolean;
  commit: () => void;
  draftHtml: string;
  draftMode: EditMode;
  draftPrompt: string;
  draftUrl: string;
  genError: string | null;
  generating: boolean;
  handleGenerate: () => Promise<void> | void;
  handleKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  handlePromptKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  handleTextareaKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  inputRef: RefObject<HTMLInputElement>;
  openBlankPage: () => void;
  promptRef: RefObject<HTMLTextAreaElement>;
  setDraftHtml: (value: string) => void;
  setDraftMode: (mode: EditMode) => void;
  setDraftPrompt: (value: string) => void;
  setDraftUrl: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export const IframeEditor = ({
  cancel,
  canCancel,
  commit,
  draftHtml,
  draftMode,
  draftPrompt,
  draftUrl,
  genError,
  generating,
  handleGenerate,
  handleKeyDown,
  handlePromptKeyDown,
  handleTextareaKeyDown,
  inputRef,
  openBlankPage,
  promptRef,
  setDraftHtml,
  setDraftMode,
  setDraftPrompt,
  setDraftUrl,
  textareaRef,
}: IframeEditorProps) => {
  const { t } = useI18n();
  const canCommit =
    draftMode === 'url' ? !!draftUrl.trim()
      : draftMode === 'html' ? !!draftHtml.trim()
        : !!draftPrompt.trim();

  return (
    <div className="iframe-body iframe-body--empty">
      <div className="iframe-empty-inner">
        <div className="iframe-mode-tabs">
          <ModeTab active={draftMode === 'url'} onClick={() => setDraftMode('url')} disabled={generating}>
            URL
          </ModeTab>
          <ModeTab active={draftMode === 'html'} onClick={() => setDraftMode('html')} disabled={generating}>
            HTML
          </ModeTab>
          <ModeTab active={draftMode === 'ai'} onClick={() => setDraftMode('ai')} disabled={generating}>
            AI
          </ModeTab>
        </div>

        {draftMode === 'url' ? (
          <>
            <div className="iframe-empty-label">{t('iframe.editor.embedLabel')}</div>
            <input
              ref={inputRef}
              className="iframe-empty-input"
              type="url"
              value={draftUrl}
              placeholder="https://example.com"
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
            <button
              type="button"
              className="iframe-blank-btn"
              onClick={openBlankPage}
              disabled={generating}
            >
              {t('iframe.editor.blankPage')}
            </button>
          </>
        ) : draftMode === 'html' ? (
          <>
            <div className="iframe-empty-label">{t('iframe.editor.htmlLabel')}</div>
            <textarea
              ref={textareaRef}
              className="iframe-empty-textarea"
              value={draftHtml}
              placeholder={t('iframe.editor.htmlPlaceholder')}
              onChange={(e) => setDraftHtml(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              spellCheck={false}
            />
          </>
        ) : (
          <>
            <div className="iframe-empty-label">{t('iframe.editor.aiLabel')}</div>
            <textarea
              ref={promptRef}
              className="iframe-empty-textarea iframe-empty-textarea--prompt"
              value={draftPrompt}
              placeholder={t('iframe.editor.aiPlaceholder')}
              onChange={(e) => setDraftPrompt(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              spellCheck={false}
              disabled={generating}
            />
            {genError && <div className="iframe-gen-error">{genError}</div>}
          </>
        )}

        <div className="iframe-empty-actions">
          {canCancel && !generating && (
            <button className="iframe-empty-btn" onClick={cancel}>
              {t('iframe.editor.cancel')}
            </button>
          )}
          {draftMode === 'ai' ? (
            <button
              className="iframe-empty-btn iframe-empty-btn--primary iframe-empty-btn--ai"
              onClick={() => void handleGenerate()}
              disabled={!canCommit || generating}
            >
              {generating ? (
                <>
                  <span className="iframe-spinner" />
                  {t('iframe.editor.generating')}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5l1.85 4.15L14 7.5l-4.15 1.85L8 13.5l-1.85-4.15L2 7.5l4.15-1.85L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                  {t('iframe.editor.generate')}
                </>
              )}
            </button>
          ) : (
            <button
              className="iframe-empty-btn iframe-empty-btn--primary"
              onClick={commit}
              disabled={!canCommit}
            >
              {t(draftMode === 'url' ? 'iframe.editor.load' : 'iframe.editor.render')}
            </button>
          )}
        </div>

        <div className="iframe-empty-hint">
          {t(draftMode === 'url'
            ? 'iframe.editor.urlHint'
            : draftMode === 'html'
              ? 'iframe.editor.htmlHint'
              : 'iframe.editor.aiHint')}
        </div>
      </div>
    </div>
  );
};

const ModeTab = ({
  active,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    className={`iframe-mode-tab${active ? ' iframe-mode-tab--active' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);
