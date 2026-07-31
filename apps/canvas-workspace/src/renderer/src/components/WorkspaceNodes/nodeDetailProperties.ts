export const renderNodePropertyValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(renderNodePropertyValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const typed = value as { value?: unknown; path?: unknown; nodeId?: unknown };
    if (typeof typed.value === 'string') return typed.value;
    if (typeof typed.path === 'string') return typed.path;
    if (typeof typed.nodeId === 'string') return typed.nodeId;
    return JSON.stringify(value);
  }
  return String(value);
};
