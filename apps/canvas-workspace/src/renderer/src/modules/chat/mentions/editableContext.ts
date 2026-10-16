import type { AgentRequestContext } from '../../../types';
import { globalMcpAppsStore } from '../../mcp-apps/global-apps';
import { collectAppMentionContexts } from './appMentionItems';
import { collectContextRefsFromEditable, withCollectedTabs } from './mentions';
import { withCollectedPlugins } from './pluginMentionItems';
import { serializeEditable } from './serializeEditable';

/**
 * Adds what the composer's mention chips point at to `context`: tabs and
 * plugins always, and nodes, tags, canvases and DOM selections when
 * `structured` is set. App mentions replace the active app's context.
 */
export const collectEditableContext = (
  editable: HTMLElement | null,
  base: AgentRequestContext | undefined,
  structured: boolean,
): AgentRequestContext | undefined => {
  if (!editable) {
    const activeApp = globalMcpAppsStore.readActiveContext();
    return activeApp ? { ...base, mcpAppContext: activeApp } : base;
  }
  let context = withCollectedPlugins(editable, withCollectedTabs(editable, base));
  if (structured) {
    const collected = collectContextRefsFromEditable(editable);
    if (collected.nodes.length || collected.tags.length || collected.canvases.length || collected.domSelections.length) {
      context = {
        ...(context ?? {}),
        // Explicit node mentions define this turn's focus, ahead of ambient canvas selection.
        selectedNodes: collected.nodes.length ? collected.nodes : (context?.selectedNodes ?? []),
        tags: [...(context?.tags ?? []), ...collected.tags],
        canvases: [...(context?.canvases ?? []), ...collected.canvases],
        domSelections: [...(context?.domSelections ?? []), ...collected.domSelections],
        scope: 'selected_nodes',
      };
    }
  }
  const mcpAppMentions = collectAppMentionContexts(serializeEditable(editable));
  if (mcpAppMentions.length) return { ...context, mcpAppContext: null, mcpAppMentions };
  const mcpAppContext = globalMcpAppsStore.readActiveContext();
  return mcpAppContext ? { ...context, mcpAppContext } : context;
};
