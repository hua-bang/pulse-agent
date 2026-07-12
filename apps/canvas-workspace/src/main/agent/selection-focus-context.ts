/** Render the authoritative prompt block for nodes selected in the UI. */
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
    `The user has selected ${count} canvas ${noun} and these are the PRIMARY context for the current message. Treat any of the following references as pointing to this selection unless the user names a different node explicitly:`,
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
      ? `When the user's message is about content you need to inspect, call \`knowledge_read_node\` with the exact \`nodeId\` shown above FIRST. For an image question that requires pixels or OCR, call \`knowledge_analyze_image\` with that exact nodeId. Do not search again, list workspaces, read the whole canvas, take a canvas screenshot, or guess from the title. If you prepare a reviewable edit, pass the internal \`workspaceId\` returned by \`knowledge_read_node\` to \`canvas_propose_node_change\`.`
      : `When the user's message is about content you need to inspect, call \`canvas_read_node\` on the nodeId(s) above FIRST — do not guess from the title alone, and do not read unrelated nodes from the full canvas summary below unless the user asks you to.`,
  );
  return `${lines.join('\n')}\n`;
}
