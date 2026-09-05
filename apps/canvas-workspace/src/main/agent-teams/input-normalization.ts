export function cleanString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}
