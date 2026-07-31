import type { CanvasNode } from '../types';
import type { I18nKey } from '../i18n';
import {
  SECTION_ORDER,
  SECTION_TITLE_KEY,
  formatAllBindings,
  shortcutsFor,
  type ShortcutDefinition,
} from '../shortcuts/registry';

type EmptyCanvasNodeType = Extract<CanvasNode['type'], 'agent' | 'terminal' | 'file' | 'iframe'>;

export const DEFAULT_TOAST_DURATION_MS = 2800;

export const INTERACTION_ACTIONS = {
  workspaceCreate: 'workspace.create',
  workspaceRename: 'workspace.rename',
  workspaceDelete: 'workspace.delete',
  folderCreate: 'folder.create',
  folderRename: 'folder.rename',
  folderDelete: 'folder.delete',
  nodeRename: 'node.rename',
  nodeDelete: 'node.delete',
  nodeLinkCopy: 'node.link.copy',
  shortcutsOpen: 'shortcuts.open',
  emptyStateCreateAgent: 'empty-state.create-agent',
  emptyStateCreateTerminal: 'empty-state.create-terminal',
  emptyStateCreateNote: 'empty-state.create-note',
  emptyStateCreateWeb: 'empty-state.create-web',
} as const;

export const NODE_TYPE_LABELS: Record<CanvasNode['type'], string> = {
  file: 'Note',
  terminal: 'Terminal',
  frame: 'Frame',
  group: 'Group',
  agent: 'Agent',
  text: 'Text',
  iframe: 'Link',
  'dynamic-app': 'Dynamic App',
  image: 'Image',
  shape: 'Shape',
  mindmap: 'Mindmap',
  reference: 'Reference',
  plugin: 'Plugin',
};

export const EMPTY_CANVAS_ACTIONS: Array<{
  actionKey: string;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  nodeType: EmptyCanvasNodeType;
}> = [
  {
    actionKey: INTERACTION_ACTIONS.emptyStateCreateAgent,
    labelKey: 'canvas.empty.createAgent',
    descriptionKey: 'canvas.empty.createAgentDescription',
    nodeType: 'agent',
  },
  {
    actionKey: INTERACTION_ACTIONS.emptyStateCreateTerminal,
    labelKey: 'canvas.empty.openTerminal',
    descriptionKey: 'canvas.empty.openTerminalDescription',
    nodeType: 'terminal',
  },
  {
    actionKey: INTERACTION_ACTIONS.emptyStateCreateNote,
    labelKey: 'canvas.empty.newNote',
    descriptionKey: 'canvas.empty.newNoteDescription',
    nodeType: 'file',
  },
  {
    actionKey: INTERACTION_ACTIONS.emptyStateCreateWeb,
    labelKey: 'canvas.empty.webPage',
    descriptionKey: 'canvas.empty.webPageDescription',
    nodeType: 'iframe',
  },
];

/**
 * Rows for the `?` help overlay, DERIVED from `shortcuts/registry.ts` rather
 * than hand-listed. The old hardcoded table is exactly where the drift lived:
 * it advertised `Cmd+Shift+A` with no handler behind it and printed `Cmd+…`
 * on Windows. Every combo here is now generated for the host platform, and a
 * row can only exist if the registry declares it.
 */
export const SHORTCUT_SECTIONS: Array<{
  titleKey: I18nKey;
  items: Array<{ combos: string[]; descriptionKey: I18nKey }>;
}> = (() => {
  const all: ShortcutDefinition[] = [
    ...shortcutsFor('gesture'),
    ...shortcutsFor('canvas'),
    ...shortcutsFor('document'),
    ...shortcutsFor('app'),
  ];
  return SECTION_ORDER.map((section) => ({
    titleKey: SECTION_TITLE_KEY[section],
    items: all
      .filter((definition) => definition.section === section)
      .map((definition) => ({
        combos: formatAllBindings(definition),
        descriptionKey: definition.descriptionKey,
      }))
      // Definitions whose bindings are all hidden are declared for the
      // handler tables, not for this panel.
      .filter((item) => item.combos.length > 0),
  })).filter((section) => section.items.length > 0);
})();
