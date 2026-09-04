import type { IconProps } from './types';

const APP_ICON_SRC = new URL('../../../public/icon.png', import.meta.url).href;

export const AppLogoIcon = ({ size = 18, className }: IconProps) => (
  <img
    src={APP_ICON_SRC}
    width={size}
    height={size}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={className}
    style={{
      display: 'block',
      width: size,
      height: size,
      objectFit: 'contain',
      borderRadius: Math.max(4, Math.round(size * 0.22)),
    }}
  />
);

export const PulseGlyphIcon = ({ size = 18, className, strokeWidth = 36 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 512 512" fill="none" className={className}>
    <path d="M 80,268 H 188 L 228,178 L 260,370 L 292,148 L 328,268 H 432" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const AvatarIcon = ({ size = 16, className, strokeWidth = 1.3 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth={strokeWidth} />
    <path d="M4 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
  </svg>
);

export const BotAvatarIcon = (props: IconProps) => <AppLogoIcon {...props} />;
