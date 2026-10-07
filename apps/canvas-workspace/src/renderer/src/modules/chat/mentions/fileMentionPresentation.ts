import { mentionIconSvg } from './mentionIcons';

/** Presentation only: serialized mentions keep the full path as their identity. */
export const fileMentionLabel = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path;

export const fileMentionIconMarkup = (path: string): string => {
  const extension = fileMentionLabel(path).split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, [string, string]> = {
    ts: ['TS', 'code'], tsx: ['TS', 'code'], js: ['JS', 'code'], jsx: ['JS', 'code'],
    json: ['{ }', 'data'], yaml: ['Y', 'data'], yml: ['Y', 'data'], toml: ['{ }', 'data'],
    md: ['M↓', 'document'], markdown: ['M↓', 'document'], py: ['PY', 'code'],
    sh: ['>_', 'document'], css: ['#', 'code'], html: ['<>', 'data'],
  };
  if (!types[extension]) return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">${mentionIconSvg('file')}</svg>`;
  const [label, kind] = types[extension];
  const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<span class="chat-file-type-icon chat-file-type-icon--${kind}" aria-hidden="true">${escaped}</span>`;
};
