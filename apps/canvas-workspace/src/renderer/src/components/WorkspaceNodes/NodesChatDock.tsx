import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasNode, KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../types';
import { ChatPanel } from '../chat';
import type { AgentScope, WorkspaceOption } from '../chat/types';
import type { SettingsSection } from '../Settings';
import { useI18n } from '../../i18n';
import { getNodeTags, getNodeTitle, getNodeWorkspaceId } from './utils';

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
  workspaces: WorkspaceOption[];
  /** Aggregated knowledge nodes (cross-workspace) — the `@`-picker's node source. */
  nodes: WorkspaceNodeListItem[];
  /** Knowledge tags — the `@`-picker's tag source. */
  tags: KnowledgeTagDefinition[];
  onOpenAppSettings: (section: SettingsSection) => void;
}

/**
 * Right-side dock hosting the global ("knowledge base") chat inside the Nodes /
 * Graph pages. Reuses the canvas `ChatPanel` with an explicit global scope.
 *
 * Context is added with the same inline `@` mention as the canvas — the dock
 * just feeds cross-workspace nodes/tags as candidates (canvases come from
 * `allWorkspaces`). Picks insert an inline chip; at send time ChatPanel
 * collects them into a workspace-aware structured context. No separate tray.
 *
 * When collapsed it renders only a floating Pulse launcher. Layout (pushing
 * column in Nodes, overlay in Graph) is driven by page-scoped CSS.
 */
export function NodesChatDock({
  open,
  width,
  onOpen,
  onClose,
  onBeginResize,
  workspaces,
  nodes,
  tags,
  onOpenAppSettings,
}: NodesChatDockProps) {
  const { t } = useI18n();

  const knowledgeNodes = useMemo(
    () => nodes.map((node) => ({
      id: node.id,
      title: getNodeTitle(node),
      type: node.type as CanvasNode['type'],
      workspaceId: getNodeWorkspaceId(node) || undefined,
    })),
    [nodes],
  );

  // Map each tag to the workspaces it occurs in, so a tag mention can be
  // resolved with an explicit workspaceId in global chat.
  const knowledgeTags = useMemo(() => {
    const workspacesByTag = new Map<string, Set<string>>();
    for (const node of nodes) {
      const ws = getNodeWorkspaceId(node);
      if (!ws) continue;
      for (const tagId of getNodeTags(node)) {
        let set = workspacesByTag.get(tagId);
        if (!set) {
          set = new Set();
          workspacesByTag.set(tagId, set);
        }
        set.add(ws);
      }
    }
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      workspaceIds: Array.from(workspacesByTag.get(tag.id) ?? []),
    }));
  }, [nodes, tags]);

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
        allWorkspaces={workspaces}
        knowledgeNodes={knowledgeNodes}
        knowledgeTags={knowledgeTags}
        onClose={onClose}
        onResizeStart={onBeginResize}
        onOpenAppSettings={onOpenAppSettings}
      />
    </div>
  );
}
