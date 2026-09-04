import type { CanvasNode } from '../../types';
import type { IconProps } from './types';

export const CodingAgentIcon = ({ size = 18, className, strokeWidth = 1.35, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" className={className} style={style}>
    <path
      d="M6.5 5L3 9l3.5 4M11.5 5L15 9l-3.5 4M9.8 4.5l-1.6 9"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ImageIcon = ({ size = 16, className, strokeWidth = 1.3, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
    <rect
      x="2.5"
      y="3"
      width="11"
      height="10"
      rx="2"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    />
    <circle cx="6" cy="6.2" r="1.1" stroke="currentColor" strokeWidth="1.15" />
    <path
      d="M3.2 11.3L6.1 8.6a1 1 0 011.35-.02l1.1 1 1.45-1.45a1 1 0 011.42.02l1.38 1.45"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ReferenceLinkIcon = ({ size = 16, className, strokeWidth = 1.35, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
    <path
      d="M6.4 5.2l1.1-1.1a3 3 0 014.2 4.2l-1.2 1.2M9.6 10.8l-1.1 1.1a3 3 0 01-4.2-4.2l1.2-1.2M6.4 9.6l3.2-3.2"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  </svg>
);

interface NodeTypeIconProps {
  type: CanvasNode['type'];
  size?: number;
  className?: string;
  /** Apply the node accent outside the monochrome FloatingToolbar. */
  colorize?: boolean;
}

const NODE_TYPE_ACCENTS: Record<CanvasNode['type'], string> = {
  file: 'var(--accent-file)',
  terminal: 'var(--accent-term)',
  frame: 'var(--accent-frame)',
  group: 'var(--group-color, var(--accent-frame))',
  agent: 'var(--accent)',
  text: 'var(--accent-text)',
  iframe: 'var(--accent)',
  image: 'var(--accent-image)',
  shape: 'var(--accent)',
  mindmap: 'var(--accent-mindmap)',
  reference: 'var(--accent)',
  'dynamic-app': 'var(--accent)',
  plugin: 'var(--accent)',
};

/** Canonical node glyphs. The default is monochrome; surfaces opt into color. */
export const NodeTypeIcon = ({ type, size = 14, className, colorize = false }: NodeTypeIconProps) => {
  const iconClassName = [
    'canvas-node-icon',
    colorize ? 'canvas-node-icon--colorized' : '',
    colorize ? `canvas-node-icon--${type}` : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  const style = colorize ? { color: NODE_TYPE_ACCENTS[type] } : undefined;
  const props18 = { width: size, height: size, viewBox: '0 0 18 18', fill: 'none', className: iconClassName, style };
  const props16 = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', className: iconClassName, style };

  switch (type) {
    case 'file':
      return (
        <svg {...props18}>
          <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 9h4M9 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...props18}>
          <rect x="2.5" y="3" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.5 8l2 1.5-2 1.5M9 11h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'frame':
      return (
        <svg {...props18}>
          <rect x="2" y="2" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
          <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
        </svg>
      );
    case 'group':
      return <svg {...props16}><rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 2" /><path d="M5 6h6M5 10h6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></svg>;
    case 'agent':
      return <CodingAgentIcon size={size} className={iconClassName} strokeWidth={1.25} style={style} />;
    case 'text':
      return (
        <svg {...props18}>
          <path d="M4 5h10M9 5v9M7 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'iframe':
      return (
        <svg {...props18}>
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 9h13M9 2.5c2.2 2.2 2.2 10.8 0 13M9 2.5c-2.2 2.2-2.2 10.8 0 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'image':
      return <ImageIcon size={size} className={iconClassName} style={style} />;
    case 'mindmap':
      return (
        <svg {...props18}>
          <circle cx="4.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="14" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="14" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="14" cy="13.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.5 8.2L12.5 5M6.5 9h6M6.5 9.8L12.5 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'reference':
      return <ReferenceLinkIcon size={size} className={iconClassName} style={style} />;
    default:
      return <svg {...props16}><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" /></svg>;
  }
};
