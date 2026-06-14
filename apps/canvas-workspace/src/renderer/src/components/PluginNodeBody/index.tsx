import { useSyncExternalStore } from 'react';
import type { CanvasNode, PluginNodeData } from '../../types';
import {
  getRegisteredNodeView,
  getRendererPluginRegistryVersion,
  subscribeRendererPluginRegistry,
} from '../../../../plugins/renderer';
import './index.css';

interface PluginNodeBodyProps {
  node: CanvasNode;
  workspaceId?: string;
  workspaceName?: string;
  isSelected?: boolean;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly?: boolean;
}

function getPluginData(node: CanvasNode): PluginNodeData {
  const data = (node.data ?? {}) as Partial<PluginNodeData>;
  return {
    pluginId: typeof data.pluginId === 'string' && data.pluginId ? data.pluginId : 'unknown',
    nodeType: typeof data.nodeType === 'string' && data.nodeType ? data.nodeType : 'unknown',
    payload: data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
      ? data.payload as Record<string, unknown>
      : {},
    version: typeof data.version === 'string' ? data.version : undefined,
  };
}

function previewPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload || Object.keys(payload).length === 0) return '{}';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '[unserializable payload]';
  }
}

export const PluginNodeBody = ({
  node,
  workspaceId,
  workspaceName,
  isSelected,
  onUpdate,
  readOnly,
}: PluginNodeBodyProps) => {
  useSyncExternalStore(
    subscribeRendererPluginRegistry,
    getRendererPluginRegistryVersion,
    getRendererPluginRegistryVersion,
  );
  const data = getPluginData(node);
  const entry = getRegisteredNodeView(data.nodeType);

  if (entry) {
    const Component = entry.Component;
    return (
      <Component
        node={node}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        readOnly={readOnly}
        selected={isSelected}
        updateNode={(patch) => onUpdate(node.id, patch)}
        invoke={(channel, ...args) =>
          window.canvasWorkspace.plugin.invoke(entry.pluginId, channel, ...args)
        }
      />
    );
  }

  return (
    <div className="plugin-node-body">
      <div className="plugin-node-body__eyebrow">Plugin node</div>
      <div className="plugin-node-body__title">{data.nodeType}</div>
      <div className="plugin-node-body__meta">
        <span>plugin</span>
        <strong>{data.pluginId}</strong>
      </div>
      <pre className="plugin-node-body__payload">{previewPayload(data.payload)}</pre>
      <div className="plugin-node-body__hint">
        Renderer view not registered yet. This fallback keeps the node readable
        while the plugin runtime loads.
      </div>
    </div>
  );
};
