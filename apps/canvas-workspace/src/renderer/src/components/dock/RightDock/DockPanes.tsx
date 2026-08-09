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
import type { AgentContextDomSelectionRef } from '../../../types';
import { isTerminalTabId, type DockPreviewTab, type DockState, type DockStore } from './dock-store';
import { linkPaneKey } from './dock-link-tabs';
import { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';
import { CHAT_TAB_ID, dockPaneElementId, dockTabElementId } from './dock-tab-ids';
import type { ChatDeliveryReceipt } from '../../chat/ChatTargetContext';
import { focusActiveDockTarget } from './dock-browser-commands';

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
  // A tab that left the dock took its guest with it — closed, or evicted past
  // the retention limit. Dropping its key restores the "mount on first
  // visible" rule for the NEXT time it appears; without this the set only
  // ever grew, so returning to a workspace remounted every tab the user had
  // ever looked at, in one commit — the exact cold-start burst this gate
  // exists to prevent. Keys are workspace-qualified: tab ids are derived from
  // the URL, so the same id can exist in two workspaces.
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
  if (dockVisible && splitTabId) {
    mountedLinkTabsRef.current.add(linkPaneKey(ownerWorkspaceId, splitTabId));
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
          <div ref={setTerminalHost} className="right-dock__terminal-host" />
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
            <Suspense fallback={null}>
              <ArtifactTabView workspaceId={tab.workspaceId} artifactId={tab.artifactId} onTitleChange={(title) => store.setTitle(tab.id, title)} />
            </Suspense>
          ) : tab.kind === 'node-detail' ? (
            <Suspense fallback={null}>
              <NodeDetailDockTab
                workspaceId={tab.workspaceId}
                nodeId={tab.nodeId}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
                onOpenPage={() => {
                  onOpenNodePage(tab.workspaceId, tab.nodeId);
                }}
                onClose={() => store.close(tab.id)}
              />
            </Suspense>
          ) : tab.kind === 'canvas' ? (
            <Suspense fallback={null}>
              <CanvasPreview workspaceId={tab.workspaceId} canvasName={tab.title} rootFolder={workspaces.find((workspace) => workspace.id === tab.workspaceId)?.rootFolder} />
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
        const visible = dockVisible
          && live
          && (tab.id === activePaneId || tab.id === splitTabId);
        return (
          <div
            key={linkPaneKey(workspaceId, tab.id)}
            id={live ? dockPaneElementId(tab.id) : undefined}
            role={live ? 'tabpanel' : undefined}
            aria-labelledby={live ? dockTabElementId(tab.id) : undefined}
            aria-hidden={!visible}
            className={`right-dock__pane${visible ? ' right-dock__pane--active' : ''}${live && tab.id === splitTabId ? ' right-dock__pane--split-content' : ''}${live ? '' : ' right-dock__pane--retained'}`}
            data-focused={live && tab.id === activePaneId}
            onFocusCapture={() => {
              if (live && tab.id === splitTabId) store.activate(tab.id);
            }}
            onMouseDown={() => {
              if (live && tab.id === splitTabId) store.activate(tab.id);
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
