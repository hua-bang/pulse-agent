// Dedicated entry for surfaces that render single canvas node bodies outside
// the canvas (the MCP App node view) without pulling in the canvas surface,
// chat, or dock code that `index.ts` reaches.
export { MindmapNodeBody } from './components/node-bodies/MindmapNodeBody';
export { TextNodeBodyLazy } from './components/node-bodies/TextNodeBodyLazy';
