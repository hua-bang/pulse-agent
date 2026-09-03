import type { DirEntry, MentionItem } from '../../../types';

/**
 * Flatten a project directory listing into file/folder mention candidates.
 * (Moved out of useChatComposerInput to keep the hook under the 500-line gate.)
 */
export function flattenEntries(entries: DirEntry[], rootFolder: string, prefix = ''): MentionItem[] {
  const items: MentionItem[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'file') {
      items.push({ type: 'file', label: path, path: `${rootFolder}/${path}` });
      continue;
    }

    // Directory: add it as a mention candidate, then recurse into children.
    items.push({ type: 'folder', label: `${path}/`, path: `${rootFolder}/${path}` });
    if (entry.children) {
      items.push(...flattenEntries(entry.children, rootFolder, path));
    }
  }

  return items;
}
