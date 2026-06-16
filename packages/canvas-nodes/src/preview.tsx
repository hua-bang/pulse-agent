import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CANVAS_NODES_PLUGIN_ID, EXCALIDRAW_BOARD_NODE_TYPE } from './constants';
import { ExcalidrawNodeView } from './ExcalidrawNodeView';
import type { CanvasNode } from './types';

const initialNode: CanvasNode = {
  id: 'preview',
  type: 'plugin',
  title: 'Excalidraw Board',
  x: 0,
  y: 0,
  width: 900,
  height: 640,
  data: {
    pluginId: CANVAS_NODES_PLUGIN_ID,
    nodeType: EXCALIDRAW_BOARD_NODE_TYPE,
    payload: {
      title: 'Preview',
      elements: [],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    },
  },
};

function Preview() {
  const [node, setNode] = useState(initialNode);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ExcalidrawNodeView
        node={node}
        selected
        updateNode={(patch) => setNode((current) => ({ ...current, ...patch }))}
        invoke={async <T,>() => undefined as T}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Preview />);
