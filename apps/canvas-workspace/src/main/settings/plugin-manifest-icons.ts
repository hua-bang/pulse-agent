import { isAbsolute, join, normalize } from 'path';

const LOCAL_SCHEME = 'pulse-canvas://local';

function encodeAbsolutePath(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const isWindowsDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;

  return withLeadingSlash
    .split('/')
    .map((segment, index) => {
      if (isWindowsDrivePath && index === 1 && /^[a-zA-Z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join('/');
}

function toLocalPluginAssetUrl(absPath: string): string {
  return `${LOCAL_SCHEME}${encodeAbsolutePath(absPath)}`;
}

function isPluginIconAssetPath(value: string): boolean {
  return (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    /\.(svg|png|jpe?g|webp|gif)$/i.test(value)
  );
}

export function normalizeManifestIcon(dir: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const icon = value.trim();
  if (!icon) return undefined;
  if (/^(https?:|data:|pulse-canvas:)/i.test(icon)) return icon;
  if (!isPluginIconAssetPath(icon)) return icon;
  const sourcePath = isAbsolute(icon) ? normalize(icon) : normalize(join(dir, icon));
  return toLocalPluginAssetUrl(sourcePath);
}
