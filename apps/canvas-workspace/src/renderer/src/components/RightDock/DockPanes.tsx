import {
  lazy,
  Suspense,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from 'react';
import { useI18n } from '../../i18n';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { AgentContextDomSelectionRef } from '../../types';
import { isTerminalTabId, type DockPreviewTab, type DockState, type DockStore } from './dock-store';
import { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';
import { CHAT_TAB_ID, dockPaneElementId, dockTabElementId } from './dock-tab-ids';
import type { ChatDeliveryReceipt } from '../chat/ChatTargetContext';

const skillWorkspaceName = (
  tab: Extract<DockPreviewTab, { kind: 'skill' }>,
  workspaces: WorkspaceEntry[],
): string | undefined => {
  if (tab.scope.level !== 'workspace') return undefined;
  const workspaceId = tab.scope.workspaceId;
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name;
};

const ArtifactTabView = lazy(() => import('../artifacts/ArtifactTabView').then((m) => ({ default: m.ArtifactTabView })));
const LinkTabView = lazy(() => import('../LinkDrawer').then((m) => ({ default: m.LinkTabView })));
const NodeDetailDockTab = lazy(() => import('./NodeDetailDockTab').then((m) => ({ default: m.NodeDetailDockTab })));
const CanvasPreview = lazy(() => import('./CanvasPreview').then((m) => ({ default: m.CanvasPreview })));
const SkillDetailDockTab = lazy(() => import('./SkillDetailDockTab').then((m) => ({ default: m.SkillDetailDockTab })));

interface Props {
  store: DockStore;
  state: DockState;
  activePaneId: string | null;
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
}

export const DockPanes = ({
  store,
  state,
  activePaneId,
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
  // A tab that left the dock took its guest with it — closed, or swapped out
  // when the workspace changed link sessions. Dropping its id restores the
  // "mount on first visible" rule for the NEXT time it appears; without this
  // the set only ever grew, so returning to a workspace remounted every tab
  // the user had ever looked at, in one commit — the exact cold-start burst
  // this gate exists to prevent.
  const mountedLinkTabsRef = useRef(new Set<string>());
  const liveTabIds = new Set(state.tabs.map((tab) => tab.id));
  for (const id of mountedLinkTabsRef.current) {
    if (!liveTabIds.has(id)) mountedLinkTabsRef.current.delete(id);
  }
  if (activePaneId) mountedLinkTabsRef.current.add(activePaneId);
  if (splitTabId) mountedLinkTabsRef.current.add(splitTabId);
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
      {state.tabs.map((tab) => (
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
                  store.close(tab.id);
                }}
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
          ) : (
            <Suspense fallback={null}>
              <LinkTabView
                url={tab.url}
                title={tab.title}
                tabId={tab.id}
                mountWebview={mountedLinkTabsRef.current.has(tab.id)}
                active={tab.id === activePaneId || tab.id === splitTabId}
                activeWorkspaceId={activeWorkspaceId}
                onActivate={() => store.activate(tab.id)}
                onTitleChange={(title) => store.setTitle(tab.id, title)}
                onFaviconChange={(faviconUrl) => store.setFavicon(tab.id, faviconUrl)}
                onNavigate={(url) => store.navigateLink(tab.id, url)}
                onGuestNavigate={(url) => store.syncLinkUrl(tab.id, url)}
                onAddToReference={pinUrlReference}
                onAddDomSelectionToChat={(selection) => onAddDomSelectionToChat(activeWorkspaceId, selection)}
                onOpenLink={(url, options) => store.openLink(url, {
                  ...options,
                  openerTabId: tab.id,
                })}
                onRequestClose={() => store.close(tab.id)}
              />
            </Suspense>
          )}
        </div>
      ))}
    </div>
  );
};
