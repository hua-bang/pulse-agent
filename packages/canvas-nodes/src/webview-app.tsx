import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './webview-app.css';
import { isRecord, normalizeBoardPayload } from './scene';
import type {
  ExcalidrawBoardScene,
  ExcalidrawElementRecord,
} from './types';

type ExcalidrawApi = {
  updateScene(scene: {
    elements?: readonly unknown[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
  }): void;
};

type BridgeSceneInput = {
  scene: ExcalidrawBoardScene;
  readOnly: boolean;
};

interface ExcalidrawWebviewBridge {
  setScene(payload: unknown): void;
  getScene(): ExcalidrawBoardScene;
  resize(payload: unknown): void;
}

interface PulseCanvasPluginNodeBridge {
  beforeReload(): { payload: ExcalidrawBoardScene };
  snapshot(): { payload: ExcalidrawBoardScene };
}

declare global {
  interface Window {
    __pulseCanvasExcalidraw?: ExcalidrawWebviewBridge;
    __pulseCanvasPluginNode?: PulseCanvasPluginNodeBridge;
  }
}

let latestScene = normalizeBoardPayload({});
let latestReadOnly = false;
let latestViewport = {
  width: typeof window.innerWidth === 'number' ? window.innerWidth : 1,
  height: typeof window.innerHeight === 'number' ? window.innerHeight : 1,
};
let applyHostScene: ((input: BridgeSceneInput) => void) | null = null;
let applyHostResize: ((viewport: { width: number; height: number }) => void) | null = null;

function normalizeBridgeInput(payload: unknown): BridgeSceneInput {
  const raw = isRecord(payload) ? payload : {};
  return {
    scene: normalizeBoardPayload(raw.scene),
    readOnly: raw.readOnly === true,
  };
}

function normalizeViewport(payload: unknown): { width: number; height: number } {
  const raw = isRecord(payload) ? payload : {};
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width)
    ? raw.width
    : window.innerWidth;
  const height = typeof raw.height === 'number' && Number.isFinite(raw.height)
    ? raw.height
    : window.innerHeight;
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

window.__pulseCanvasExcalidraw = {
  setScene(payload: unknown) {
    const next = normalizeBridgeInput(payload);
    latestScene = next.scene;
    latestReadOnly = next.readOnly;
    applyHostScene?.(next);
  },
  getScene() {
    return latestScene;
  },
  resize(payload: unknown) {
    const next = normalizeViewport(payload);
    latestViewport = next;
    applyHostResize?.(next);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  },
};

window.__pulseCanvasPluginNode = {
  beforeReload() {
    return { payload: latestScene };
  },
  snapshot() {
    return { payload: latestScene };
  },
};

function sanitizeAppState(value: unknown): Record<string, unknown> {
  const raw = isRecord(value) ? value : {};
  const out: Record<string, unknown> = {};
  for (const key of [
    'viewBackgroundColor',
    'gridModeEnabled',
    'theme',
    'currentItemStrokeColor',
    'currentItemBackgroundColor',
    'currentItemFillStyle',
    'currentItemStrokeWidth',
    'currentItemStrokeStyle',
    'currentItemRoughness',
    'currentItemOpacity',
    'currentItemFontFamily',
    'currentItemFontSize',
  ]) {
    if (raw[key] !== undefined && typeof raw[key] !== 'function') out[key] = raw[key];
  }
  return {
    viewBackgroundColor: typeof out.viewBackgroundColor === 'string'
      ? out.viewBackgroundColor
      : '#ffffff',
    ...out,
  };
}

function sanitizeFiles(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonDeletedElements(elements: readonly unknown[]): ExcalidrawElementRecord[] {
  return elements
    .filter(isRecord)
    .filter((element) => element.isDeleted !== true)
    .map((element) => ({ ...element }));
}

function sceneKey(scene: ExcalidrawBoardScene): string {
  try {
    return JSON.stringify({
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
    });
  } catch {
    return `${scene.elements.length}:${scene.updatedAt ?? ''}`;
  }
}

function ExcalidrawWebviewApp() {
  const [scene, setScene] = useState(latestScene);
  const [readOnly, setReadOnly] = useState(latestReadOnly);
  const [viewport, setViewport] = useState(latestViewport);
  const [apiReady, setApiReady] = useState(false);
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const sceneRef = useRef(scene);
  const lastAppliedKeyRef = useRef('');
  const key = useMemo(() => sceneKey(scene), [scene]);

  useEffect(() => {
    const apply = (input: BridgeSceneInput) => {
      latestScene = input.scene;
      latestReadOnly = input.readOnly;
      sceneRef.current = input.scene;
      setReadOnly(input.readOnly);
      setScene(input.scene);
    };
    applyHostScene = apply;
    return () => {
      if (applyHostScene === apply) applyHostScene = null;
    };
  }, []);

  useEffect(() => {
    const apply = (next: { width: number; height: number }) => {
      latestViewport = next;
      setViewport(next);
    };
    const handleWindowResize = () => apply(normalizeViewport({}));
    applyHostResize = apply;
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (applyHostResize === apply) applyHostResize = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !apiReady) return;
    if (key === lastAppliedKeyRef.current) return;
    lastAppliedKeyRef.current = key;
    sceneRef.current = scene;
    latestScene = scene;
    api.updateScene({
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
    });
  }, [apiReady, key, scene]);

  const persistScene = (
    elements: readonly unknown[],
    appState: unknown,
    files: unknown,
  ) => {
    if (readOnly) return;
    const nextScene: ExcalidrawBoardScene = {
      title: sceneRef.current.title,
      elements: nonDeletedElements(elements),
      appState: sanitizeAppState(appState),
      files: sanitizeFiles(files),
      updatedAt: new Date().toISOString(),
    };
    sceneRef.current = nextScene;
    latestScene = nextScene;
    lastAppliedKeyRef.current = sceneKey(nextScene);
  };

  return (
    <div
      className="excalidraw-webview-app"
      style={{
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      }}
    >
      <Excalidraw
        initialData={{
          elements: scene.elements as never,
          appState: scene.appState as never,
          files: scene.files as never,
        }}
        excalidrawAPI={(api: unknown) => {
          apiRef.current = api as ExcalidrawApi;
          setApiReady(true);
        }}
        onChange={(elements: readonly unknown[], appState: unknown, files: unknown) =>
          persistScene(elements, appState, files)
        }
        viewModeEnabled={readOnly}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ExcalidrawWebviewApp />);
