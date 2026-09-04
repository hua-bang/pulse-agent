import type { CanvasNode } from '../../../../../../types';
import type {
  CanvasPluginEntry,
  CanvasPluginManifestNode,
  CanvasPluginsStatus,
} from '../../../../../../types/settings-config';
import { inferPluginIcon } from '../PluginNodeIcon';

export interface PluginNodeOption {
  key: string;
  pluginId: string;
  nodeType: string;
  title: string;
  icon?: string;
  nodePatch: Partial<CanvasNode>;
}

const DEFAULT_PLUGIN_SIZE = { width: 640, height: 420 } as const;
const EXCALIDRAW_BOARD_SIZE = { width: 900, height: 640 } as const;

function manifestNodeTitle(node: CanvasPluginManifestNode): string {
  return typeof node.title === 'string' && node.title.trim()
    ? node.title.trim()
    : node.type;
}

function optionFromManifestNode(
  plugin: CanvasPluginEntry,
  node: CanvasPluginManifestNode,
): PluginNodeOption {
  const title = manifestNodeTitle(node);
  const size = node.type === 'excalidraw.board'
    ? EXCALIDRAW_BOARD_SIZE
    : DEFAULT_PLUGIN_SIZE;
  return {
    key: `${plugin.id}:${node.type}`,
    pluginId: plugin.id,
    nodeType: node.type,
    title,
    icon: node.icon ?? inferPluginIcon(node.type),
    nodePatch: {
      title,
      width: size.width,
      height: size.height,
      data: {
        pluginId: plugin.id,
        nodeType: node.type,
        payload: {},
        version: plugin.version,
      },
    },
  };
}

export function optionsFromPluginStatus(
  status: CanvasPluginsStatus | undefined,
): PluginNodeOption[] {
  if (!status) return [];
  return status.plugins.flatMap((plugin) => (
    plugin.error
      ? []
      : (plugin.nodes ?? []).map((node) => optionFromManifestNode(plugin, node))
  ));
}

export function statusFromPluginsChangedEvent(
  event: Event,
): CanvasPluginsStatus | undefined {
  const detail = (event as CustomEvent<CanvasPluginsStatus | { status?: CanvasPluginsStatus }>).detail;
  if (!detail || typeof detail !== 'object') return undefined;
  if ('plugins' in detail && Array.isArray(detail.plugins)) {
    return detail as CanvasPluginsStatus;
  }
  if ('status' in detail) return detail.status;
  return undefined;
}
