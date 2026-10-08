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

export const BotAvatarIcon = (props: IconProps) => <AppLogoIcon {...props} />;
