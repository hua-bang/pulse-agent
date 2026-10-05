import type { McpAppIconImage, McpAppIconSet } from '../../../../../../shared/mcp-apps';
import './GlobalMcpAppTile.css';

const TILE_COLORS = ['#2f6fd6', '#b0570f', '#2c7a4b', '#7a4bb0', '#b03a5b', '#2f7f8c'];

const tileColor = (seed: string): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
};

interface Props {
  title: string;
  seed: string;
  size?: number;
  /** The app's MCP icon; without one a letter tile is shown. */
  icon?: McpAppIconSet;
}

const IconImage = ({ image, size, variant }: {
  image: McpAppIconImage;
  size: number;
  variant: 'default' | 'dark';
}) => {
  const className = `global-mcp-app-icon__image global-mcp-app-icon__image--${variant}`;
  if (image.kind === 'image') {
    return <img className={className} src={image.src} alt="" width={size} height={size} draggable={false} />;
  }
  // Monochrome SVG: paint the current text color through the icon's shape.
  const mask = `url("${image.src}")`;
  return (
    <span
      className={`${className} global-mcp-app-icon__mask`}
      style={{ width: size, height: size, maskImage: mask, WebkitMaskImage: mask }}
    />
  );
};

/** App icon from the MCP server, or a letter tile when it declares none. */
export const GlobalMcpAppTile = ({ title, seed, size = 18, icon }: Props) => {
  if (icon) {
    return (
      <span
        className={`global-mcp-app-icon${icon.dark ? ' global-mcp-app-icon--themed' : ''}`}
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        <IconImage image={icon.default} size={size} variant="default" />
        {icon.dark && <IconImage image={icon.dark} size={size} variant="dark" />}
      </span>
    );
  }
  return (
    <span
      className="global-mcp-app-tile"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        background: tileColor(seed),
        // White text belongs to the fixed tile palette, not the theme.
        color: '#fff',
      }}
    >
      {title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
};
