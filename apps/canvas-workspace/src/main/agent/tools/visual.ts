import { z } from 'zod';
import type { CanvasTool } from './types';
import { broadcastVisualStream } from './_shared/broadcast';

export function createVisualTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    visual_render: {
      name: 'visual_render',
      description:
        'Render a transient inline visualization inside the current chat message — for explanatory diagrams, charts, or illustrations that aid the discussion. ' +
        'The result lives only in this chat message; it does NOT get saved as an artifact. ' +
        'Use this when the user wants to UNDERSTAND something via a visual, not when they want to KEEP or iterate on it. ' +
        'For keep-and-iterate flows, call `artifact_create` instead. ' +
        'For HTML, return a SINGLE self-contained `<!DOCTYPE html>` document — it will render in a sandboxed iframe and CDN libs (Chart.js, D3, Mermaid) load fine. ' +
        'For SVG, return a single `<svg>` element (no surrounding HTML). For Mermaid, return the Mermaid source only (e.g. starting with `graph TD` / `sequenceDiagram` / `flowchart LR`) — no code fences, no surrounding HTML. ' +
        'Pick `mermaid` for quick flowcharts, sequence/state/ER diagrams, gantt charts, and similar structural diagrams; it streams faster than full HTML and renders crisply at any zoom.',
      inputSchema: z.object({
        type: z.enum(['html', 'svg', 'mermaid']).describe('Visual format. `html` renders in a sandboxed iframe; `svg` renders the element directly; `mermaid` parses the source and renders as an SVG diagram.'),
        title: z.string().optional().describe('Short label shown above the visual.'),
        content: z.string().describe('The full visual content (HTML doc, SVG element, or Mermaid source).'),
      }),
      execute: async (input, ctx) => {
        const type = input.type as 'html' | 'svg' | 'mermaid';
        const title = (input.title as string) ?? '';
        const content = (input.content as string) ?? '';
        if (!content.trim()) {
          return JSON.stringify({ ok: false, error: 'content is empty' });
        }

        const toolCallId = ctx?.toolCallId;
        console.info(
          `[visual_render] execute type=${type} bytes=${content.length} toolCallId=${toolCallId ?? '(missing!)'}`,
        );

        // Stream the visual to the renderer in animation-frame-sized chunks
        // so the inline preview "builds up" the way Claude's Artifacts do,
        // even when the upstream LLM/provider doesn't emit tool-input-delta
        // events of its own (we just animate the LLM's final content).
        //
        // Total animation budget: ~1.4 s regardless of content size. Frame
        // budget: 16 ms (~60 fps). Chunk size scales so all frames are used,
        // bounded so a 200B visual doesn't crawl character-by-character.
        if (toolCallId && type === 'html') {
          const TARGET_MS = 1400;
          const FRAME_MS = 16;
          const TOTAL_FRAMES = Math.max(1, Math.floor(TARGET_MS / FRAME_MS));
          const chunkSize = Math.max(64, Math.ceil(content.length / TOTAL_FRAMES));
          const abortSignal = ctx?.abortSignal;

          console.info(
            `[visual_render] starting chunked stream — frames=${TOTAL_FRAMES} chunkSize=${chunkSize}B`,
          );

          let position = 0;
          let frameCount = 0;
          while (position < content.length) {
            if (abortSignal?.aborted) {
              console.info('[visual_render] aborted mid-stream');
              break;
            }
            position = Math.min(position + chunkSize, content.length);
            frameCount += 1;
            broadcastVisualStream({
              workspaceId,
              toolCallId,
              content: content.slice(0, position),
            });
            if (position < content.length) {
              await new Promise<void>((resolve) => setTimeout(resolve, FRAME_MS));
            }
          }
          // Final flush with done=true.
          broadcastVisualStream({
            workspaceId,
            toolCallId,
            content,
            done: true,
          });
          console.info(`[visual_render] stream complete — frames=${frameCount}`);
        } else if (!toolCallId) {
          console.warn(
            '[visual_render] no toolCallId in ctx — streaming SKIPPED, visual will appear in one shot. ' +
            'Likely cause: AI SDK provider not forwarding tool execute options.',
          );
        }

        return JSON.stringify({
          ok: true,
          kind: 'visual_render',
          type,
          title,
          content,
        });
      },
    },
  };
}
