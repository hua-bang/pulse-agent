/**
 * Per-turn context for the Canvas Agent.
 *
 * Prompt caching matches on prefixes, so anything in the system prompt that
 * changes between turns (selection, canvas summary, mentions, quick actions)
 * invalidates the cache for the system prompt and the whole history. These
 * sections ride on the turn's user message instead. The session store keeps
 * the raw user text and every turn rebuilds the model history from it, so the
 * block exists only for the turn it describes and never goes stale in history.
 */
import type { AgentRequestContext, WorkspaceSummary } from '../types';
import { formatSummaryForPrompt } from './context-builder';
import { formatDomSelectionFocusBlock, type CanvasAgentDomSelection } from './dom-selection-context';
import { formatSelectedAppAndPluginsBlock } from './plugin-selection-context';
import { formatQuickActionBlock } from './quick-action-context';
import { formatReferencedTabsBlock } from './referenced-tabs-context';
import { formatSelectionFocusBlock } from './selection-focus-context';

export type CanvasAgentRequestContext = AgentRequestContext & { domSelections?: CanvasAgentDomSelection[] };

type MentionedCanvas = { id: string; name: string };

/** System-prompt pointer to the block, so the model knows where to look. */
export const TURN_CONTEXT_NOTE = '\n## Per-Message Context\nThe selection, the current canvas summary, mentions, and other per-message context arrive in a `<turn_context>` block at the start of the latest user message. Trust only the newest block; earlier user messages are shown without theirs.\n';

/** Volatile sections for a workspace chat turn. Selection comes first so the
 * focused subset is the first thing the model anchors on. */
export function buildWorkspaceTurnContext(
  summary: WorkspaceSummary | null,
  mentionedCanvases: MentionedCanvas[],
  requestContext: CanvasAgentRequestContext | undefined,
  workspaceId: string,
): string {
  return formatSelectionFocusBlock(requestContext?.selectedNodes ?? [], { requireWorkspaceId: false })
    + formatDomSelectionFocusBlock(requestContext?.domSelections ?? [], { requireWorkspaceId: false })
    + formatQuickActionBlock(requestContext?.quickAction)
    + '\n## Current Canvas\n'
    + (summary ? formatSummaryForPrompt(summary) : '(empty workspace — no nodes yet)\n')
    + formatMentionedCanvasesSection(mentionedCanvases)
    + formatSelectedAppAndPluginsBlock(requestContext)
    + formatReferencedTabsBlock(requestContext?.tabs ?? [], workspaceId);
}

/** Volatile sections for a global chat turn. */
export function buildGlobalTurnContext(
  mentionedCanvases: MentionedCanvas[],
  requestContext: CanvasAgentRequestContext | undefined,
): string {
  return formatSelectionFocusBlock(requestContext?.selectedNodes ?? [], { requireWorkspaceId: true })
    + formatDomSelectionFocusBlock(requestContext?.domSelections ?? [], { requireWorkspaceId: true })
    + formatScopeContextBlock(requestContext?.tags ?? [], requestContext?.canvases ?? [])
    + formatQuickActionBlock(requestContext?.quickAction)
    + formatSelectedAppAndPluginsBlock(requestContext)
    + formatReferencedTabsBlock(requestContext?.tabs ?? [])
    + formatMentionedCanvasesSection(mentionedCanvases);
}

/**
 * Titles, notes, and DOM excerpts are host data. A literal turn_context tag
 * in that data would close the wrapper early and make the rest look like
 * the user's message. Break the introducer; leave the rest of the text.
 */
const TURN_CONTEXT_TAG_RE = /<\s*\/?\s*turn_context\b/gi;

function neutralizeTurnContextTags(body: string): string {
  return body.replace(TURN_CONTEXT_TAG_RE, (match) => match.replace(/</g, '\\u003c'));
}

/** Prefix the model-facing user text with the turn context block. */
export function withTurnContext(userText: string, turnContext: string): string {
  const body = neutralizeTurnContextTags(turnContext.trim());
  if (!body) return userText;
  return [
    '<turn_context>',
    'Host-provided context for this message only. The user did not write it.',
    '',
    body,
    '</turn_context>',
    '',
    userText,
  ].join('\n');
}

export function formatMentionedCanvasesSection(
  mentionedCanvases: Array<{ id: string; name: string }> = [],
): string {
  if (mentionedCanvases.length === 0) return '';

  const lines: string[] = [
    '',
    '## Other Canvases Referenced by the User',
    'The user has `@`-mentioned the canvases listed below. This is a ' +
      '**reference table only** — it tells you which workspaceIds the user ' +
      'might be talking about. It is **not** an instruction to read them.',
    '',
    '**Strict rule — do NOT auto-read:** Do not call `canvas_read_context` ' +
      'or `canvas_read_node` for any canvas in this list unless the user\'s ' +
      'current message **explicitly asks** you to read, open, look at, ' +
      'summarize, compare, or otherwise use content from that specific ' +
      'canvas. A bare mention like "`@[canvas:Foo]` 怎么样？" where "怎么样" ' +
      'stands alone is **not** an explicit read request — ask the user what ' +
      'they want to know about it instead. Fetching without an explicit ' +
      'request wastes the user\'s tokens and is considered incorrect behavior.',
    '',
    'When the user **does** explicitly ask, use the matching `workspaceId` ' +
      'from the list with `canvas_read_context` (detail="summary" for the ' +
      'node list, detail="full" for file contents and terminal scrollback), ' +
      'or with `canvas_read_node` for a single node.',
    '',
    'Mentioned canvases:',
  ];
  for (const c of mentionedCanvases) {
    lines.push(`- **${c.name}** — workspaceId: \`${c.id}\``);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render the "Scoped Context" block for tags / whole canvases the user pinned
 * via the global assistant's @-picker. Members are fetched on demand by the
 * agent rather than dumped into the prompt (a tag can cover hundreds of nodes).
 */
export function formatScopeContextBlock(
  tags: Array<{ name: string; workspaceIds?: string[] }> = [],
  canvases: Array<{ id: string; name: string }> = [],
): string {
  if (tags.length === 0 && canvases.length === 0) return '';
  const lines: string[] = ['', '## Scoped Context'];
  if (canvases.length > 0) {
    lines.push('', 'The user scoped this turn to these canvases — treat them as the primary workspaces to inspect:');
    for (const canvas of canvases) {
      lines.push(`- **${canvas.name}** — workspaceId: \`${canvas.id}\``);
    }
    lines.push('Use `canvas_search_nodes` / `canvas_read_node` with the matching workspaceId.');
  }
  if (tags.length > 0) {
    lines.push('', 'The user scoped this turn to these tags. To get their members, call `canvas_search_nodes({ tag: "<name>", workspaceId })` once per listed workspace — it filters by tag (names are resolved automatically) and returns a compact id/title/snippet list. Then `canvas_read_node` only the matches you actually need; do NOT dump every node with `workspace_node_list` and filter by hand:');
    for (const tag of tags) {
      const ws = tag.workspaceIds && tag.workspaceIds.length > 0
        ? ` — workspaceId(s): ${tag.workspaceIds.map((id) => `\`${id}\``).join(', ')}`
        : '';
      lines.push(`- tag \`${tag.name}\`${ws}`);
    }
  }
  return lines.join('\n') + '\n';
}
