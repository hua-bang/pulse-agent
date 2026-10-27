import { LayersPanel } from '../LayersPanel';
import { LayerContextMenu } from '../LayerContextMenu';
import { useSidebarLayers } from '../useSidebarLayers';
import type { SidebarProps } from '../types';
import { requestCanvasSelection } from '../../../../shared/canvasSelection';

type Props = Pick<SidebarProps,
  'activeId' | 'activeNodes' | 'selectedNodeIds' | 'onNodeFocus' | 'onNodeRename' | 'onNodeDelete'
> & { visible: boolean; onCollapse: () => void };

export const LayerSection = ({
  visible,
  onCollapse,
  activeId,
  activeNodes = [],
  selectedNodeIds,
  onNodeFocus,
  onNodeRename,
  onNodeDelete,
}: Props) => {
  const layers = useSidebarLayers({ activeId, activeNodes, selectedNodeIds, onNodeRename, onNodeDelete });

  return (
    <>
      {visible && (
        <LayersPanel
          layerTree={layers.layerTree}
          frameIds={layers.frameIds}
          nodeCount={activeNodes.length}
          anyFrameExpanded={layers.anyFrameExpanded}
          collapsedLayers={layers.collapsedLayers}
          selectedNodeIds={layers.selectedLayerIds}
          primarySelectedNodeId={layers.primarySelectedNodeId}
          onNodeFocus={(nodeId, additive) => {
            if (!additive || !activeId) {
              onNodeFocus?.(nodeId);
              return;
            }
            const current = [...layers.selectedLayerIds];
            requestCanvasSelection(activeId, layers.selectedLayerIds.has(nodeId)
              ? current.filter((id) => id !== nodeId)
              : [...current, nodeId]);
          }}
          onLayerRename={layers.startLayerRename}
          onContextMenu={layers.handleLayerContextMenu}
          onToggleCollapse={layers.toggleLayerCollapse}
          onToggleAll={layers.toggleAllLayers}
          renamingLayerId={layers.renamingLayerId}
          renameLayerValue={layers.renameLayerValue}
          renameLayerInputRef={layers.renameLayerInputRef}
          onLayerRenameChange={layers.setRenameLayerValue}
          onLayerRenameCommit={layers.commitLayerRename}
          onLayerRenameCancel={() => layers.setRenamingLayerId(null)}
          onCollapse={onCollapse}
        />
      )}

      {layers.layerContextMenu && (
        <LayerContextMenu
          x={layers.layerContextMenu.x}
          y={layers.layerContextMenu.y}
          nodeId={layers.layerContextMenu.nodeId}
          onFocus={(nodeId) => onNodeFocus?.(nodeId)}
          onRename={(nodeId) => layers.startLayerRename(nodeId)}
          onDelete={(nodeId) => { void layers.handleLayerDelete(nodeId); }}
          onCopyLink={(nodeId) => { void layers.handleLayerCopyLink(nodeId); }}
          onClose={() => layers.setLayerContextMenu(null)}
        />
      )}
    </>
  );
};
