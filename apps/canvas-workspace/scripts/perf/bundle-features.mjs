export const BUNDLE_FEATURE_ENTRIES = [
  { id: 'file', matches: (key) => key.endsWith('src/modules/canvas/components/node-bodies/FileNodeBody/index.tsx') },
  { id: 'chat', matches: (key) => key.endsWith('src/modules/chat/components/ChatPanel/index.tsx') },
  { id: 'terminal', matches: (key) => key.endsWith('src/modules/canvas/components/node-bodies/TerminalNodeBody/index.tsx') },
  { id: 'graph', matches: (key) => key.endsWith('src/modules/workspace-nodes/internal/GraphPage/index.tsx') },
  { id: 'mermaid', matches: (_key, chunk) => /^assets\/mermaid\.core-/.test(chunk.file ?? '') },
  { id: 'mf', matches: (key) => key.includes('/@module-federation+runtime@') && key.endsWith('/dist/index.js') },
];

export const findBundleFeatureEntryKeys = (manifest, feature) => (
  Object.entries(manifest)
    .filter(([key, chunk]) => feature.matches(key, chunk))
    .map(([key]) => key)
);
