export const toFileUrl = (filePath: string): string => {
  const value = filePath.trim();
  if (!value) return '';
  if (/^file:\/\//i.test(value)) return value;

  const normalized = value.replace(/\\/g, '/');
  const isWindowsDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;

  const encodedPath = withLeadingSlash
    .split('/')
    .map((segment, index) => {
      if (isWindowsDrivePath && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join('/');

  return `file://${encodedPath}`;
};
