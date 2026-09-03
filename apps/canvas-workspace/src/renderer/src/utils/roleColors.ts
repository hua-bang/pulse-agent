/**
 * Soft translucent fill derived from a role's accent color — used by the
 * speaker badge, role avatar, and mention-popup icon. Returns undefined for
 * anything that is not a `#rrggbb` hex so callers fall back to class styling.
 */
export function roleColorSoft(hex: string | undefined, alpha = 0.14): string | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!match) return undefined;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
