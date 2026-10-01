import { useCallback } from 'react';
import type { CanvasNode } from '../../../../types';
import { MindmapNodeBody, TextNodeBodyLazy } from '../../../canvas/node-bodies';
import { MarkdownPreview } from '../../../chat/markdown';
import { useI18n } from '../../../../i18n';

interface Props {
  node: CanvasNode;
  editable: boolean;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
}

const noop = () => undefined;

/**
 * One canvas node rendered with the app's own node body, inside the same
 * `canvas-node` chrome classes the canvas uses, so it looks and edits the
 * way it does in Pulse Canvas.
 */
export const NodeCard = ({ node, editable, onUpdate }: Props) => {
  const { t } = useI18n();
  const onAutoResize = useCallback((id: string, width: number, height: number) => {
    onUpdate(id, { width, height });
  }, [onUpdate]);

  if (node.type === 'mindmap') {
    return (
      <div
        className="canvas-node canvas-node--mindmap canvas-node--embedded"
        style={{ width: node.width, height: node.height }}
      >
        <div className="node-body node-body--mindmap">
          <MindmapNodeBody
            node={node}
            isSelected
            onUpdate={onUpdate}
            onSelectNode={noop}
            onAutoResize={onAutoResize}
            readOnly={!editable}
          />
        </div>
      </div>
    );
  }

  if (node.type === 'text') {
    const autoSize = (node.data as { autoSize?: boolean }).autoSize !== false;
    return (
      <div
        className={`canvas-node canvas-node--text canvas-node--embedded${autoSize ? ' canvas-node--text-auto' : ''}`}
        style={autoSize ? undefined : { width: node.width, height: node.height }}
      >
        <div className="node-body">
          <TextNodeBodyLazy
            node={node}
            onUpdate={onUpdate}
            isSelected
            isResizing={false}
            onSelect={noop}
            onDragStart={noop}
            readOnly={!editable}
          />
        </div>
      </div>
    );
  }

  if (node.type === 'file') {
    const content = (node.data as { content?: string }).content ?? '';
    return (
      <div className="node-view-file">
        {content.trim()
          ? <MarkdownPreview content={content} />
          : <p className="node-view-muted">{t('mcpNodeView.emptyNote')}</p>}
      </div>
    );
  }

  return (
    <div className="node-view-unsupported">
      <p>{t('mcpNodeView.unsupported', { type: node.type })}</p>
    </div>
  );
};
