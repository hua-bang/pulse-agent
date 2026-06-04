import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AgentContextNodeRef, CanvasNode, WorkspaceNodeListItem } from '../../types';
import { ChatPanel } from '../chat';
import type { AgentScope, WorkspaceOption } from '../chat/types';
import type { SettingsSection } from '../Settings';
import { useI18n } from '../../i18n';
import { getNodeTitle, getNodeWorkspaceId } from './utils';

/**
 * The Pulse brand mark (matches the sidebar logo). Rendered inline rather than
 * referencing the public asset so it themes consistently and survives the
 * packaged app's path/base resolution.
 */
const PulseMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
    <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="#FFFFFF" />
    <path
      d="M 80,268 H 188 L 228,178 L 260,370 L 292,148 L 328,268 H 432"
      stroke="#1D1D1F"
      strokeWidth="26"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const DEFAULT_DOCK_WIDTH = 400;
const MIN_DOCK_WIDTH = 300;
const MAX_DOCK_WIDTH = 760;
const OPEN_STORAGE_KEY = 'pulse-canvas.nodes-chat.open';
const WIDTH_STORAGE_KEY = 'pulse-canvas.nodes-chat.width';

const GLOBAL_SCOPE: AgentScope = { kind: 'global' };

const clampWidth = (value: number) =>
  Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, value));

/**
 * Resolve a Nodes/Graph page selection into the agent context refs the global
 * chat panel needs. Each ref carries its owning `workspaceId` so the global
 * assistant can read the node with an explicit workspace (there is no bound
 * canvas in global scope).
 */
export function selectionToContext(
  selectedNode: { workspaceId: string; nodeId: string } | null | undefined,
  nodes: WorkspaceNodeListItem[],
): AgentContextNodeRef[] {
  if (!selectedNode) return [];
  const node = nodes.find(
    (item) => getNodeWorkspaceId(item) === selectedNode.workspaceId && item.id === selectedNode.nodeId,
  );
  if (!node) return [];
  return [
    {
      id: node.id,
      title: getNodeTitle(node),
      type: node.type as CanvasNode['type'],
      workspaceId: selectedNode.workspaceId,
    },
  ];
}

/**
 * Owns the dock's open/width state (persisted) plus the drag-to-resize
 * handler. `rootStyle` exposes the live width as `--chat-dock-w` so the host
 * page can offset its node-detail drawer to sit beside the dock.
 */
export function useNodesChatDock() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OPEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
      return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_DOCK_WIDTH;
    } catch {
      return DEFAULT_DOCK_WIDTH;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_STORAGE_KEY, open ? '1' : '0');
    } catch {
      /* ignore persistence failures */
    }
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      /* ignore persistence failures */
    }
  }, [width]);

  const openDock = useCallback(() => setOpen(true), []);
  const closeDock = useCallback(() => setOpen(false), []);

  const beginResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: MouseEvent) => {
      // Dock is pinned to the right edge, so dragging left widens it.
      setWidth(clampWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  const rootStyle = useMemo(
    () => ({ '--chat-dock-w': open ? `${width}px` : '0px' } as React.CSSProperties),
    [open, width],
  );

  return { open, width, openDock, closeDock, beginResize, rootStyle };
}

interface NodesChatDockProps {
  open: boolean;
  width: number;
  onOpen: () => void;
  onClose: () => void;
  onBeginResize: (event: ReactMouseEvent) => void;
  allWorkspaces: WorkspaceOption[];
  contextNodes: AgentContextNodeRef[];
  onOpenAppSettings: (section: SettingsSection) => void;
}

/**
 * Right-side dock that hosts the global ("knowledge base") chat inside the
 * Nodes / Graph pages. Reuses the canvas `ChatPanel` with an explicit global
 * scope; the page's current selection flows in as `contextNodes`.
 *
 * When collapsed it renders only a floating launcher button. Layout (pushing
 * column in Nodes, overlay in Graph) is driven by page-scoped CSS.
 */
export function NodesChatDock({
  open,
  width,
  onOpen,
  onClose,
  onBeginResize,
  allWorkspaces,
  contextNodes,
  onOpenAppSettings,
}: NodesChatDockProps) {
  const { t } = useI18n();

  if (!open) {
    return (
      <button
        type="button"
        className="nodes-chat-dock__launcher"
        onClick={onOpen}
        title={t('workspaceNodes.chat.openHint')}
        aria-label={t('workspaceNodes.chat.openHint')}
      >
        <PulseMark size={28} />
      </button>
    );
  }

  return (
    <div className="nodes-chat-dock" style={{ width }}>
      <ChatPanel
        agentScope={GLOBAL_SCOPE}
        allWorkspaces={allWorkspaces}
        contextNodes={contextNodes}
        onClose={onClose}
        onResizeStart={onBeginResize}
        onOpenAppSettings={onOpenAppSettings}
      />
    </div>
  );
}
