import { createElement } from 'react';

export function mentionIconSvg(nodeType: string): string {
  switch (nodeType) {
    case 'terminal':
      return '<rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 6l2 1.5L4 9" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>';
    case 'agent':
      return '<circle cx="7" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 12c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
    case 'frame':
      return '<rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/>';
    case 'group':
      return '<rect x="2" y="2.5" width="10" height="9" rx="1.8" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/><path d="M4.5 5.5h5M4.5 8.5h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'text':
      return '<path d="M3 3.5h8M7 3.5v7M5.5 10.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
    case 'iframe':
      return '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M2 7h10M7 2c1.7 1.7 1.7 8.3 0 10M7 2c-1.7 1.7-1.7 8.3 0 10" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'mindmap':
      return '<circle cx="3.5" cy="7" r="1.2" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="3.5" r="1.1" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="7" r="1.1" stroke="currentColor" stroke-width="1.1"/><circle cx="10.5" cy="10.5" r="1.1" stroke="currentColor" stroke-width="1.1"/><path d="M4.7 7L9.4 3.7M4.7 7H9.4M4.7 7L9.4 10.3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'workspace':
      return '<rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><rect x="3.5" y="3.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/><rect x="7.5" y="3.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/><rect x="3.5" y="7.5" width="3" height="3" rx="0.5" stroke="currentColor" stroke-width="1"/>';
    case 'skill':
      return '<path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.5.7 3.6L7 9.8l-3.3 1.7.7-3.6L1.7 5.4l3.7-.5L7 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>';
    case 'folder':
      return '<path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.2 1.5h4.3a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
    case 'session':
      return '<path d="M2.5 3h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.8L4 12.2V10H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.8h5M4.5 7.8h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
    case 'dom':
      return '<rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 5.2L2.8 7l1.4 1.8M9.8 5.2L11.2 7 9.8 8.8M6.2 10.2L7.8 3.8" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>';
    default:
      return '<rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 5h5M4.5 7.5h3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>';
  }
}

export function MentionNodeIcon({ nodeType, size = 12 }: { nodeType: string; size?: number }) {
  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    dangerouslySetInnerHTML: { __html: mentionIconSvg(nodeType) },
  });
}
