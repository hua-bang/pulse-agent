import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from 'react';
import { useI18n } from '../../../../i18n';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextTabRef,
  CanvasNode,
} from '../../../../types';
import { isTerminalTabId, type DockPreviewTab, type DockState, type DockStore } from './dock-store';
import { linkPaneKey } from './dock-link-tabs';
import { isDockTabPresented } from '../../../../shared/dock/dock-split-state';
import { CHAT_TAB_ID, dockPaneElementId, dockTabElementId, mcpAppDockHostElementId } from '../../../../shared/dock/dock-tab-ids';
import type { DockComparisonPair } from './dock-types';
import type { ChatDeliveryReceipt } from '../../../chat';
import { focusActiveDockTarget } from './dock-browser-commands';
import { buildDockTabRefs } from '../../../../shared/dock/tabRefs';
import { TabChatAction } from './TabChatAction';

const skillWorkspaceName = (
  tab: Extract<DockPreviewTab, { kind: 'skill' }>,
  workspaces: WorkspaceEntry[],
): string | undefined => {
  if (tab.scope.level !== 'workspace') return undefined;
  const workspaceId = tab.scope.workspaceId;
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name;
};

const ArtifactTabView = lazy(() => import('../../../artifacts/tab').then((m) => ({ default: m.ArtifactTabView })));
const LinkTabView = lazy(() => import('../LinkDrawer').then((m) => ({ default: m.LinkTabView })));
const NodeDetailDockTab = lazy(() => import('./NodeDetailDockTab').then((m) => ({ default: m.NodeDetailDockTab })));
const CanvasPreview = lazy(() => import('./CanvasPreview').then((m) => ({ default: m.CanvasPreview })));
const SkillDetailDockTab = lazy(() => import('./SkillDetailDockTab').then((m) => ({ default: m.SkillDetailDockTab })));

interface Props {
  store: DockStore;
  state: DockState;
  activePaneId: string | null;
  /** Whether the dock is actually on screen. The selected tab remains in
   *  state while collapsed, but its guest must be treated as background. */
  dockVisible: boolean;
  splitTabIds?: Readonly<DockComparisonPair>;
  chatTabEnabled: boolean;
  canvasTabEditingAllowed?: boolean;
  onCanvasNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onCanvasSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  splitContentWidth: number;
  splitDividerWidth: number;
  splitMinContentWidth?: number;
  splitMaxContentWidth?: number;
  onDividerMouseDown: MouseEventHandler;
  onDividerKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  setChatHost: (element: HTMLDivElement | null) => void;
  setTerminalHost: (element: HTMLDivElement | null) => void;
  setMcpAppHost?: (instanceId: string, element: HTMLDivElement | null) => void;
  terminalHostMounted: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
  pinUrlReference: (url: string, title?: string) => void;
  onAddDomSelectionToChat: (workspaceId: string, selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ) => Promise<boolean>;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  onStartSkillChat?: (workspaceId: string, skillName: string) => void;
  onCloseTab?: (tabId: string) => void;
}

const isPaneVisible = (
  id: string,
  dockVisible: boolean,
  activePaneId: string | null,
  splitTabIds: Readonly<DockComparisonPair> | undefined,
): boolean => dockVisible && isDockTabPresented(activePaneId, splitTabIds, id);

const splitPaneClass = (
  id: string,
  splitTabIds: Readonly<DockComparisonPair> | undefined,
): string => {
  const index = splitTabIds?.indexOf(id) ?? -1;
  if (index === 0) return ' right-dock__pane--split-left';
  if (index === 1) return ' right-dock__pane--split-right';
  return '';
};

const renderTabChatAction = (
  tab: AgentContextTabRef | undefined,
  targetWorkspaceId: string,
  onAddToChat: NonNullable<Props['onAddTabToChat']>,
) => tab ? (
  <div className="right-dock__pane-chat-action">
    <TabChatAction tab={tab} targetWorkspaceId={targetWorkspaceId} onAddToChat={onAddToChat} />
  </div>
) : null;

const McpAppDockHost = ({
  instanceId,
  setHost,
}: {
  instanceId: string;
  setHost: NonNullable<Props['setMcpAppHost']>;
}) => {
  const registerHost = useCallback(
    (element: HTMLDivElement | null) => setHost(instanceId, element),
    [instanceId, setHost],
  );
  return <div ref={registerHost} id={mcpAppDockHostElementId(instanceId)} className="right-dock__mcp-app-host" />;
};

// Link-tab webviews mount only after their first visible activation, then stay
// mounted so switching back preserves navigation, scroll, forms, and sign-in.
// The mounted key is workspace-qualified and pruned after close/eviction; the
// store workspace id, not the incoming prop, owns it during transition renders.
export const DockPanes = ({
  store,
  state,
  activePaneId,
  dockVisible,
  splitTabIds,
  chatTabEnabled,
  canvasTabEditingAllowed = false,
  onCanvasNodesChange,
  onCanvasSelectionChange,
  splitContentWidth,
  splitDividerWidth,
  splitMinContentWidth,
  splitMaxContentWidth,
  onDividerMouseDown,
  onDividerKeyDown,
  setChatHost,
  setTerminalHost,
  setMcpAppHost = () => undefined,
  terminalHostMounted,
  activeWorkspaceId,
  workspaces,
  onOpenNodePage,
  pinUrlReference,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments = async () => false,
  onAddTabToChat = async () => ({ status: 'unavailable', target: null }),
  onStartSkillChat = () => undefined,
  onCloseTab = (tabId) => store.close(tabId),
}: Props) => {
  const { t } = useI18n();
  const splitActive = Boolean(splitTabIds);
  const paneVisible = (id: string) => isPaneVisible(id, dockVisible, activePaneId, splitTabIds);
  const paneClass = (id: string) => splitPaneClass(id, splitTabIds);
  const chatVisible = chatTabEnabled && paneVisible(CHAT_TAB_ID);
  const visibleTerminalId = state.terminalTabs.find((tab) => paneVisible(tab.id))?.id;
  const terminalVisible = terminalHostMounted && Boolean(visibleTerminalId);
  const terminalPanelAvailable = state.terminalTabs.length > 0;
  const labelledTerminalTabId = activePaneId && isTerminalTabId(activePaneId)
    ? activePaneId
    : visibleTerminalId
      ? visibleTerminalId
      : state.activeTerminalTabId ?? state.terminalTabs[0]?.id;
  const mountedLinkTabsRef = useRef(new Set<string>());
  // Key against the STORE's active workspace, not the `activeWorkspaceId`
  // prop. `RightDock` forwards the prop to `setActiveWorkspace` in a layout
  // effect, so there is one render where the prop has already advanced to the
  // new workspace while `state` still describes the old one. Keying off the
  // prop there rewrites every live key, prunes the real ones as "not live",
  // and the retained panes that arrive on the next render come back
  // unmounted — the guests die and retention silently does nothing.
  // Confirmed on a real workspace switch.
  const ownerWorkspaceId = state.activeTerminalWorkspaceId;
  const tabRefsById = new Map(buildDockTabRefs(state, ownerWorkspaceId).map(tab => [tab.id, tab]));
  const liveKeys = new Set([
    ...state.tabs.map((tab) => linkPaneKey(ownerWorkspaceId, tab.id)),
    ...state.retainedLinkTabs.flatMap(
      (entry) => entry.tabs.map((tab) => linkPaneKey(entry.workspaceId, tab.id)),
    ),
  ]);
  for (const key of mountedLinkTabsRef.current) {
    if (!liveKeys.has(key)) mountedLinkTabsRef.current.delete(key);
  }
  if (dockVisible && activePaneId) {
    mountedLinkTabsRef.current.add(linkPaneKey(ownerWorkspaceId, activePaneId));
  }
  for (const splitTabId of splitTabIds ?? []) {
    if (dockVisible) mountedLinkTabsRef.current.add(linkPaneKey(ownerWorkspaceId, splitTabId));
  }
  const isMounted = (workspaceId: string, tabId: string): boolean => (
    mountedLinkTabsRef.current.has(linkPaneKey(workspaceId, tabId))
  );
  const linkPanes = [
    ...state.tabs
      .filter((tab): tab is Extract<DockPreviewTab, { kind: 'link' }> => tab.kind === 'link')
      .map((tab) => ({ workspaceId: ownerWorkspaceId, tab, live: true })),
    ...state.retainedLinkTabs.flatMap(
      (entry) => entry.tabs.map((tab) => ({ workspaceId: entry.workspaceId, tab, live: false })),
    ),
  ].sort((a, b) => (
    linkPaneKey(a.workspaceId, a.tab.id) < linkPaneKey(b.workspaceId, b.tab.id) ? -1 : 1
  ));
  const style = {
    '--split-content-width': `${splitContentWidth}px`,
    '--split-divider-width': `${splitDividerWidth}px`,
  } as CSSProperties;
  return (
    <div className="right-dock__panes" data-split={splitActive} style={style}>
      <div
        ref={setChatHost}
        id={chatTabEnabled ? dockPaneElementId(CHAT_TAB_ID) : undefined}
        role={chatTabEnabled ? 'tabpanel' : undefined}
        aria-labelledby={chatTabEnabled ? dockTabElementId(CHAT_TAB_ID) : undefined}
        aria-hidden={chatTabEnabled ? !chatVisible : true}
        className={`right-dock__pane right-dock__pane--chat${chatVisible ? ' right-dock__pane--active' : ''}${paneClass(CHAT_TAB_ID)}`}
        data-focused={activePaneId === 'chat'}
        onFocusCapture={() => {
          if (splitActive) store.activate(CHAT_TAB_ID);
        }}
        onMouseDown={() => {
          if (splitActive) store.activate(CHAT_TAB_ID);
        }}
      />
      {splitActive && (
        <div
          className="right-dock__split-divider"
          onMouseDown={onDividerMouseDown}
          onKeyDown={onDividerKeyDown}
          tabIndex={0}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('rightDock.resizeSplitView')}
          aria-valuemin={splitMinContentWidth}
          aria-valuemax={splitMaxContentWidth}
          aria-valuenow={splitContentWidth}
        />
      )}
      {terminalHostMounted && (
        <div
          id={terminalPanelAvailable ? dockPaneElementId(labelledTerminalTabId ?? 'terminal') : undefined}
          role={terminalPanelAvailable ? 'tabpanel' : undefined}
          aria-labelledby={terminalPanelAvailable && labelledTerminalTabId
            ? dockTabElementId(labelledTerminalTabId)
            : undefined}
          aria-hidden={!terminalVisible}
          className={`right-dock__pane right-dock__pane--terminal${terminalVisible ? ' right-dock__pane--active' : ''}${visibleTerminalId ? paneClass(visibleTerminalId) : ''}`}
          data-focused={state.terminalTabs.some((tab) => tab.id === activePaneId)}
          onFocusCapture={() => {
            if (splitActive && visibleTerminalId) store.activate(visibleTerminalId);
          }}
          onMouseDown={() => {
            if (splitActive && visibleTerminalId) store.activate(visibleTerminalId);
          }}
        >
          <div
            ref={setTerminalHost}
            className="right-dock__terminal-host"
          />
        </div>
      )}
      {state.tabs.filter((tab) => tab.kind !== 'link').map((tab) => {
        const visible = paneVisible(tab.id);
        return (
          <div
            key={tab.id}
            id={dockPaneElementId(tab.id)}
            role="tabpanel"
            aria-labelledby={dockTabElementId(tab.id)}
            aria-hidden={!visible}
            className={`right-dock__pane${visible ? ' right-dock__pane--active' : ''}${paneClass(tab.id)}`}
            data-focused={tab.id === activePaneId}
            onFocusCapture={() => {
              if (splitActive) store.activate(tab.id);
            }}
            onMouseDown={() => {
              if (splitActive) store.activate(tab.id);
            }}
          >
          {tab.kind === 'artifact' ? (
            <>
              {renderTabChatAction(tabRefsById.get(tab.id), activeWorkspaceId, onAddTabToChat)}
              <Suspense fallback={null}>
                <ArtifactTabView workspaceId={tab.workspaceId} artifactId={tab.artifactId} onTitleChange={(title) => store.setTitle(tab.id, title)} />
              </Suspense>
            </>
          ) : tab.kind === 'node-detail' ? (
            <Suspense fallback={null}>
              <NodeDetailDockTab
                workspaceId={tab.workspaceId}
                nodeId={tab.nodeId}
                tabRef={tabRefsById.get(tab.id)}
                targetWorkspaceId={activeWorkspaceId}
                onAddTabToChat={onAddTabToChat}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
                onOpenPage={() => {
                  onOpenNodePage(tab.workspaceId, tab.nodeId);
                }}
                onClose={() => store.close(tab.id)}
              />
            </Suspense>
          ) : tab.kind === 'canvas' ? (
            <Suspense fallback={null}>
              <CanvasPreview
                workspaceId={tab.workspaceId}
                canvasName={tab.title}
                rootFolder={workspaces.find((workspace) => workspace.id === tab.workspaceId)?.rootFolder}
                tabRef={tabRefsById.get(tab.id)}
                targetWorkspaceId={activeWorkspaceId}
                onAddTabToChat={onAddTabToChat}
                editingAllowed={canvasTabEditingAllowed}
                active={visible}
                onNodesChange={onCanvasNodesChange}
                onSelectionChange={onCanvasSelectionChange}
                onAddDomSelectionToChat={(selection) => onAddDomSelectionToChat(tab.workspaceId, selection)}
                onSubmitDomReviewComments={onSubmitDomReviewComments}
              />
            </Suspense>
          ) : tab.kind === 'skill' ? (
            <Suspense fallback={null}>
              <SkillDetailDockTab
                tab={tab}
                activeWorkspaceId={activeWorkspaceId}
                workspaceName={skillWorkspaceName(tab, workspaces)}
                onStartChat={onStartSkillChat}
                onPromoted={(skill) => {
                  store.close(tab.id);
                  store.openSkill({ level: 'global' }, skill);
                }}
              />
            </Suspense>
          ) : tab.kind === 'mcp-app' ? (
            <McpAppDockHost instanceId={tab.instanceId} setHost={setMcpAppHost} />
          ) : null}
          </div>
        );
      })}
      {/* ONE list for every web tab, live and retained, in a stable
          key order.

          Both properties are load-bearing. React remounts a component that
          moves between two sibling arrays, and Chromium reloads a <webview>
          whose element is moved within its parent — either one destroys the
          guest and its page state, which is exactly what retention exists to
          preserve. Sorting by the workspace-qualified key keeps a tab in the
          same slot whether it is live or retained, so a workspace switch
          rewrites attributes and nothing else. Verified on a real switch:
          without this the page silently reloaded even though the pane stayed
          "mounted".

          Retained panes carry no pane id or tabpanel role (no tab control
          points at them, and tab ids are not unique across workspaces), and
          their callbacks route to the workspace-scoped store method — a
          hidden guest that navigates must not rename a same-id tab in the
          workspace the user is actually looking at. */}
      {linkPanes.map(({ workspaceId, tab, live }) => {
        const visible = live && paneVisible(tab.id);
        return (
          <div
            key={linkPaneKey(workspaceId, tab.id)}
            id={live ? dockPaneElementId(tab.id) : undefined}
            role={live ? 'tabpanel' : undefined}
            aria-labelledby={live ? dockTabElementId(tab.id) : undefined}
            aria-hidden={!visible}
            className={`right-dock__pane${visible ? ' right-dock__pane--active' : ''}${live ? paneClass(tab.id) : ''}${live ? '' : ' right-dock__pane--retained'}`}
            data-focused={live && tab.id === activePaneId}
            onFocusCapture={() => {
              if (live && splitActive) store.activate(tab.id);
            }}
            onMouseDown={() => {
              if (live && splitActive) store.activate(tab.id);
            }}
          >
            <Suspense fallback={null}>
              <LinkTabView
                url={tab.url}
                title={tab.title}
                tabId={tab.id}
                mountWebview={isMounted(workspaceId, tab.id)}
                active={visible}
                activeWorkspaceId={workspaceId}
                onActivate={live ? () => store.activate(tab.id) : undefined}
                onTitleChange={(title) => (live
                  ? store.setTitle(tab.id, title)
                  : store.updateRetainedLinkTab(workspaceId, tab.id, { title }))}
                onFaviconChange={(faviconUrl) => (live
                  ? store.setFavicon(tab.id, faviconUrl)
                  : store.updateRetainedLinkTab(workspaceId, tab.id, { faviconUrl }))}
                onNavigate={(url) => (live
                  ? store.navigateLink(tab.id, url)
                  : store.updateRetainedLinkTab(workspaceId, tab.id, { url }))}
                onGuestNavigate={(url) => (live
                  ? store.syncLinkUrl(tab.id, url)
                  : store.updateRetainedLinkTab(workspaceId, tab.id, { url }))}
                onAddToReference={pinUrlReference}
                onAddDomSelectionToChat={(selection) => onAddDomSelectionToChat(workspaceId, selection)}
                tabRef={live ? tabRefsById.get(tab.id) : undefined}
                targetWorkspaceId={activeWorkspaceId}
                onAddTabToChat={onAddTabToChat}
                onOpenLink={(url, options) => {
                  if (!live) {
                    store.openLinkInWorkspace(workspaceId, url, options);
                    return;
                  }
                  store.openLink(url, { ...options, openerTabId: tab.id });
                  if (!options?.background) focusActiveDockTarget(store);
                }}
                onRequestClose={live ? () => onCloseTab(tab.id) : () => undefined}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
};
