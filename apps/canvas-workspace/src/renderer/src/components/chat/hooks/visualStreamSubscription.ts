import type { ToolCallStatus } from '../types';

/**
 * Side-channel subscription for `visual_render`: the tool pushes
 * already-extracted HTML chunks over animation frames. Chunks are accepted
 * regardless of which session emitted them — the toolCallId disambiguates —
 * but filtered to the active workspace so a stray chunk from a parallel
 * workspace agent doesn't leak in. Extracted from useChatStream so the hook
 * stays inside its file-size-governance baseline.
 */
export function subscribeVisualStream(options: {
  workspaceId: string | undefined;
  findTool: (toolCallId: string | undefined, name?: string) => ToolCallStatus | undefined;
  publishTools: () => void;
}): () => void {
  const { workspaceId, findTool, publishTools } = options;
  let frames = 0;
  return window.canvasWorkspace.agent.onVisualStream(data => {
    if (!workspaceId || data.workspaceId !== workspaceId) return;
    const tool = findTool(data.toolCallId);
    if (!tool) {
      if (frames < 3) {
        console.warn('[useChatStream] visual-stream frame for unknown toolCallId', data.toolCallId);
        frames++;
      }
      return;
    }
    frames++;
    // Sample-log progress so we can verify chunks arrive at ~60fps.
    if (frames === 1 || data.done || frames % 15 === 0) {
      console.info(
        `[useChatStream] visual-stream frame=${frames} ` +
        `bytes=${data.content.length} done=${!!data.done} toolCallId=${data.toolCallId}`,
      );
    }
    tool.streamedContent = data.content;
    if (data.done) tool.streamedDone = true;
    publishTools();
  });
}
