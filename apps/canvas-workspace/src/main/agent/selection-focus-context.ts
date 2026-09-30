/** Render the authoritative prompt block for selected and @-mentioned nodes. */
export function formatSelectionFocusBlock(
  selectedNodes: Array<{ id: string; title: string; type: string; workspaceId?: string }>,
  options: { requireWorkspaceId: boolean },
): string {
  if (selectedNodes.length === 0) return '';
  const count = selectedNodes.length;
  const noun = count === 1 ? 'node' : 'nodes';
  const lines: string[] = [
    '',
    `## Current Focus — ${count} Selected ${noun}`,
    `The user has selected or @-mentioned ${count} canvas ${noun} and their CONTENT is the PRIMARY context for the current message. Treat any of the following references as pointing to this selection unless the user names a different node explicitly:`,
    '- English: "this", "it", "that", "these", "those", "the selected", "the selection", "the highlighted node(s)", "the current node"',
    '- 中文：「这个」「它」「这些」「那些」「这条」「选中的」「选中节点」「当前节点」「上面的」「上面这个」「目前这个」',
    '',
    'Selected nodes:',
  ];
  for (const node of selectedNodes) {
    const workspacePart = node.workspaceId ? `, workspaceId: \`${node.workspaceId}\`` : '';
    lines.push(`- **${node.title}** — nodeId: \`${node.id}\`, type: \`${node.type}\`${workspacePart}`);
  }
  lines.push('');
  lines.push(
    options.requireWorkspaceId
      ? `When the user's message is about content you need to inspect, call \`knowledge_read_node\` with the exact \`nodeId\` shown above FIRST. For an image question that requires pixels or OCR, call \`knowledge_analyze_image\` with that exact nodeId. Do not search again, list workspaces, read the whole canvas, take a canvas screenshot, or guess from the title.`
      : `When the user's message is about content you need to inspect, call \`canvas_read_node\` on the nodeId(s) above FIRST — do not guess from the title alone, and do not read unrelated nodes from the full canvas summary below unless the user asks you to.`,
  );
  lines.push(
    'For summaries, explanations, and questions about these nodes, answer from the referenced node content first. If it answers the question, stop gathering data and respond. Read additional sources only for specific missing information the user needs.',
    'A node mention identifies an existing object to inspect; it is not a request to open or render another App. For MCP App nodes, use the live visible-ui and model-context snapshots returned by the node read. The opening tool-result is background data and may include items outside the current view. Do not call an App entrypoint/library/display tool merely to summarize or inspect that node, and do not create a duplicate App in chat. Open an App only when the user explicitly requests opening, showing, or interacting with it.',
    'Interpret questions about what is on/in an App as questions about its displayed contents. Use canvas layout coordinates only when the user explicitly asks about spatial placement or neighboring nodes.',
  );
  return `${lines.join('\n')}\n`;
}
