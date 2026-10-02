import './index.css';
import { useMemo } from 'react';
import type { CanvasNode, MindmapNodeData } from '../../../../types';
import { NodeTypeIcon } from '../../../../components/icons';
import { layoutMindmap } from '../../mindmap/layout';
import { MindmapNodeBody } from '../node-bodies/MindmapNodeBody';
import { TextNodeBodyLazy } from '../node-bodies/TextNodeBodyLazy';
import { ImageNodeBody } from '../node-bodies/ImageNodeBody';
import { ShapeNodeBody } from '../node-bodies/ShapeNodeBody';

interface Props {
  node: CanvasNode;
}

const noop = () => undefined;

export const CanvasApprovalNodePreview = ({ node }: Props) => {
  const preview = useMemo(() => {
    if (node.type !== 'mindmap') return node;
    const layout = layoutMindmap((node.data as MindmapNodeData).root);
    return { ...node, width: layout.width + 32, height: layout.height + 32 };
  }, [node]);

  return (
    <div className="canvas-approval-preview">
      <div className="canvas-approval-preview__title">
        <NodeTypeIcon type={node.type} size={16} />
        <span>{node.title}</span>
      </div>
      <div className="canvas-approval-preview__viewport" tabIndex={0}>
        <div style={{ width: preview.width, height: preview.height }}>
          {node.type === 'mindmap' && (
            <MindmapNodeBody
              node={preview}
              isSelected={false}
              onUpdate={noop}
              onSelectNode={noop}
              onAutoResize={noop}
              readOnly
            />
          )}
          {node.type === 'text' && (
            <TextNodeBodyLazy
              node={preview}
              isSelected={false}
              isResizing={false}
              onUpdate={noop}
              onSelect={noop}
              onDragStart={noop}
              readOnly
            />
          )}
          {node.type === 'image' && (
            <ImageNodeBody node={preview} isFullscreen={false} onSelect={noop} onDragStart={noop} readOnly />
          )}
          {node.type === 'shape' && (
            <ShapeNodeBody node={preview} isSelected={false} onSelect={noop} onDragStart={noop} onUpdate={noop} readOnly />
          )}
        </div>
      </div>
    </div>
  );
};
