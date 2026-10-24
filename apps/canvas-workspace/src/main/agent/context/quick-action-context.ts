/**
 * Instructions for quick actions the UI submits on the user's behalf. The
 * chat shows only the short user-facing request, so tool names and edit
 * restrictions live here, in the system prompt, instead of in the visible
 * user message.
 */
const QUICK_ACTION_GUIDANCE: Record<string, string> = {
  summarize_knowledge_node: 'Quick action guidance: read the selected node with knowledge_read_node, then summarize its core content clearly and concisely. Return the summary directly in chat. Do not propose or apply any node changes, and do not modify the title, content, tags, relations, or AI insight field.',
};

export function formatQuickActionLines(quickAction: string): string[] {
  const guidance = QUICK_ACTION_GUIDANCE[quickAction];
  return [
    `- Suggested action the user invoked: ${quickAction}`,
    ...(guidance ? [guidance] : []),
  ];
}
