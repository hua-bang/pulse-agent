import type { CanvasNode } from '../types';
import type { I18nKey } from '../i18n';

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
