import type { I18nKey } from '../../../i18n';

export interface QuickAction {
  key: 'summarize_canvas' | 'analyze_relations' | 'create_mindmap' | 'organize_selection';
  label: string;
  labelKey?: I18nKey;
  prompt: string;
  promptKey?: I18nKey;
  requiresSelection?: boolean;
}

type LocalizedCanvasQuickAction = QuickAction & {
  labelKey: I18nKey;
  promptKey: I18nKey;
};

interface LocalizedScopedQuickAction<TKey extends string, TRequiresSelection extends boolean = boolean> {
  key: TKey;
  labelKey: I18nKey;
  promptKey: I18nKey;
  requiresSelection?: TRequiresSelection;
}

export type KnowledgeQuickAction = LocalizedScopedQuickAction<
  'summarize_knowledge' | 'discover_themes' | 'improve_node'
>;

export type GlobalQuickAction = LocalizedScopedQuickAction<
  'review_recent_work' | 'find_connections' | 'surface_open_threads',
  false
>;

export type EmptyStateQuickAction =
  | LocalizedCanvasQuickAction
  | KnowledgeQuickAction
  | GlobalQuickAction;

export const QUICK_ACTIONS: LocalizedCanvasQuickAction[] = [
  {
    key: 'summarize_canvas',
    label: 'Summarize canvas',
    labelKey: 'chat.quick.summarizeCanvas',
    prompt: 'Summarize the current canvas.',
    promptKey: 'chat.quick.summarizeCanvasPrompt',
  },
  {
    key: 'analyze_relations',
    label: 'Analyze node relations',
    labelKey: 'chat.quick.analyzeRelations',
    prompt: 'Analyze the relationships between nodes on the current canvas.',
    promptKey: 'chat.quick.analyzeRelationsPrompt',
  },
  {
    key: 'create_mindmap',
    label: 'Create mindmap',
    labelKey: 'chat.quick.createMindmap',
    prompt: 'Create a mindmap based on the current canvas.',
    promptKey: 'chat.quick.createMindmapPrompt',
  },
  {
    key: 'organize_selection',
    label: 'Organize selection',
    labelKey: 'chat.quick.organizeSelection',
    prompt: 'Organize the currently selected nodes.',
    promptKey: 'chat.quick.organizeSelectionPrompt',
    requiresSelection: true,
  },
];

export const KNOWLEDGE_QUICK_ACTIONS: KnowledgeQuickAction[] = [
  {
    key: 'summarize_knowledge',
    labelKey: 'chat.quick.summarizeKnowledge',
    promptKey: 'chat.quick.summarizeKnowledgePrompt',
  },
  {
    key: 'discover_themes',
    labelKey: 'chat.quick.discoverThemes',
    promptKey: 'chat.quick.discoverThemesPrompt',
  },
  {
    key: 'improve_node',
    labelKey: 'chat.quick.improveNode',
    promptKey: 'chat.quick.improveNodePrompt',
    requiresSelection: true,
  },
];

export const GLOBAL_QUICK_ACTIONS: GlobalQuickAction[] = [
  {
    key: 'review_recent_work',
    labelKey: 'chat.quick.reviewRecentWork',
    promptKey: 'chat.quick.reviewRecentWorkPrompt',
  },
  {
    key: 'find_connections',
    labelKey: 'chat.quick.findConnections',
    promptKey: 'chat.quick.findConnectionsPrompt',
  },
  {
    key: 'surface_open_threads',
    labelKey: 'chat.quick.surfaceOpenThreads',
    promptKey: 'chat.quick.surfaceOpenThreadsPrompt',
  },
];
