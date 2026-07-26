import { memo } from 'react';
import './index.css';
import './interaction-polish.css';
import { DefaultCanvasNode } from './DefaultCanvasNode';
import { FullscreenButton } from './NodeButtons';
import { ImageCanvasNode } from './ImageCanvasNode';
import { MindmapCanvasNode } from './MindmapCanvasNode';
import { ReferenceCanvasNode } from './ReferenceCanvasNode';
import { ReferenceSourcePreview } from './ReferenceSourcePreview';
import { ShapeCanvasNode } from './ShapeCanvasNode';
import type { CanvasNodeViewProps } from './types';
import { useCanvasNodeViewModel } from './useCanvasNodeViewModel';

const CanvasNodeViewComponent = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  workspaceName,
  isDragging,
  dragOffset,
  isResizing,
  isSelected,
  isHighlighted,
  isAgentEdited,
  focusState = 'neutral',
  focusAction,
  onDragStart,
  onResizeStart,
  onUpdate,
  onAutoResize,
  onRemove,
  onRemoveNodes,
  onExportMindmapImage,
  onMergeMindmapTopic,
  onSplitMindmapTopic,
  onSelect,
  onFocus,
  onReference,
  onAddToChat,
  onAddToCanvas,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  resolveReferenceNode,
  onOpenReferenceSource,
  onUpdateReferenceSource,
  onUngroupSelectedGroups,
  isFullscreen = false,
  onToggleFullscreen,
  readOnly = false,
  renderFullFileBody = false,
  embedded = false,
  hideHeader = false,
  renderMode = 'full',
}: CanvasNodeViewProps) => {
  const viewModel = useCanvasNodeViewModel({
    embedded,
    focusState,
    getAllNodes,
    isAgentEdited,
    isDragging,
    dragOffset,
    isFullscreen,
    isHighlighted,
    isResizing,
    isSelected,
    node,
    onDragStart,
    onFocus,
    onOpenReferenceSource,
    onReference,
    onAddToChat,
    onAddToCanvas,
    onRemove,
    onResizeStart,
    onSelect,
    onToggleFullscreen,
    onUngroupSelectedGroups,
    onUpdate,
    onUpdateReferenceSource,
    readOnly,
  });
  const fullscreenButton = viewModel.fullscreenButtonEnabled ? (
    <FullscreenButton isFullscreen={isFullscreen} onClick={viewModel.handleToggleFullscreen} />
  ) : null;

  if (node.type === 'image') {
    return (
      <ImageCanvasNode
        classes={viewModel.classes}
        handleClose={viewModel.handleClose}
        handleNodeClick={viewModel.handleNodeClick}
        handleToggleFullscreen={viewModel.handleToggleFullscreen}
        isFullscreen={isFullscreen}
        makeResizeHandler={viewModel.makeResizeHandler}
        node={node}
        onDragStart={onDragStart}
        onSelect={onSelect}
        readOnly={readOnly}
        supportsFullscreen={viewModel.fullscreenButtonEnabled}
        wrapperStyle={viewModel.wrapperStyle}
      />
    );
  }

  if (node.type === 'shape') {
    return (
      <ShapeCanvasNode
        classes={viewModel.classes}
        handleClose={viewModel.handleClose}
        handleNodeClick={viewModel.handleNodeClick}
        isSelected={isSelected}
        makeResizeHandler={viewModel.makeResizeHandler}
        node={node}
        onDragStart={onDragStart}
        onSelect={onSelect}
        onUpdate={onUpdate}
        readOnly={readOnly}
        wrapperStyle={viewModel.wrapperStyle}
      />
    );
  }

  if (node.type === 'reference') {
    return (
      <ReferenceCanvasNode
        classes={viewModel.classes}
        handleClose={viewModel.handleClose}
        handleHeaderMouseDown={viewModel.handleHeaderMouseDown}
        handleNodeBodyMouseDown={viewModel.handleNodeBodyMouseDown}
        handleNodeClick={viewModel.handleNodeClick}
        handleOpenReferenceSource={viewModel.handleOpenReferenceSource}
        handleTitleBlur={viewModel.handleTitleBlur}
        handleTitleDoubleClick={viewModel.handleTitleDoubleClick}
        handleTitleKeyDown={viewModel.handleTitleKeyDown}
        isEditingTitle={viewModel.isEditingTitle}
        isFullscreen={isFullscreen}
        isSelected={isSelected}
        makeResizeHandler={viewModel.makeResizeHandler}
        node={node}
        readOnly={readOnly}
        resolved={resolveReferenceNode?.(node)}
        titleRef={viewModel.titleRef}
        wrapperStyle={viewModel.wrapperStyle}
        renderReferenceSource={(sourceNode, workspaceLabel) => (
          <ReferenceSourcePreview
            CanvasNodeViewComponent={CanvasNodeView}
            embedded={embedded}
            handleReferenceSourceUpdate={viewModel.handleReferenceSourceUpdate}
            isSelected={isSelected}
            node={node}
            onSelect={onSelect}
            onUpdateReferenceSource={onUpdateReferenceSource}
            readOnly={readOnly}
            rootFolder={rootFolder}
            sourceNode={sourceNode}
            workspaceId={workspaceId}
            workspaceLabel={workspaceLabel}
          />
        )}
      />
    );
  }

  if (node.type === 'mindmap') {
    return (
      <MindmapCanvasNode
        classes={viewModel.classes}
        handleClose={viewModel.handleClose}
        handleNodeClick={viewModel.handleNodeClick}
        handleToggleFullscreen={viewModel.handleToggleFullscreen}
        isDragging={isDragging}
        isFullscreen={isFullscreen}
        isSelected={isSelected}
        node={node}
        onAutoResize={onAutoResize}
        onDragStart={onDragStart}
        onExportMindmapImage={onExportMindmapImage}
        onMergeMindmapTopic={onMergeMindmapTopic}
        onSplitMindmapTopic={onSplitMindmapTopic}
        onSelect={onSelect}
        onUpdate={onUpdate}
        readOnly={readOnly}
        supportsFullscreen={viewModel.fullscreenButtonEnabled}
        wrapperStyle={viewModel.wrapperStyle}
      />
    );
  }

  return (
    <DefaultCanvasNode
      classes={viewModel.classes}
      fullscreenButton={fullscreenButton}
      focusAction={focusAction}
      getAllNodes={getAllNodes}
      containerDescendantCount={viewModel.containerDescendantCount}
      handleClose={viewModel.handleClose}
      handleFocus={viewModel.handleFocus}
      handleHeaderMouseDown={viewModel.handleHeaderMouseDown}
      handleNodeBodyMouseDown={viewModel.handleNodeBodyMouseDown}
      handleNodeClick={viewModel.handleNodeClick}
      handleAddToChat={viewModel.handleAddToChat}
      handleAddToCanvas={viewModel.handleAddToCanvas}
      handleTitleBlur={viewModel.handleTitleBlur}
      handleTitleDoubleClick={viewModel.handleTitleDoubleClick}
      handleTitleKeyDown={viewModel.handleTitleKeyDown}
      handleTitlePaste={viewModel.handleTitlePaste}
      handleUngroup={viewModel.handleUngroup}
      hideHeader={hideHeader}
      isEditingTitle={viewModel.isEditingTitle}
      isFullscreen={isFullscreen}
      isResizing={isResizing}
      isSelected={isSelected}
      makeResizeHandler={viewModel.makeResizeHandler}
      node={node}
      onDragStart={onDragStart}
      onAddToChat={onAddToChat}
      onAddToCanvas={onAddToCanvas}
      onAddDomSelectionToChat={onAddDomSelectionToChat}
      onSubmitDomReviewComments={onSubmitDomReviewComments}
      onSelect={onSelect}
      onRemoveNodes={onRemoveNodes}
      onUngroupSelectedGroups={onUngroupSelectedGroups}
      onUpdate={onUpdate}
      readOnly={readOnly}
      renderFullFileBody={renderFullFileBody}
      renderMode={renderMode}
      relativeTime={viewModel.relativeTime}
      rootFolder={rootFolder}
      titleRef={viewModel.titleRef}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      wrapperStyle={viewModel.wrapperStyle}
    />
  );
};

export const CanvasNodeView = memo(CanvasNodeViewComponent, (prev, next) => (
  prev.node === next.node &&
  prev.rootFolder === next.rootFolder &&
  prev.workspaceId === next.workspaceId &&
  prev.workspaceName === next.workspaceName &&
  prev.getAllNodes === next.getAllNodes &&
  prev.isDragging === next.isDragging &&
  prev.dragOffset === next.dragOffset &&
  prev.isResizing === next.isResizing &&
  prev.isSelected === next.isSelected &&
  prev.isHighlighted === next.isHighlighted &&
  prev.isAgentEdited === next.isAgentEdited &&
  prev.focusState === next.focusState &&
  prev.focusAction === next.focusAction &&
  prev.isFullscreen === next.isFullscreen &&
  prev.onToggleFullscreen === next.onToggleFullscreen &&
  prev.resolveReferenceNode === next.resolveReferenceNode &&
  prev.onOpenReferenceSource === next.onOpenReferenceSource &&
  prev.onUpdateReferenceSource === next.onUpdateReferenceSource &&
  prev.onAddDomSelectionToChat === next.onAddDomSelectionToChat &&
  prev.onSubmitDomReviewComments === next.onSubmitDomReviewComments &&
  prev.onRemoveNodes === next.onRemoveNodes &&
  prev.onMergeMindmapTopic === next.onMergeMindmapTopic &&
  prev.onSplitMindmapTopic === next.onSplitMindmapTopic &&
  prev.readOnly === next.readOnly &&
  prev.renderFullFileBody === next.renderFullFileBody &&
  prev.embedded === next.embedded &&
  prev.hideHeader === next.hideHeader &&
  prev.renderMode === next.renderMode
));
