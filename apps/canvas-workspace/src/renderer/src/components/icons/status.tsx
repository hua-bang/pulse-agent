import type { IconProps } from './types';

export const SettingsIcon = ({ size = 16, className, strokeWidth = 1.35 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 10.4a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z" stroke="currentColor" strokeWidth={strokeWidth} />
    <path d="M8 1.9l1.05 1.35 1.7.2.55 1.6 1.45.9-.45 1.65.45 1.65-1.45.9-.55 1.6-1.7.2L8 14.1l-1.05-1.35-1.7-.2-.55-1.6-1.45-.9.45-1.65-.45-1.65 1.45-.9.55-1.6 1.7-.2L8 1.9z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CheckIcon = ({ size = 14, className, strokeWidth = 1.6 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M3.5 8.2l2.7 2.7 6.3-6.4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const RefreshIcon = ({ size = 14, className, strokeWidth = 1.35 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M13 7a5 5 0 00-8.7-3.35L3 5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 3v2h2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 9a5 5 0 008.7 3.35L13 11" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 13v-2h-2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SpinnerIcon = ({ size = 14, className, strokeWidth = 1.5 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={strokeWidth} opacity="0.25" />
    <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const SparklesIcon = ({ size = 16, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M6 2.5l1 2.5 2.5 1-2.5 1L6 9.5 5 7 2.5 6 5 5 6 2.5z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
    <path d="M11.5 8.5l.75 1.75L14 11l-1.75.75L11.5 13.5l-.75-1.75L9 11l1.75-.75L11.5 8.5z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
  </svg>
);

export const PluginIcon = ({ size = 14, className, strokeWidth = 1.3, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
    <path d="M5.3 2.4v3M10.7 2.4v3M4 5.4h8v2.4a4 4 0 01-8 0V5.4zM8 11.8v1.8M5.9 13.6h4.2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ScheduledIcon = ({ size = 14, className, strokeWidth = 1.3, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
    <rect x="2.5" y="3.2" width="11" height="10.3" rx="2" stroke="currentColor" strokeWidth={strokeWidth} />
    <path d="M5 2.3v2.4M11 2.3v2.4M2.8 6.4h10.4M5.2 9.1h2.1M5.2 11.2h4.6" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
