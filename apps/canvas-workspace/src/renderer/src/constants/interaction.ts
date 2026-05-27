import type { CanvasNode } from '../types';
import type { ShortcutSection } from '../types/ui-interaction';
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

export const SHORTCUT_SECTIONS: Array<{
  titleKey: I18nKey;
  items: Array<ShortcutSection['items'][number] & { descriptionKey: I18nKey }>;
}> = [
  {
    titleKey: 'shortcuts.canvas.title',
    items: [
      { combo: 'Right-click / Double-click', description: '', descriptionKey: 'shortcuts.canvas.createMenu' },
      { combo: 'Scroll', description: '', descriptionKey: 'shortcuts.canvas.pan' },
      { combo: 'Ctrl/Cmd + Scroll', description: '', descriptionKey: 'shortcuts.canvas.zoom' },
      { combo: 'Drag on blank canvas', description: '', descriptionKey: 'shortcuts.canvas.marquee' },
      { combo: 'Ctrl/Cmd + K', description: '', descriptionKey: 'shortcuts.canvas.commandPalette' },
      { combo: 'Ctrl/Cmd + H', description: '', descriptionKey: 'shortcuts.canvas.togglePalette' },
      { combo: 'Ctrl/Cmd + Tab', description: '', descriptionKey: 'shortcuts.canvas.cycleNodes' },
      { combo: 'F', description: '', descriptionKey: 'shortcuts.canvas.focusMode' },
    ],
  },
  {
    titleKey: 'shortcuts.selection.title',
    items: [
      { combo: 'Click', description: '', descriptionKey: 'shortcuts.selection.selectOne' },
      { combo: 'Shift / Ctrl/Cmd + click', description: '', descriptionKey: 'shortcuts.selection.toggle' },
      { combo: 'Shift + drag on blank canvas', description: '', descriptionKey: 'shortcuts.selection.extend' },
      { combo: 'Arrow keys', description: '', descriptionKey: 'shortcuts.selection.nudgeOne' },
      { combo: 'Shift + Arrow keys', description: '', descriptionKey: 'shortcuts.selection.nudgeTen' },
      { combo: 'Ctrl/Cmd while dragging', description: '', descriptionKey: 'shortcuts.selection.disableSnap' },
    ],
  },
  {
    titleKey: 'shortcuts.edit.title',
    items: [
      { combo: 'Ctrl/Cmd + A', description: '', descriptionKey: 'shortcuts.edit.selectAll' },
      { combo: 'Ctrl/Cmd + D', description: '', descriptionKey: 'shortcuts.edit.duplicate' },
      { combo: 'Ctrl/Cmd + C / V', description: '', descriptionKey: 'shortcuts.edit.copyPaste' },
      { combo: 'Ctrl/Cmd + G', description: '', descriptionKey: 'shortcuts.edit.group' },
      { combo: 'Delete / Backspace', description: '', descriptionKey: 'shortcuts.edit.delete' },
      { combo: 'Ctrl/Cmd + Z', description: '', descriptionKey: 'shortcuts.edit.undo' },
      { combo: 'Ctrl/Cmd + Shift + Z', description: '', descriptionKey: 'shortcuts.edit.redo' },
    ],
  },
  {
    titleKey: 'shortcuts.panels.title',
    items: [
      { combo: 'Ctrl/Cmd + Shift + A', description: '', descriptionKey: 'shortcuts.panels.sideChat' },
      { combo: 'Ctrl/Cmd + Shift + L', description: '', descriptionKey: 'shortcuts.panels.chatPage' },
      { combo: '?', description: '', descriptionKey: 'shortcuts.panels.shortcuts' },
      { combo: 'Esc', description: '', descriptionKey: 'shortcuts.panels.escape' },
    ],
  },
];
