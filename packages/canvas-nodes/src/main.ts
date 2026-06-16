import { z } from 'zod';
import { CANVAS_NODES_PLUGIN_ID, EXCALIDRAW_BOARD_NODE_TYPE } from './constants';
import {
  applySceneInput,
  elementsFromSceneInput,
  isRecord,
  normalizeBoardPayload,
  sceneContent,
  scenePatch,
  summarizeScene,
} from './scene';
import type {
  MainCtx,
  PluginNodeActionResult,
  PluginNodePatch,
  PluginNodeRef,
  PluginNodeWriteInput,
} from './types';

function payloadFromRef(ref: PluginNodeRef) {
  const data = isRecord(ref.node.data) ? ref.node.data : {};
  return normalizeBoardPayload(data.payload);
}

function payloadInput(input: PluginNodeWriteInput): Record<string, unknown> {
  return isRecord(input.payload) ? input.payload : {};
}

function normalizeWrite(ref: PluginNodeRef, input: PluginNodeWriteInput): PluginNodePatch {
  const current = payloadFromRef(ref);
  const patch = payloadInput(input);
  const hasElements = Array.isArray(patch.elements) || Array.isArray(patch.skeleton);
  const next = hasElements
    ? applySceneInput(current, patch, 'replace')
    : {
        ...current,
        title: typeof patch.title === 'string' && patch.title.trim()
          ? patch.title.trim()
          : current.title,
        appState: isRecord(patch.appState)
          ? { ...current.appState, ...patch.appState }
          : current.appState,
        files: isRecord(patch.files)
          ? { ...current.files, ...patch.files }
          : current.files,
        updatedAt: new Date().toISOString(),
      };

  return {
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
    data: input.data,
    ...scenePatch(next),
  };
}

function makeTemplateSkeleton(input: Record<string, unknown>): Array<Record<string, unknown>> {
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : 'System flow';
  const labels = Array.isArray(input.labels)
    ? input.labels.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : ['Input', 'Agent', 'Tool', 'Data'];
  const x = 80;
  const y = 110;
  const gap = 70;
  const width = 180;
  const height = 84;
  const skeleton: Array<Record<string, unknown>> = [
    {
      type: 'text',
      x,
      y: 44,
      width: 520,
      height: 34,
      text: title,
      fontSize: 26,
      strokeColor: '#1f2328',
    },
  ];

  labels.forEach((label, index) => {
    const boxX = x + index * (width + gap);
    skeleton.push({
      type: 'rectangle',
      x: boxX,
      y,
      width,
      height,
      text: label,
      backgroundColor: index % 2 === 0 ? '#e7f0ff' : '#eef8ef',
      strokeColor: index % 2 === 0 ? '#2457a6' : '#2f7d4e',
    });
    if (index > 0) {
      skeleton.push({
        type: 'arrow',
        x: boxX - gap + 8,
        y: y + height / 2,
        width: gap - 16,
        height: 0,
      });
    }
  });
  return skeleton;
}

const mainPlugin = {
  id: CANVAS_NODES_PLUGIN_ID,
  activate(ctx: MainCtx) {
    ctx.registerNodeCapabilities(EXCALIDRAW_BOARD_NODE_TYPE, {
      read(ref) {
        const scene = payloadFromRef(ref);
        return {
          summary: summarizeScene(scene),
          content: sceneContent(scene),
          payload: scene,
          availableActions: [
            'set_scene',
            'append_elements',
            'add_text',
            'clear_scene',
            'summarize',
          ],
        };
      },
      write(ref, input) {
        return normalizeWrite(ref, input);
      },
      actions: {
        set_scene(ref, input): PluginNodeActionResult {
          const scene = applySceneInput(payloadFromRef(ref), input, 'replace');
          return {
            patch: {
              title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
              ...scenePatch(scene),
            },
            result: {
              ok: true,
              mode: 'replace',
              summary: summarizeScene(scene),
            },
          };
        },
        append_elements(ref, input): PluginNodeActionResult {
          const incoming = elementsFromSceneInput(input);
          const scene = applySceneInput(payloadFromRef(ref), input, 'append');
          return {
            patch: scenePatch(scene),
            result: {
              ok: true,
              mode: 'append',
              appended: incoming.length,
              summary: summarizeScene(scene),
            },
          };
        },
        add_text(ref, input): PluginNodeActionResult {
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!text) return { result: { ok: false, error: 'text is required' } };
          const scene = applySceneInput(payloadFromRef(ref), {
            skeleton: [{
              type: 'text',
              text,
              x: typeof input.x === 'number' ? input.x : 80,
              y: typeof input.y === 'number' ? input.y : 80,
              width: typeof input.width === 'number' ? input.width : 280,
              height: typeof input.height === 'number' ? input.height : 40,
              fontSize: typeof input.fontSize === 'number' ? input.fontSize : 22,
              strokeColor: typeof input.strokeColor === 'string' ? input.strokeColor : '#1f2328',
            }],
          }, 'append');
          return {
            patch: scenePatch(scene),
            result: { ok: true, summary: summarizeScene(scene) },
          };
        },
        clear_scene(ref): PluginNodeActionResult {
          const current = payloadFromRef(ref);
          const scene = {
            ...current,
            elements: [],
            updatedAt: new Date().toISOString(),
          };
          return {
            patch: scenePatch(scene),
            result: { ok: true, summary: summarizeScene(scene) },
          };
        },
        summarize(ref): PluginNodeActionResult {
          const scene = payloadFromRef(ref);
          return {
            result: {
              ok: true,
              summary: summarizeScene(scene),
              content: sceneContent(scene),
            },
          };
        },
      },
    });

    ctx.registerCanvasTool(() => ({
      excalidraw_board_template: {
        name: 'excalidraw_board_template',
        defer_loading: true,
        description:
          'Generate a compact Excalidraw skeleton payload for the pulse-canvas-nodes excalidraw.board plugin node. ' +
          'Use the returned JSON with canvas_create_node data.payload or canvas_plugin_node_action action="set_scene".',
        inputSchema: z.object({
          title: z.string().optional().describe('Board title.'),
          labels: z.array(z.string()).optional().describe('Left-to-right box labels for a simple flow.'),
        }),
        execute: async (input: Record<string, unknown>) => JSON.stringify({
          ok: true,
          pluginId: CANVAS_NODES_PLUGIN_ID,
          nodeType: EXCALIDRAW_BOARD_NODE_TYPE,
          action: 'set_scene',
          input: {
            title: typeof input.title === 'string' ? input.title : undefined,
            skeleton: makeTemplateSkeleton(input),
          },
        }, null, 2),
      },
    }));
  },
};

export default mainPlugin;
export { mainPlugin };
