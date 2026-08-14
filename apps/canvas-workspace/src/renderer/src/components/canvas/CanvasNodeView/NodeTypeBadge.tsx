import type { CanvasNode } from '../../../types';
import { NodeTypeIcon } from '../../icons';

// Plugin-owned and shape nodes keep their bespoke fallback until their own
// icon contracts are promoted into the shared canvas icon family.
const LEGACY_BADGE_TYPES = new Set<CanvasNode['type']>(['shape', 'dynamic-app', 'plugin']);
const COLORIZED_BADGE_TYPES = new Set<CanvasNode['type']>(['iframe', 'text', 'image', 'mindmap']);

export const NodeTypeBadge = ({ type }: { type: CanvasNode['type'] }) => (
  <span className={`node-type-badge node-type-badge--${type}`}>
    {LEGACY_BADGE_TYPES.has(type) ? (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M9.2 2.2l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9L5.2 6.2l2.9-1.1 1.1-2.9z"
          fill="currentColor"
        />
        <path
          d="M4.3 9.8l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L2.3 11.8l1.4-.6.6-1.4z"
          fill="currentColor"
          opacity="0.55"
        />
      </svg>
    ) : (
      <NodeTypeIcon type={type} size={type === 'frame' ? 15 : 12} colorize={COLORIZED_BADGE_TYPES.has(type)} />
    )}
  </span>
);
