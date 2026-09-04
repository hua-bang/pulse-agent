import { useMemo } from 'react';
import { appendDomPickerBridge } from '../domPickerBridge';
import { IframeContent } from './IframeContent';
import { IframeToolbar } from './IframeToolbar';
import type { IframeRenderedViewProps } from './types';

export const IframeRenderedView = (props: IframeRenderedViewProps) => {
  const renderMode = props.mode === 'url' ? 'url' : 'html';
  const renderedHtml = props.isArtifactMode ? props.artifactHtml : props.html;
  const inspectableHtml = useMemo(
    () => renderMode === 'html' ? appendDomPickerBridge(renderedHtml) : renderedHtml,
    [renderMode, renderedHtml],
  );

  return (
    <div className="iframe-body">
      <IframeToolbar {...props} />
      <IframeContent
        view={{
          renderMode,
          mode: props.mode,
          url: props.url,
          title: props.title,
          faviconUrl: props.faviconUrl,
          streamingActive: props.streamingActive,
          isResizing: props.isResizing,
          isArtifactMode: props.isArtifactMode,
          artifact: props.artifact,
          inspectableHtml,
          localUrl: props.localUrl,
          nodeId: props.nodeId,
          shouldMountInlineFrame: props.shouldMountInlineFrame,
          webviewDiscarded: props.webviewDiscarded,
          discardSnapshot: props.discardSnapshot,
          loadState: props.loadState,
          loadError: props.loadError,
          webviewKey: props.webviewKey,
        }}
        refs={{
          frameHostRef: props.frameHostRef,
          renderIframeRef: props.renderIframeRef,
          streamIframeRef: props.streamIframeRef,
          webviewHostRef: props.webviewHostRef,
        }}
        actions={{
          reload: props.handleReload,
          openExternal: props.handleOpenExternal,
          wakeWebview: props.onWakeWebview,
        }}
      />
    </div>
  );
};
