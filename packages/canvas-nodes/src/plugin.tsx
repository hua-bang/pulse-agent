import type { RendererCanvasPlugin } from './types';
import {
  CANVAS_NODES_PLUGIN_ID,
  EXCALIDRAW_BOARD_NODE_TYPE,
  PDF_DOCUMENT_NODE_TYPE,
} from './constants';
import { ExcalidrawNodeView } from './ExcalidrawNodeView';
import { PdfNodeView } from './PdfNodeView';

const plugin: RendererCanvasPlugin = {
  id: CANVAS_NODES_PLUGIN_ID,
  activate(ctx) {
    ctx.registerNodeView(EXCALIDRAW_BOARD_NODE_TYPE, ExcalidrawNodeView);
    ctx.registerNodeView(PDF_DOCUMENT_NODE_TYPE, PdfNodeView);
  },
};

export default plugin;
export { plugin };
