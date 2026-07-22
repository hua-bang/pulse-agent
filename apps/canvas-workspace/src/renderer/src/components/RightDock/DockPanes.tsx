import { lazy, Suspense, useRef, type CSSProperties, type MouseEventHandler } from 'react';
import { useI18n } from '../../i18n';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { AgentContextDomSelectionRef } from '../../types';
import { isTerminalTabId, type DockState, type DockStore } from './dock-store';
import { isDockChatVisible, isDockTerminalVisible } from './dock-visibility';

const ArtifactTabView = lazy(() => import('../artifacts/ArtifactTabView').then((m) => ({ default: m.ArtifactTabView })));
const LinkTabView = lazy(() => import('../LinkDrawer').then((m) => ({ default: m.LinkTabView })));
const NodeDetailDockTab = lazy(() => import('./NodeDetailDockTab').then((m) => ({ default: m.NodeDetailDockTab })));
const CanvasPreview = lazy(() => import('./CanvasPreview').then((m) => ({ default: m.CanvasPreview })));

interface Props {
  store: DockStore;
  state: DockState;
  activePaneId: string | null;
  splitTabId?: string;
  splitContentWidth: number;
  splitDividerWidth: number;
  onDividerMouseDown: MouseEventHandler;
  setChatHost: (element: HTMLDivElement | null) => void;
  setTerminalHost: (element: HTMLDivElement | null) => void;
  terminalHostMounted: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onOpenNodePage: (workspaceId: string, nodeId: string) => void;
  pinUrlReference: (url: string, title?: string) => void;
  onAddDomSelectionToChat: (workspaceId: string, selection: AgentContextDomSelectionRef) => void;
}

export const DockPanes = ({
  store,
  state,
  activePaneId,
  splitTabId,
  splitContentWidth,
  splitDividerWidth,
  onDividerMouseDown,
  setChatHost,
  setTerminalHost,
  terminalHostMounted,
  activeWorkspaceId,
  workspaces,
  onOpenNodePage,
  pinUrlReference,
  onAddDomSelectionToChat,
}: Props) => {
  const { t } = useI18n();
  const splitActive = Boolean(splitTabId);
  // Lazy-mount link-tab webviews. Every tab's pane renders stacked (inactive
  // ones are `visibility: hidden`), so mounting each LinkTabView's <webview>
  // unconditionally spins up a guest process + navigation per restored tab on
  // the cold-start critical path — N heavy pages competing at the worst
  // moment. Mount a tab's webview only once it has been VISIBLE (active or
  // split); after that it stays mounted, so switching back never reloads.
  // Agent tools that activate a tab before reading it already poll for the
  // webview registration (main/webview/ensure-operable.ts).
  const mountedLinkTabsRef = useRef(new Set<string>());
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
        className={`right-dock__pane right-dock__pane--chat${isDockChatVisible(state) ? ' right-dock__pane--active' : ''}${splitActive ? ' right-dock__pane--split-chat' : ''}`}
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
          role="separator"
          aria-orientation="vertical"
          aria-label={t('rightDock.resizeSplitView')}
        />
      )}
      {terminalHostMounted && (
        <div
          className={`right-dock__pane right-dock__pane--terminal${isDockTerminalVisible(state) ? ' right-dock__pane--active' : ''}${splitTabId && isTerminalTabId(splitTabId) ? ' right-dock__pane--split-content' : ''}`}
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
                onRequestClose={() => store.close(tab.id)}
              />
            </Suspense>
          )}
        </div>
      ))}
    </div>
  );
};
