import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useClickOutside } from '../../hooks/useClickOutside';
import { copyTextToClipboard } from '../../utils/clipboard';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { isReferenceableNode } from '../../utils/referenceNodes';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useI18n } from '../../i18n';
import {
  DEFAULT_REFERENCE_DRAWER_WIDTH,
  MAX_REFERENCE_DRAWER_WIDTH,
  MIN_REFERENCE_DRAWER_WIDTH,
  PICKER_NODE_TYPE_GROUP_ORDER,
  REFERENCE_SEARCH_DEBOUNCE_MS,
} from './constants';
import type { NodeReferenceEntry, ReferenceEntry, ReferencePickerMode } from './types';
import {
  getNodeReferenceId,
  getReferenceId,
  getUrlHostname,
  isUrlReference,
  normalizeReferenceUrl,
} from './utils';

interface UseReferenceDrawerStateParams {
  open: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  references: ReferenceEntry[];
  nodes: CanvasNode[];
  allNodes: Record<string, CanvasNode[]>;
  onAddReference: (workspaceId: string, nodeId: string) => void;
  onAddUrlReference: (url: string, title?: string) => void;
  onWorkspaceNodesRequest: (workspaceId: string) => void;
}

export const useReferenceDrawerState = ({
  open,
  activeWorkspaceId,
  workspaces,
  references,
  nodes,
  allNodes,
  onAddReference,
  onAddUrlReference,
  onWorkspaceNodesRequest,
}: UseReferenceDrawerStateParams) => {
  const { t } = useI18n();
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_REFERENCE_DRAWER_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(open);
  const [pickerOpen, setPickerOpen] = useState<ReferencePickerMode | null>(null);
  const [externalWorkspaceId, setExternalWorkspaceId] = useState<string | undefined>();
  const [urlEditorOpen, setUrlEditorOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const urlEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsActive(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsActive(false);
    const timer = window.setTimeout(() => setShouldRender(false), 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchDraft.trim().toLowerCase());
    }, REFERENCE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useClickOutside(pickerRef, () => setPickerOpen(null), !!pickerOpen);
  useClickOutside(urlEditorRef, () => setUrlEditorOpen(false), urlEditorOpen);

  useEffect(() => {
    if (!externalWorkspaceId || externalWorkspaceId === activeWorkspaceId) return;
    onWorkspaceNodesRequest(externalWorkspaceId);
  }, [activeWorkspaceId, externalWorkspaceId, onWorkspaceNodesRequest]);

  const drawerStyle = useMemo(
    () => ({
      '--reference-drawer-width': `${drawerWidth}px`,
    }) as CSSProperties,
    [drawerWidth],
  );

  const handleResizeStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = drawerWidth;
    setIsResizing(true);

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = startWidth + event.clientX - startX;
      setDrawerWidth(Math.min(MAX_REFERENCE_DRAWER_WIDTH, Math.max(MIN_REFERENCE_DRAWER_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [drawerWidth]);

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of workspaces) map.set(workspace.id, workspace.name);
    return map;
  }, [workspaces]);

  const externalWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.id !== activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (externalWorkspaceId && externalWorkspaces.some((workspace) => workspace.id === externalWorkspaceId)) return;
    setExternalWorkspaceId(externalWorkspaces[0]?.id);
  }, [externalWorkspaceId, externalWorkspaces]);

  const currentNodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const getNodeByEntry = useCallback(
    (entry: NodeReferenceEntry) => {
      if (entry.workspaceId === activeWorkspaceId) return currentNodeById.get(entry.nodeId);
      return (allNodes[entry.workspaceId] ?? []).find((node) => node.id === entry.nodeId);
    },
    [activeWorkspaceId, allNodes, currentNodeById],
  );

  const referenced = useMemo(() => {
    const set = new Set<string>();
    for (const entry of references) {
      if (!isUrlReference(entry)) set.add(getReferenceId(entry));
    }
    return set;
  }, [references]);

  const eligibleCurrentNodes = useMemo(() => (
    nodes
      .filter((node) => !referenced.has(getNodeReferenceId(activeWorkspaceId, node.id)))
      .filter(isReferenceableNode)
  ), [activeWorkspaceId, nodes, referenced]);

  const selectedExternalWorkspaceNodes = useMemo(
    () => (externalWorkspaceId ? allNodes[externalWorkspaceId] ?? [] : []),
    [allNodes, externalWorkspaceId],
  );

  const eligibleExternalNodes = useMemo(() => {
    if (!externalWorkspaceId) return [];
    return selectedExternalWorkspaceNodes
      .filter((node) => !referenced.has(getNodeReferenceId(externalWorkspaceId, node.id)))
      .filter(isReferenceableNode);
  }, [externalWorkspaceId, referenced, selectedExternalWorkspaceNodes]);

  const filterNodes = useCallback((items: CanvasNode[]) => {
    if (!debouncedSearch) return items;
    return items.filter((node) => {
      const label = getNodeDisplayLabel(node);
      const typeLabel = t(CANVAS_NODE_TYPE_LABEL_KEY[node.type]);
      return [label, node.type, typeLabel, node.id]
        .some((value) => value.toLowerCase().includes(debouncedSearch));
    });
  }, [debouncedSearch, t]);

  const pickableNodes = useMemo(
    () => filterNodes(pickerOpen === 'other' ? eligibleExternalNodes : eligibleCurrentNodes),
    [eligibleCurrentNodes, eligibleExternalNodes, filterNodes, pickerOpen],
  );

  const pickableNodeGroups = useMemo(() => {
    const map = new Map<CanvasNode['type'], CanvasNode[]>();
    for (const node of pickableNodes) {
      const list = map.get(node.type);
      if (list) list.push(node);
      else map.set(node.type, [node]);
    }

    return PICKER_NODE_TYPE_GROUP_ORDER
      .filter((type) => map.has(type))
      .map((type) => ({
        type,
        name: t(CANVAS_NODE_TYPE_LABEL_KEY[type]),
        nodes: map.get(type) ?? [],
      }));
  }, [pickableNodes, t]);

  const handleAddFromPicker = useCallback((nodeId: string) => {
    const workspaceId = pickerOpen === 'other' ? externalWorkspaceId : activeWorkspaceId;
    if (!workspaceId) return;
    onAddReference(workspaceId, nodeId);
    setPickerOpen(null);
  }, [activeWorkspaceId, externalWorkspaceId, onAddReference, pickerOpen]);

  const handleAddUrl = useCallback(() => {
    const normalized = normalizeReferenceUrl(urlDraft);
    if (!normalized) {
      setUrlError(t('reference.invalidUrl'));
      return;
    }
    onAddUrlReference(normalized, getUrlHostname(normalized) || normalized);
    setUrlDraft('');
    setUrlError(undefined);
    setUrlEditorOpen(false);
  }, [onAddUrlReference, t, urlDraft]);

  const openUrl = useCallback((url: string) => {
    void window.canvasWorkspace?.shell.openExternal(url);
  }, []);

  const copyUrl = useCallback((url: string) => {
    void copyTextToClipboard(url).catch(() => undefined);
  }, []);

  return {
    copyUrl,
    drawerStyle,
    drawerWidth,
    externalWorkspaceId,
    externalWorkspaces,
    getNodeByEntry,
    handleAddFromPicker,
    handleAddUrl,
    handleResizeStart,
    isActive,
    isResizing,
    openUrl,
    pickerOpen,
    pickerRef,
    pickableNodeGroups,
    pickableNodes,
    searchActive: debouncedSearch.length > 0,
    searchDraft,
    setExternalWorkspaceId,
    setPickerOpen,
    setSearchDraft,
    setUrlDraft,
    setUrlEditorOpen,
    setUrlError,
    shouldRender,
    urlDraft,
    urlEditorOpen,
    urlEditorRef,
    urlError,
    workspaceNameById,
    eligibleCurrentNodeCount: eligibleCurrentNodes.length,
  };
};
