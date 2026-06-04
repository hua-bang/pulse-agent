import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  CanvasNode,
  KnowledgeTagDefinition,
  WorkspaceNodeListItem,
} from '../../types';
import { ChatPanel } from '../chat';
import type { AgentScope, WorkspaceOption } from '../chat/types';
import { MentionNodeIcon } from '../chat/utils/mentions';
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
const PICKER_MAX_PER_GROUP = 8;

const GLOBAL_SCOPE: AgentScope = { kind: 'global' };

const clampWidth = (value: number) =>
  Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, value));

const nodeRefKey = (ref: AgentContextNodeRef) => `node:${ref.workspaceId ?? ''}:${ref.id}`;

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
  workspaces: WorkspaceOption[];
  /** Aggregated knowledge nodes (cross-workspace) — the @-picker's node source. */
  nodes: WorkspaceNodeListItem[];
  /** Knowledge tags — the @-picker's tag source. */
  tags: KnowledgeTagDefinition[];
  /** The page's current selection, auto-added as context. */
  selectedNode: { workspaceId: string; nodeId: string } | null;
  /** Clear the page selection (used when its context chip is removed). */
  onClearSelection?: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
}

/**
 * Right-side dock hosting the global ("knowledge base") chat inside the Nodes /
 * Graph pages. Reuses the canvas `ChatPanel` with an explicit global scope.
 *
 * Context comes from two sources, both surfaced as removable chips and sent via
 * `requestContext`: the page's current selection, and an `@`-triggered picker
 * that scopes the turn to specific nodes, tags, or whole canvases. The `@` key
 * is intercepted here so the picker (cross-workspace, workspace-aware) replaces
 * the canvas-only inline mention popup — the shared mention code is untouched.
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
  selectedNode,
  onClearSelection,
  onOpenAppSettings,
}: NodesChatDockProps) {
  const { t } = useI18n();
  const [pickedNodes, setPickedNodes] = useState<AgentContextNodeRef[]>([]);
  const [pickedTags, setPickedTags] = useState<AgentContextTagRef[]>([]);
  const [pickedCanvases, setPickedCanvases] = useState<AgentContextCanvasRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const pageContext = useMemo(() => selectionToContext(selectedNode, nodes), [selectedNode, nodes]);

  // Page selection + @-picked nodes, de-duplicated by workspace+id.
  const contextNodes = useMemo<AgentContextNodeRef[]>(() => {
    const seen = new Set<string>();
    const merged: AgentContextNodeRef[] = [];
    for (const ref of [...pageContext, ...pickedNodes]) {
      const key = nodeRefKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(ref);
    }
    return merged;
  }, [pageContext, pickedNodes]);

  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerQuery('');
  }, []);

  // Intercept `@` (capture phase) so it opens the cross-workspace picker
  // instead of inserting the char / triggering the shared mention popup.
  const handleKeyCapture = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === '@') {
      event.preventDefault();
      event.stopPropagation();
      setPickerQuery('');
      setPickerOpen(true);
    } else if (event.key === 'Escape' && pickerOpen) {
      event.stopPropagation();
      closePicker();
    }
  }, [pickerOpen, closePicker]);

  const addNode = useCallback((node: WorkspaceNodeListItem) => {
    const ref: AgentContextNodeRef = {
      id: node.id,
      title: getNodeTitle(node),
      type: node.type as CanvasNode['type'],
      workspaceId: getNodeWorkspaceId(node) || undefined,
    };
    setPickedNodes((prev) => (prev.some((p) => nodeRefKey(p) === nodeRefKey(ref)) ? prev : [...prev, ref]));
    closePicker();
  }, [closePicker]);

  const addTag = useCallback((tag: KnowledgeTagDefinition) => {
    const workspaceIds = Array.from(new Set(
      nodes.filter((n) => getNodeTags(n).includes(tag.id)).map((n) => getNodeWorkspaceId(n)).filter(Boolean),
    ));
    const ref: AgentContextTagRef = { name: tag.name, workspaceIds: workspaceIds.length ? workspaceIds : undefined };
    setPickedTags((prev) => (prev.some((p) => p.name === ref.name) ? prev : [...prev, ref]));
    closePicker();
  }, [nodes, closePicker]);

  const addCanvas = useCallback((canvas: WorkspaceOption) => {
    setPickedCanvases((prev) => (prev.some((p) => p.id === canvas.id) ? prev : [...prev, { id: canvas.id, name: canvas.name }]));
    closePicker();
  }, [closePicker]);

  const handleRemoveContext = useCallback((key: string) => {
    if (key.startsWith('tag:')) {
      const name = key.slice(4);
      setPickedTags((prev) => prev.filter((p) => p.name !== name));
      return;
    }
    if (key.startsWith('canvas:')) {
      const id = key.slice(7);
      setPickedCanvases((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    // node:<workspaceId>:<id>
    const inPicked = pickedNodes.some((p) => nodeRefKey(p) === key);
    if (inPicked) {
      setPickedNodes((prev) => prev.filter((p) => nodeRefKey(p) !== key));
      return;
    }
    // Otherwise it's the page-selected node — clear the selection upstream.
    if (pageContext.some((p) => nodeRefKey(p) === key)) {
      onClearSelection?.();
    }
  }, [pickedNodes, pageContext, onClearSelection]);

  // Picker candidates, filtered by the search query.
  const query = pickerQuery.trim().toLowerCase();
  const canvasMatches = useMemo(
    () => workspaces.filter((w) => !query || w.name.toLowerCase().includes(query)).slice(0, PICKER_MAX_PER_GROUP),
    [workspaces, query],
  );
  const tagMatches = useMemo(
    () => tags.filter((tag) => !query || tag.name.toLowerCase().includes(query)).slice(0, PICKER_MAX_PER_GROUP),
    [tags, query],
  );
  const nodeMatches = useMemo(
    () => nodes
      .filter((n) => {
        if (!query) return true;
        return getNodeTitle(n).toLowerCase().includes(query);
      })
      .slice(0, PICKER_MAX_PER_GROUP),
    [nodes, query],
  );
  const pickerEmpty = canvasMatches.length === 0 && tagMatches.length === 0 && nodeMatches.length === 0;

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
    <div className="nodes-chat-dock" style={{ width }} onKeyDownCapture={handleKeyCapture}>
      <ChatPanel
        agentScope={GLOBAL_SCOPE}
        allWorkspaces={workspaces}
        contextNodes={contextNodes}
        contextTags={pickedTags}
        contextCanvases={pickedCanvases}
        onRemoveContext={handleRemoveContext}
        onClose={onClose}
        onResizeStart={onBeginResize}
        onOpenAppSettings={onOpenAppSettings}
      />

      {pickerOpen && (
        <>
          <div className="nodes-chat-picker__backdrop" onMouseDown={closePicker} />
          <div className="nodes-chat-picker" role="dialog" aria-label={t('workspaceNodes.chat.pickerTitle')}>
            <input
              ref={searchRef}
              className="nodes-chat-picker__search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder={t('workspaceNodes.chat.pickerPlaceholder')}
            />
            <div className="nodes-chat-picker__list">
              {pickerEmpty && <div className="nodes-chat-picker__empty">{t('workspaceNodes.chat.pickerEmpty')}</div>}

              {nodeMatches.length > 0 && (
                <div className="chat-mention-group-header">{t('workspaceNodes.chat.groupNodes')}</div>
              )}
              {nodeMatches.map((node) => (
                <button
                  key={`n-${getNodeWorkspaceId(node)}-${node.id}`}
                  className="chat-mention-item"
                  onMouseDown={(e) => { e.preventDefault(); addNode(node); }}
                >
                  <span className="chat-mention-item-icon">
                    <MentionNodeIcon size={14} nodeType={node.type} />
                  </span>
                  <span className="chat-mention-item-label">{getNodeTitle(node)}</span>
                  {node.workspaceName && (
                    <span className="nodes-chat-picker__hint">{node.workspaceName}</span>
                  )}
                </button>
              ))}

              {tagMatches.length > 0 && (
                <div className="chat-mention-group-header">{t('workspaceNodes.chat.groupTags')}</div>
              )}
              {tagMatches.map((tag) => (
                <button
                  key={`t-${tag.id}`}
                  className="chat-mention-item"
                  onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                >
                  <span className="chat-mention-item-icon"><span className="chat-context-chip-hash">#</span></span>
                  <span className="chat-mention-item-label">{tag.name}</span>
                </button>
              ))}

              {canvasMatches.length > 0 && (
                <div className="chat-mention-group-header">{t('workspaceNodes.chat.groupCanvases')}</div>
              )}
              {canvasMatches.map((canvas) => (
                <button
                  key={`c-${canvas.id}`}
                  className="chat-mention-item"
                  onMouseDown={(e) => { e.preventDefault(); addCanvas(canvas); }}
                >
                  <span className="chat-mention-item-icon">
                    <MentionNodeIcon size={14} nodeType="workspace" />
                  </span>
                  <span className="chat-mention-item-label">{canvas.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
