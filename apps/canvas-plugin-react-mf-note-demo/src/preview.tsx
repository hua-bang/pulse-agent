import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteNodeView } from './NoteNodeView';
import type { CanvasNode } from './types';

const initialNode: CanvasNode = {
  id: 'demo-note-preview',
  type: 'plugin',
  title: 'Demo Note',
  x: 0,
  y: 0,
  width: 380,
  height: 280,
  data: {
    pluginId: 'demo-note',
    nodeType: 'demo.note',
    payload: {
      title: 'External React plugin',
      body: 'This preview runs outside Pulse Canvas. Build the project, then load the folder from Canvas Plugins settings.',
      accent: '#2383e2',
      pinned: false,
    },
  },
};

function PreviewApp() {
  const [node, setNode] = useState<CanvasNode>(initialNode);
  const invoke = async <T,>(): Promise<T> => undefined as T;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        margin: 0,
        background: '#f7f7f5',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          width: 420,
          height: 340,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(55, 53, 47, 0.12)',
          background: '#fff',
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.12)',
        }}
      >
        <NoteNodeView
          node={node}
          selected
          updateNode={(patch) => setNode((prev) => ({ ...prev, ...patch }))}
          invoke={invoke}
        />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<PreviewApp />);
