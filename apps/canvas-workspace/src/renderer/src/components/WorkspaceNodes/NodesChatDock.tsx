import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasNode, KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../types';
import { ChatPanel } from '../chat';
import type { AgentScope, WorkspaceOption } from '../chat/types';
import type { SettingsSection } from '../Settings';
import { ChatFloatingButton } from '../ChatFloatingButton';
import { useI18n } from '../../i18n';
import { getNodeTags, getNodeTitle, getNodeWorkspaceId } from './utils';

const DEFAULT_DOCK_WIDTH = 400;
const MIN_DOCK_WIDTH = 300;
const MAX_DOCK_WIDTH = 760;
const OPEN_STORAGE_KEY = 'pulse-canvas.nodes-chat.open';
const WIDTH_STORAGE_KEY = 'pulse-canvas.nodes-chat.width';
const DOCK_TRANSITION_MS = 260;

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
  const [rendered, setRendered] = useState(open);
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
    if (open) {
      setRendered(true);
      return undefined;
    }
    if (!rendered) return undefined;
    const timeout = window.setTimeout(() => setRendered(false), DOCK_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [open, rendered]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      /* ignore persistence failures */
    }
  }, [width]);

  const openDock = useCallback(() => {
    setRendered(true);
    window.requestAnimationFrame(() => setOpen(true));
  }, []);
  const closeDock = useCallback(() => setOpen(false), []);

  // Tear-down for an in-flight resize drag — also invoked on unmount so a
  // page switch mid-drag can't leak window listeners or leave the document
  // stuck with `user-select: none`.
  const stopResizeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopResizeRef.current?.(), []);

  const beginResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    stopResizeRef.current?.();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: MouseEvent) => {
      // Dock is pinned to the right edge, so dragging left widens it.
      setWidth(clampWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = () => stopResizeRef.current?.();
    stopResizeRef.current = () => {
      stopResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  const rootStyle = useMemo(
    () => ({ '--chat-dock-w': rendered ? `${width}px` : '0px' } as React.CSSProperties),
    [rendered, width],
  );

  return { open, rendered, width, openDock, closeDock, beginResize, rootStyle };
}

interface NodesChatDockProps {
  open: boolean;
  rendered: boolean;
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
export const NodesChatDock = ({
  open,
  rendered,
  width,
  onOpen,
  onClose,
  onBeginResize,
  workspaces,
  nodes,
  tags,
  onOpenAppSettings,
}: NodesChatDockProps) => {
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

  const launcherTitle = open ? t('chat.closePanel') : t('workspaceNodes.chat.openHint');

  return (
    <>
      <ChatFloatingButton
        active={open}
        className="nodes-chat-dock__launcher"
        onClick={open ? onClose : onOpen}
        title={launcherTitle}
        ariaLabel={launcherTitle}
      />
      {rendered && (
        <div className={`nodes-chat-dock${open ? ' is-open' : ' is-closing'}`} style={{ width }}>
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
      )}
    </>
  );
};
