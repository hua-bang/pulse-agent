import type { IconProps } from './types';

export const WorkspaceIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth={strokeWidth} />
    <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const KnowledgeStoreIcon = ({ size = 14, className, strokeWidth = 1.25 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <ellipse cx="8" cy="4.4" rx="4.6" ry="2.1" stroke="currentColor" strokeWidth={strokeWidth} />
    <path d="M3.4 4.4v6.3c0 1.15 2.05 2.1 4.6 2.1s4.6-.95 4.6-2.1V4.4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    <path d="M3.4 7.55c0 1.15 2.05 2.1 4.6 2.1s4.6-.95 4.6-2.1" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const NodeGraphIcon = ({ size = 14, className, strokeWidth = 1.25 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M5.5 5.25l4.7-1M5.35 6.55l2.75 4.1M10.75 5.55l-1.65 4.9" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="4.25" cy="5.5" r="1.55" stroke="currentColor" strokeWidth={strokeWidth} />
    <circle cx="11.75" cy="3.95" r="1.55" stroke="currentColor" strokeWidth={strokeWidth} />
    <circle cx="8.75" cy="12.05" r="1.55" stroke="currentColor" strokeWidth={strokeWidth} />
  </svg>
);

interface FolderIconProps extends IconProps {
  open?: boolean;
}

export const FolderIcon = ({ size = 14, className, strokeWidth = 1.2, open = false }: FolderIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    {open ? (
      <path d="M2 5.5A1.5 1.5 0 013.5 4H6l1.5 1.5h5A1.5 1.5 0 0114 7v4.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-6z" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth={strokeWidth} />
    ) : (
      <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth={strokeWidth} />
    )}
  </svg>
);

export const ListLinesIcon = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
    <path d="M4 3.5h6M4 7h4M4 10.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const BookmarkIcon = ({ size = 16, className, strokeWidth = 1.35 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" className={className}>
    <path d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
    <path d="M6.6 6.2h4.8M6.6 8.7h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
