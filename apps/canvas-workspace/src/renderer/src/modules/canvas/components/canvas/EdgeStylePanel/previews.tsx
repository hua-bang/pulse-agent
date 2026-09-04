import type { EdgeArrowCap, EdgeStroke } from '../../../../../types';

export const strokeDasharrayFor = (style: EdgeStroke['style']): string | undefined => {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '1.5 3';
  return undefined;
};

export const CapPreview = ({ cap, color, side }: { cap: EdgeArrowCap; color: string; side: 'head' | 'tail' }) => {
  const x1 = side === 'head' ? 2 : 16;
  const x2 = side === 'head' ? 14 : 4;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <line x1={x1} y1={9} x2={x2} y2={9} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      {cap === 'triangle' && <path d={side === 'head' ? 'M10,5 L16,9 L10,13 Z' : 'M8,5 L2,9 L8,13 Z'} fill={color} />}
      {cap === 'arrow' && <path d={side === 'head' ? 'M10,5 L16,9 L10,13' : 'M8,5 L2,9 L8,13'} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />}
      {cap === 'dot' && <circle cx={side === 'head' ? 15 : 3} cy={9} r={2.5} fill={color} />}
      {cap === 'bar' && <rect x={side === 'head' ? 14 : 3} y={4} width={1.6} height={10} fill={color} />}
      {cap === 'none' && <circle cx={side === 'head' ? 15 : 3} cy={9} r={2.2} fill="none" stroke={color} strokeWidth={1} />}
    </svg>
  );
};

export const WidthPreview = ({ width }: { width: number }) => (
  <svg width="22" height="14" viewBox="0 0 22 14">
    <line x1={3} y1={7} x2={19} y2={7} stroke="currentColor" strokeWidth={Math.min(width, 4)} strokeLinecap="round" />
  </svg>
);

export const StylePreview = ({ style }: { style: EdgeStroke['style'] }) => (
  <svg width="22" height="14" viewBox="0 0 22 14">
    <line x1={3} y1={7} x2={19} y2={7} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeDasharray={strokeDasharrayFor(style)} />
  </svg>
);
