import './index.css';
import { useArtifactDrawer } from '../artifacts';
import { IframeEditor } from './IframeEditor';
import { IframeRenderedView } from './IframeRenderedView';
import type { IframeNodeBodyProps } from './types';
import { useIframeNodeState } from './useIframeNodeState';

export const IframeNodeBody = ({
  node,
  workspaceId,
  onUpdate,
  isResizing,
  readOnly = false,
}: IframeNodeBodyProps) => {
  const { openArtifact } = useArtifactDrawer();
  const state = useIframeNodeState({
    node,
    workspaceId,
    onUpdate,
    isResizing,
    readOnly,
  });

  if (state.editing) {
    return (
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
    );
  }

  return (
    <IframeRenderedView
      artifact={state.artifact}
      artifactHtml={state.artifactHtml}
      artifactId={state.artifactId}
      generating={state.generating}
      handleOpenExternal={state.handleOpenExternal}
      handleRegenerate={state.handleRegenerate}
      handleReload={state.handleReload}
      html={state.html}
      isArtifactMode={state.isArtifactMode}
      isResizing={isResizing}
      loadError={state.loadError}
      loadState={state.loadState}
      mode={state.mode}
      openArtifact={openArtifact}
      readOnly={readOnly}
      savedPrompt={state.savedPrompt}
      setEditing={state.setEditing}
      streamIframeRef={state.streamIframeRef}
      streamingActive={state.streamingActive}
      url={state.url}
      webviewHostRef={state.webviewHostRef}
      webviewKey={state.webviewKey}
      workspaceId={workspaceId}
    />
  );
};
