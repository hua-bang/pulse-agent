import type { CanvasNode } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';

export const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => (
  <div className="reference-empty">
    <div className="reference-empty-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path d="M6.6 6.2h4.8M6.6 8.7h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </div>
    <h3>No reference pinned</h3>
    <p>Pin nodes from the current workspace, another workspace, or a URL.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Use the current workspace picker for nearby nodes, or the other workspace picker for cross-canvas reuse.
      </div>
    )}
  </div>
);
