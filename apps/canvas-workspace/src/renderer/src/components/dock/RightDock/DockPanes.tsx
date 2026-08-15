import {
  lazy,
  Suspense,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from 'react';
import { useI18n } from '../../../i18n';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextTabRef,
  CanvasNode,
} from '../../../types';
import { isTerminalTabId, type DockPreviewTab, type DockState, type DockStore } from './dock-store';
import { linkPaneKey } from './dock-link-tabs';
import { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';
import { CHAT_TAB_ID, dockPaneElementId, dockTabElementId } from './dock-tab-ids';
import type { ChatDeliveryReceipt } from '../../chat/ChatTargetContext';
import { focusActiveDockTarget } from './dock-browser-commands';
import { buildDockTabRefs } from './tabRefs';
import { TabChatAction } from './TabChatAction';

const skillWorkspaceName = (
  tab: Extract<DockPreviewTab, { kind: 'skill' }>,
  workspaces: WorkspaceEntry[],
): string | undefined => {
  if (tab.scope.level !== 'workspace') return undefined;
  const workspaceId = tab.scope.workspaceId;
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name;
};

const ArtifactTabView = lazy(() => import('../../artifacts/ArtifactTabView').then((m) => ({ default: m.ArtifactTabView })));
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
  splitTabId?: string;
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

export const DockPanes = ({
  store,
  state,
  activePaneId,
  dockVisible,
  splitTabId,
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
  const splitActive = Boolean(splitTabId);
  const chatVisible = chatTabEnabled && isDockChatVisible(state);
  const terminalVisible = terminalHostMounted && isDockTerminalVisible(state);
  const terminalPanelAvailable = state.terminalTabs.length > 0;
  const labelledTerminalTabId = activePaneId && isTerminalTabId(activePaneId)
    ? activePaneId
    : splitTabId && isTerminalTabId(splitTabId)
      ? splitTabId
      : state.activeTerminalTabId ?? state.terminalTabs[0]?.id;
  // Lazy-mount link-tab webviews. Every tab's pane renders stacked (inactive
  // ones are `visibility: hidden`), so mounting each LinkTabView's <webview>
  // unconditionally spins up a guest process + navigation per restored tab on
  // the cold-start critical path — N heavy pages competing at the worst
  // moment. Mount a tab's webview only once it has been VISIBLE (active or
  // split); after that it stays mounted, so switching back never reloads.
  // Agent tools that activate a tab before reading it already poll for the
  // webview registration (main/webview/ensure-operable.ts).
  // A closed tab drops its key and restores the "mount on first visible" rule
  // if the user opens it again. Link tabs are global, so their keys survive a
  // Workspace switch and the live guest keeps its page state.
  const mountedLinkTabsRef = useRef(new Set<string>());
  // The WebView registration still uses the active Workspace as its renderer
  // mount route. That is a routing detail, not Link Tab ownership.
  const ownerWorkspaceId = state.activeTerminalWorkspaceId;
  const tabRefsById = new Map(buildDockTabRefs(state, ownerWorkspaceId).map(tab => [tab.id, tab]));
  const renderTabChatAction = (tabRef?: AgentContextTabRef) => tabRef ? (
    <div className="right-dock__pane-chat-action">
      <TabChatAction
        tab={tabRef}
        targetWorkspaceId={activeWorkspaceId}
        onAddToChat={onAddTabToChat}
      />
    </div>
  ) : null;
  const liveKeys = new Set(
    state.tabs
      .filter((tab) => tab.kind === 'link')
      .map((tab) => linkPaneKey(tab.id)),
  );
  for (const key of mountedLinkTabsRef.current) {
    if (!liveKeys.has(key)) mountedLinkTabsRef.current.delete(key);
  }
  if (dockVisible && activePaneId) {
    mountedLinkTabsRef.current.add(linkPaneKey(activePaneId));
  }
  if (dockVisible && splitTabId) {
    mountedLinkTabsRef.current.add(linkPaneKey(splitTabId));
  }
  const isMounted = (tabId: string): boolean => (
    mountedLinkTabsRef.current.has(linkPaneKey(tabId))
  );
  const linkPanes = state.tabs
    .filter((tab): tab is Extract<DockPreviewTab, { kind: 'link' }> => tab.kind === 'link');
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
        className={`right-dock__pane right-dock__pane--chat${chatVisible ? ' right-dock__pane--active' : ''}${splitActive ? ' right-dock__pane--split-chat' : ''}`}
        data-focused={activePaneId === 'chat'}
        onFocusCapture={() => {
          if (splitActive) store.openChat();
        }}
        onMouseDown={() => {
          if (splitActive) store.openChat();
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
          className={`right-dock__pane right-dock__pane--terminal${terminalVisible ? ' right-dock__pane--active' : ''}${splitTabId && isTerminalTabId(splitTabId) ? ' right-dock__pane--split-content' : ''}`}
          data-focused={state.terminalTabs.some((tab) => tab.id === activePaneId)}
          onFocusCapture={() => {
            if (splitTabId && isTerminalTabId(splitTabId)) store.activate(splitTabId);
          }}
          onMouseDown={() => {
            if (splitTabId && isTerminalTabId(splitTabId)) store.activate(splitTabId);
          }}
        >
          <div
            ref={setTerminalHost}
            className="right-dock__terminal-host"
          />
        </div>
      )}
      {state.tabs.filter((tab) => tab.kind !== 'link').map((tab) => (
        <div
          key={tab.id}
          id={dockPaneElementId(tab.id)}
          role="tabpanel"
          aria-labelledby={dockTabElementId(tab.id)}
          aria-hidden={tab.id !== activePaneId && tab.id !== splitTabId}
          className={`right-dock__pane${tab.id === activePaneId || tab.id === splitTabId ? ' right-dock__pane--active' : ''}${tab.id === splitTabId ? ' right-dock__pane--split-content' : ''}`}
          data-focused={tab.id === activePaneId}
          onFocusCapture={() => {
            if (tab.id === splitTabId) store.activate(tab.id);
          }}
          onMouseDown={() => {
            if (tab.id === splitTabId) store.activate(tab.id);
          }}
        >
          {tab.kind === 'artifact' ? (
            <>
              {renderTabChatAction(tabRefsById.get(tab.id))}
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
                active={dockVisible && (tab.id === activePaneId || tab.id === splitTabId)}
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
          ) : null}
        </div>
      ))}
      {/* Keep one stable list of global Link Tab panes. Moving a webview
          between sibling lists remounts Chromium guests; keeping the same
          keyed list across Workspace switches preserves page state. */}
      {linkPanes.map((tab) => {
        const visible = dockVisible && (tab.id === activePaneId || tab.id === splitTabId);
        return (
          <div
            key={linkPaneKey(tab.id)}
            id={dockPaneElementId(tab.id)}
            role="tabpanel"
            aria-labelledby={dockTabElementId(tab.id)}
            aria-hidden={!visible}
            className={`right-dock__pane${visible ? ' right-dock__pane--active' : ''}${tab.id === splitTabId ? ' right-dock__pane--split-content' : ''}`}
            data-focused={tab.id === activePaneId}
            onFocusCapture={() => {
              if (tab.id === splitTabId) store.activate(tab.id);
            }}
            onMouseDown={() => {
              if (tab.id === splitTabId) store.activate(tab.id);
            }}
          >
            <Suspense fallback={null}>
              <LinkTabView
                url={tab.url}
                title={tab.title}
                tabId={tab.id}
                mountWebview={isMounted(tab.id)}
                active={visible}
                activeWorkspaceId={ownerWorkspaceId}
                onActivate={() => store.activate(tab.id)}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
                onFaviconChange={(faviconUrl) => store.setFavicon(tab.id, faviconUrl)}
                onNavigate={(url) => store.navigateLink(tab.id, url)}
                onGuestNavigate={(url) => store.syncLinkUrl(tab.id, url)}
                onAddToReference={pinUrlReference}
                onAddDomSelectionToChat={(selection) => onAddDomSelectionToChat(ownerWorkspaceId, selection)}
                tabRef={tabRefsById.get(tab.id)}
                targetWorkspaceId={activeWorkspaceId}
                onAddTabToChat={onAddTabToChat}
                onOpenLink={(url, options) => {
                  store.openLink(url, { ...options, openerTabId: tab.id });
                  if (!options?.background) focusActiveDockTarget(store);
                }}
                onRequestClose={() => onCloseTab(tab.id)}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
};
