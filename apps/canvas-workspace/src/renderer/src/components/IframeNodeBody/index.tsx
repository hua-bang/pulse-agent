import './index.css';
import './iframeBar.css';
import { useState } from 'react';
import { useAppShell } from '../AppShellProvider';
import { useRightDock } from '../RightDock';
import { IframeEditor } from './IframeEditor';
import { IframeRenderedView } from './IframeRenderedView';
import type { IframeNodeBodyProps } from './types';
import { useIframeNodeState } from './useIframeNodeState';

export const IframeNodeBody = ({
  node,
  workspaceId,
  onUpdate,
  isResizing,
  onAddDomSelectionToChat,
  readOnly = false,
}: IframeNodeBodyProps) => {
  const { openArtifact } = useRightDock();
  const { notify } = useAppShell();
  const [domPickerActive, setDomPickerActive] = useState(false);
  const state = useIframeNodeState({
    node,
    workspaceId,
    onUpdate,
    isResizing,
    readOnly,
  });

  const handlePickDomElement = async () => {
    if (!workspaceId || state.mode !== 'url') return;
    setDomPickerActive(true);
    try {
      const result = await window.canvasWorkspace.iframe.pickDomElement(workspaceId, node.id);
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

  // Keep the rendered view (and therefore the <webview>) mounted at all times;
  // toggle the editor as an overlay so the guest WebContents survives URL
  // edits and never reloads just because the user opened the address bar.
  return (
    <div className="iframe-body-host">
      <IframeRenderedView
        artifact={state.artifact}
        artifactHtml={state.artifactHtml}
        artifactId={state.artifactId}
        cancel={state.cancel}
        commit={state.commit}
        draftUrl={state.draftUrl}
        generating={state.generating}
        handleOpenExternal={state.handleOpenExternal}
        handleKeyDown={state.handleKeyDown}
        handlePickDomElement={handlePickDomElement}
        handleRegenerate={state.handleRegenerate}
        handleReload={state.handleReload}
        html={state.html}
        isArtifactMode={state.isArtifactMode}
        isResizing={isResizing}
        loadError={state.loadError}
        loadState={state.loadState}
        mode={state.mode}
        openArtifact={openArtifact}
        domPickerActive={domPickerActive}
        readOnly={readOnly}
        savedPrompt={state.savedPrompt}
        setDraftUrl={state.setDraftUrl}
        setEditing={state.setEditing}
        streamIframeRef={state.streamIframeRef}
        streamingActive={state.streamingActive}
        url={state.url}
        webviewHostRef={state.webviewHostRef}
        webviewKey={state.webviewKey}
        workspaceId={workspaceId}
      />
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
