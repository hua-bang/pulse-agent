// Chromium blocks `file://` URLs loaded from renderer pages, so we serve
// local image/file bytes through the custom `pulse-canvas://` scheme that
// the Electron main process registers. See src/main/index.ts.
const SCHEME = 'pulse-canvas://local';

const encodeAbsolutePath = (absPath: string): string => {
  const normalized = absPath.replace(/\\/g, '/');
  const isWindowsDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;

  return withLeadingSlash
    .split('/')
    .map((segment, index) => {
      if (isWindowsDrivePath && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join('/');
};

export const toFileUrl = (filePath: string): string => {
  const value = filePath.trim();
  if (!value) return '';
  if (value.startsWith(`${SCHEME}/`)) return value;

  // Migrate legacy `file://` URLs persisted in markdown notes or returned
  // by older tool calls — decode the percent-encoded absolute path and
  // re-emit it under the custom scheme.
  if (/^file:\/\//i.test(value)) {
    const raw = value.slice('file://'.length);
    let decoded = raw;
    try {
      decoded = decodeURI(raw);
    } catch {
      // fall through with the raw form
    }
    return `${SCHEME}${encodeAbsolutePath(decoded)}`;
  }

  return `${SCHEME}${encodeAbsolutePath(value)}`;
};
