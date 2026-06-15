import type { RendererCanvasPlugin } from './types';
import { NoteNodeView } from './NoteNodeView';

const plugin: RendererCanvasPlugin = {
  id: 'demo-note',
  activate(ctx) {
    ctx.registerNodeView('demo.note', NoteNodeView);
  },
};

export default plugin;
export { plugin };
