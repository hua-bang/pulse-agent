import './index.css';
import './iframeBar.css';
import { useState } from 'react';
import { useAppShell } from '../AppShellProvider';
import { useRightDock } from '../RightDock';
import { IframeEditor } from './IframeEditor';
import { IframeRenderedView } from './IframeRenderedView';
import { IframeReviewLayer } from './IframeReviewLayer';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef } from '../../types';
import type { IframeNodeBodyProps } from './types';
import { useIframeNodeState } from './useIframeNodeState';

export const IframeNodeBody = ({
  node,
  workspaceId,
  onUpdate,
  isFullscreen,
  isSelected,
  isResizing,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  readOnly = false,
}: IframeNodeBodyProps) => {
  const { openArtifact } = useRightDock();
  const { notify } = useAppShell();
  const [domPickerActive, setDomPickerActive] = useState(false);
  const [reviewPickerActive, setReviewPickerActive] = useState(false);
  const [reviewComments, setReviewComments] = useState<AgentContextDomReviewComment[]>([]);
  const [draftSelection, setDraftSelection] = useState<AgentContextDomSelectionRef | null>(null);
  const [draftText, setDraftText] = useState('');
  const [reviewSending, setReviewSending] = useState(false);
  const state = useIframeNodeState({
    node,
    workspaceId,
    onUpdate,
    isFullscreen,
    isSelected,
    isResizing,
    readOnly,
  });

  const handlePickDomElement = async () => {
    if (!workspaceId) return;
    setDomPickerActive(true);
    try {
      const result = await state.pickDomElement();
      if (result.ok && result.selection) {
        onAddDomSelectionToChat?.({
          ...result.selection,
          workspaceId,
          nodeId: node.id,
          nodeTitle: node.title,
        });
        notify({
          tone: 'success',
          title: 'DOM selection added',
          description: result.selection.label,
          autoCloseMs: 1800,
        });
      } else if (!result.cancelled) {
        notify({
          tone: 'error',
          title: 'Could not select DOM',
          description: result.error ?? 'The page did not return a selected element.',
          autoCloseMs: 3600,
        });
      }
    } finally {
      setDomPickerActive(false);
    }
  };

  const handlePickReviewElement = async () => {
    if (!workspaceId || state.mode !== 'url' || readOnly) return;
    setReviewPickerActive(true);
    try {
      const result = await window.canvasWorkspace.iframe.pickDomElement(workspaceId, node.id);
      if (result.ok && result.selection) {
        setDraftSelection({
          ...result.selection,
          workspaceId,
          nodeId: node.id,
          nodeTitle: node.title,
        });
        setDraftText('');
      } else if (!result.cancelled) {
        notify({
          tone: 'error',
          title: 'Could not select DOM',
          description: result.error ?? 'The page did not return a selected element.',
          autoCloseMs: 3600,
        });
      }
    } finally {
      setReviewPickerActive(false);
    }
  };

  const handleSaveDraftReview = () => {
    if (!draftSelection || !draftText.trim()) return;
    setReviewComments((current) => [
      ...current,
      {
        id: `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        text: draftText.trim(),
        selection: draftSelection,
      },
    ]);
    setDraftSelection(null);
    setDraftText('');
  };

  const handleCancelDraftReview = () => {
    setDraftSelection(null);
    setDraftText('');
  };

  const handleSubmitReviews = async () => {
    const ready = reviewComments.filter((comment) => comment.text.trim());
    if (!ready.length || !onSubmitDomReviewComments) return;
    setReviewSending(true);
    try {
      const ok = await onSubmitDomReviewComments(ready);
      if (!ok) return;
      setReviewComments([]);
      setDraftSelection(null);
      setDraftText('');
      notify({
        tone: 'success',
        title: 'Review sent to Chat',
        description: `${ready.length} comment${ready.length === 1 ? '' : 's'} sent as one request.`,
        autoCloseMs: 1800,
      });
    } finally {
      setReviewSending(false);
    }
  };

  // Keep the rendered shell mounted while the residency manager may replace
  // its expensive guest. Opening the editor protects a live guest, so address
  // edits alone still do not trigger a reload.
  return (
    <div className="iframe-body-host">
      <IframeRenderedView
        artifact={state.artifact}
        artifactHtml={state.artifactHtml}
        artifactId={state.artifactId}
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        cancel={state.cancel}
        commit={state.commit}
        draftUrl={state.draftUrl}
        generating={state.generating}
        handleOpenExternal={state.handleOpenExternal}
        handleKeyDown={state.handleKeyDown}
        handlePickDomElement={handlePickDomElement}
        handlePickReviewElement={handlePickReviewElement}
        handleRegenerate={state.handleRegenerate}
        handleGoBack={state.handleGoBack}
        handleGoForward={state.handleGoForward}
        handleReload={state.handleReload}
        html={state.html}
        isArtifactMode={state.isArtifactMode}
        isResizing={isResizing}
        loadError={state.loadError}
        loadState={state.loadState}
        localUrl={state.localUrl}
        mode={state.mode}
        nodeId={node.id}
        openArtifact={openArtifact}
        domPickerActive={domPickerActive}
        reviewPickerActive={reviewPickerActive}
        readOnly={readOnly}
        savedPrompt={state.savedPrompt}
        setDraftUrl={state.setDraftUrl}
        setEditing={state.setEditing}
        renderIframeRef={state.renderIframeRef}
        streamIframeRef={state.streamIframeRef}
        streamingActive={state.streamingActive}
        url={state.url}
        webviewLifecycleState={state.webviewLifecycleState}
        webviewHostRef={state.webviewHostRef}
        webviewKey={state.webviewKey}
        wakeWebview={state.wakeWebview}
        workspaceId={workspaceId}
      />
      {(draftSelection || reviewComments.length > 0) && (
        <IframeReviewLayer
          comments={reviewComments}
          draftSelection={draftSelection}
          draftText={draftText}
          sending={reviewSending}
          onDraftTextChange={setDraftText}
          onSaveDraft={handleSaveDraftReview}
          onCancelDraft={handleCancelDraftReview}
          onUpdateComment={(id, text) => {
            setReviewComments((current) => current.map((comment) => (
              comment.id === id ? { ...comment, text } : comment
            )));
          }}
          onRemoveComment={(id) => {
            setReviewComments((current) => current.filter((comment) => comment.id !== id));
          }}
          onSubmit={() => void handleSubmitReviews()}
          onClear={() => {
            setReviewComments([]);
            handleCancelDraftReview();
          }}
        />
      )}
      {state.editing && (
        <IframeEditor
          cancel={state.cancel}
          canCancel={state.hasContent}
          commit={state.commit}
          draftHtml={state.draftHtml}
          draftMode={state.draftMode}
          draftPrompt={state.draftPrompt}
          draftUrl={state.draftUrl}
          genError={state.genError}
          generating={state.generating}
          handleGenerate={state.handleGenerate}
          handleKeyDown={state.handleKeyDown}
          handlePromptKeyDown={state.handlePromptKeyDown}
          handleTextareaKeyDown={state.handleTextareaKeyDown}
          inputRef={state.inputRef}
          openBlankPage={state.openBlankPage}
          promptRef={state.promptRef}
          setDraftHtml={state.setDraftHtml}
          setDraftMode={state.setDraftMode}
          setDraftPrompt={state.setDraftPrompt}
          setDraftUrl={state.setDraftUrl}
          textareaRef={state.textareaRef}
        />
      )}
    </div>
  );
};
