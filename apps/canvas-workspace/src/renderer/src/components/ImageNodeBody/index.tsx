import { useCallback, useEffect, useState } from 'react';
import './index.css';
import type { CanvasNode, ImageNodeData } from '../../types';
import { toFileUrl } from '../../utils/fileUrl';

interface Props {
  node: CanvasNode;
  onSelect: (id: string) => void;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  readOnly?: boolean;
}

/**
 * Image node body. Renders the saved image from disk and makes the whole
 * surface a drag handle — the outer CanvasNodeView hides the header for
 * image nodes so there is no other grip to reach for.
 */
export const ImageNodeBody = ({ node, onSelect, onDragStart, readOnly = false }: Props) => {
  const data = node.data as ImageNodeData;
  const [loadFailed, setLoadFailed] = useState(false);

  // A new path gets a fresh chance — stale failure state would otherwise
  // keep showing the error after the file is fixed or replaced.
  useEffect(() => {
    setLoadFailed(false);
  }, [data.filePath]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) {
        e.stopPropagation();
        return;
      }
      onSelect(node.id);
      onDragStart(e, node);
    },
    [node, onSelect, onDragStart, readOnly],
  );

  return (
    <div className="image-node-body" onMouseDown={handleMouseDown}>
      {data.filePath && !loadFailed ? (
        <img
          className="image-node-img"
          src={toFileUrl(data.filePath)}
          alt={node.title}
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      ) : data.filePath ? (
        <div className="image-node-error" title={data.filePath}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2.5 13.5l4-4 3.5 3.5 3-3 4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M4 2l12 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>Image unavailable</span>
        </div>
      ) : (
        <div className="image-node-empty">No image</div>
      )}
    </div>
  );
};
