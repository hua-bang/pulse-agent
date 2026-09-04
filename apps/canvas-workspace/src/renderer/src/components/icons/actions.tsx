import type { IconProps } from './types';

export const TrashIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M3 4.5h10" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    <path d="M6.2 4.5V3.2h3.6v1.3" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 6.3l.45 6.2A1.5 1.5 0 006.95 14h2.1a1.5 1.5 0 001.5-1.5L11 6.3" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const PencilIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M11.2 2.8l2 2-7.4 7.4-2.5.5.5-2.5 7.4-7.4z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.8 4.2l2 2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const CloseIcon = ({ size = 16, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const PlusIcon = ({ size = 16, className, strokeWidth = 1.5 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const ChevronRightIcon = ({ size = 10, className, strokeWidth = 1.8 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ExportIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 10V3" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    <path d="M5.5 5.5L8 3l2.5 2.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 9v3.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V9" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const ImportIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 3v7" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    <path d="M5.5 7.5L8 10l2.5-2.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 9v3.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V9" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const SteerIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M3 4v3.5A2.5 2.5 0 005.5 10H13" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    <path d="M10.5 7.5L13 10l-2.5 2.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CopyIcon = ({ size = 14, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
    <path d="M9.5 4V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1H4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth={strokeWidth} fill="#fff" />
  </svg>
);
