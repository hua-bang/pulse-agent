import type { CanvasNode } from '../../types';

export const NodeTypeBadge = ({ type }: { type: CanvasNode['type'] }) => (
  <span className={`node-type-badge node-type-badge--${type}`}>
    {type === 'file' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M3 3h10v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 7h5M5.5 9.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ) : type === 'terminal' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 7l2 1.5-2 1.5M8 10.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : type === 'frame' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
      </svg>
    ) : type === 'group' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" />
        <path d="M5 6h6M5 10h6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      </svg>
    ) : type === 'text' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M3 4h10M8 4v9M6 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ) : type === 'iframe' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    ) : type === 'reference' ? (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6.4 5.2l1.1-1.1a3 3 0 014.2 4.2l-1.2 1.2M9.6 10.8l-1.1 1.1a3 3 0 01-4.2-4.2l1.2-1.2M6.4 9.6l3.2-3.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    ) : (
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
    )}
  </span>
);
