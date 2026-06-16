import type { RendererCanvasPlugin } from './types';
import { CANVAS_NODES_PLUGIN_ID, EXCALIDRAW_BOARD_NODE_TYPE } from './constants';
import { ExcalidrawNodeView } from './ExcalidrawNodeView';

const plugin: RendererCanvasPlugin = {
  id: CANVAS_NODES_PLUGIN_ID,
  activate(ctx) {
    ctx.registerNodeView(EXCALIDRAW_BOARD_NODE_TYPE, ExcalidrawNodeView);
  },
};

export default plugin;
export { plugin };
