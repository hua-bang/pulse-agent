/**
 * Right-dock preview for links intercepted from embedded webviews and iframes.
 * Each tab owns a sandboxed <webview>; exact URLs dedupe while distinct links
 * stay open. RightDock owns tab chrome; this view owns page actions and title.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { useInitialWebviewLoadSlot } from '../EmbeddedBrowser/useInitialWebviewLoadSlot';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { classifyLoadError, loadErrorDetail } from '../EmbeddedBrowser/load-error';
import { AddressSuggestionList } from './AddressSuggestions';
import { LinkTabLoadError } from './LinkTabLoadError';
import { PageContextMenu } from './PageContextMenu';
import { FindInPageBar } from './FindInPageBar';
import { InspectIcon, ReferenceIcon } from './icons';
import { useAddressBar } from './useAddressBar';
import { useFindInPage } from './useFindInPage';
import { usePageContextMenu } from './usePageContextMenu';
import { focusDockPageOrRequest, useDockPageFocus } from './useDockPageFocus';
import { useWebviewRegistration } from '../../node-bodies/IframeNodeBody/useWebviewRegistration';
import { useWebviewRestore } from '../../node-bodies/IframeNodeBody/useWebviewDiscard';
import {
  useDockWebviewBackgroundLifecycle,
  useDockWebviewDiscard,
} from './useDockWebviewLifecycle';
import {
  dockPageKeyFromFocusEvent,
  FIND_IN_DOCK_TAB_EVENT,
  FOCUS_DOCK_ADDRESS_EVENT,
  RELOAD_DOCK_TAB_EVENT,
} from '../RightDock/dock-browser-commands';
import { pickFaviconUrl } from "../../node-bodies/IframeNodeBody/utils";
import { useAppShell } from '../../shell/AppShellProvider';
import type { AgentContextDomSelectionRef, AgentContextTabRef } from '../../../types';
import { ExternalLinkIcon, PlusIcon } from "../../icons";
import { Button, TextField } from "../../ui";
import { EXPERIMENTAL_FLAG_DEFAULT_BROWSER } from "../../../../../shared/experimental-features";
import { useActiveChatTarget, type ChatDeliveryReceipt } from '../../chat/ChatTargetContext';
import { useChatDeliveryNotifier } from '../../chat/useChatDeliveryNotifier';
import { TabChatAction } from '../RightDock/TabChatAction';
import "./index.css";
/** Google blocks account sign-in inside embedded browsers (WebView policy);
 *  detect its sign-in host so we can steer the user to the system browser. */
function isGoogleAuthUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return new URL(raw).hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

interface LinkTabViewProps {
  url: string;
  title?: string;
  /** Dock tab id — used as the webview registry key so the Canvas Agent can
   *  read this tab's live page via `dock_read_tab`. */
  tabId?: string;
  /** Gate the <webview> mount. Restored docks render every tab's pane stacked
   *  (only the active one is visible), so mounting unconditionally spins up a
   *  guest process + navigation per tab on the cold-start critical path.
   *  DockPanes flips this on first activation; once true it stays true. */
  mountWebview?: boolean;
  /** Whether this tab is visible as the active or split dock pane. */
  active?: boolean;
  onActivate?: () => void;
  onTitleChange?: (title: string) => void;
  /** Page favicon, reported once the webview resolves it, so the tab icon
   *  follows the site instead of a hardcoded globe. */
  onFaviconChange?: (faviconUrl: string) => void;
  /** Navigate this tab while preserving its stable tab identity. */
  onNavigate: (url: string) => void;
  /** Mirror a guest navigation without resetting a resolved page title. */
  onGuestNavigate: (url: string) => void;
  onAddToReference: (url: string, title?: string) => void;
  onAddDomSelectionToChat: (selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  tabRef?: AgentContextTabRef;
  targetWorkspaceId?: string;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  /** Open a URL as a SEPARATE tab (right-click → open in new tab), placed
   *  next to this one. Distinct from `onNavigate`, which moves this tab. */
  onOpenLink: (url: string, options?: { background?: boolean }) => void;
  activeWorkspaceId: string;
  onRequestClose: () => void;
}

export const LinkTabView = ({
  url,
  title,
  tabId,
  mountWebview = true,
  active = true,
  onActivate,
  onTitleChange,
  onFaviconChange,
  onNavigate,
  onGuestNavigate,
  onAddToReference,
  onAddDomSelectionToChat,
  tabRef,
  targetWorkspaceId,
  onAddTabToChat,
  onOpenLink,
  activeWorkspaceId,
  onRequestClose,
}: LinkTabViewProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const scopeKind = useActiveChatTarget()?.scope?.kind;

  const [domPickerActive, setDomPickerActive] = useState(false);
  // When Pulse Canvas is itself the default browser, the "open in system
  // browser" escape hatch loops back into this app — so steer the user to
  // disable the flag instead. Snapshotted at preload; a reload picks up changes.
  const isDefaultBrowser =
    window.canvasWorkspace.pluginFlags?.[EXPERIMENTAL_FLAG_DEFAULT_BROWSER] === true;
  // Last main-frame URL this tab navigated to — the key under which late
  // title/favicon events are folded into the same browsing-history visit.
  const lastVisitedUrlRef = useRef('');
  const webviewHostRef = useRef<HTMLDivElement>(null);
  const [guestId, setGuestId] = useState<number | null>(null);
  const discard = useDockWebviewDiscard({
    workspaceId: activeWorkspaceId,
    tabId,
    webContentsId: guestId,
    enabled: mountWebview,
    active,
    tabUrl: url,
  });
  const initialLoadSlot = useInitialWebviewLoadSlot({
    id: `dock:${activeWorkspaceId || 'unknown'}:${tabId ?? url}`,
    eligible: mountWebview && !discard.discarded && Boolean(url),
    priority: active ? 0 : 500,
  });
  const browser = useEmbeddedBrowser({
    className: 'link-drawer__webview',
    enabled: mountWebview && !discard.discarded && initialLoadSlot.granted,
    hostRef: webviewHostRef,
    navigationReadyWebContentsId: guestId,
    onFocus: onActivate,
    onFaviconChange: (favicons) => {
      const favicon = pickFaviconUrl(favicons);
      if (!favicon) return;
      onFaviconChange?.(favicon);
      if (lastVisitedUrlRef.current) {
        window.canvasWorkspace.history.record({ url: lastVisitedUrlRef.current, faviconUrl: favicon });
      }
    },
    onNavigate: (nextUrl) => {
      lastVisitedUrlRef.current = nextUrl;
      onGuestNavigate(nextUrl);
      window.canvasWorkspace.history.record({ url: nextUrl });
    },
    onInitialLoadSettled: initialLoadSlot.release,
    onTitleChange: (pageTitle) => {
      onTitleChange?.(pageTitle);
      if (lastVisitedUrlRef.current) {
        window.canvasWorkspace.history.record({ url: lastVisitedUrlRef.current, title: pageTitle });
      }
    },
    url: discard.restore?.url ?? url,
  });
  const loadState = initialLoadSlot.queued ? 'queued' : browser.loadState;
  const loading = loadState === 'loading';
  const errorKind = loadState === 'failed' ? classifyLoadError(browser.loadError) : null;

  const restorePageFocus = useCallback(() => focusDockPageOrRequest({
    workspaceId: activeWorkspaceId,
    tabId,
    webview: browser.webview,
  }), [activeWorkspaceId, browser.webview, tabId]);
  const addressBar = useAddressBar({
    active,
    url,
    currentUrl: browser.currentUrl,
    onNavigate,
    onRestorePageFocus: restorePageFocus,
  });

  // Register this tab's <webview> with main so the Canvas Agent can read the
  // live page (via dock_read_tab), keyed by the dock tab id. The same
  // handshake feeds the renderer-side guest→tab index, which is how a link
  // opened from this page knows to land next to this tab.
  useWebviewRegistration({
    webview: browser.webview,
    workspaceId: activeWorkspaceId,
    nodeId: tabId ?? '',
    enabled: Boolean(tabId && activeWorkspaceId),
    surfaceKind: 'dock-browser',
    onWebContentsId: useCallback((webContentsId: number | null) => {
      setGuestId(webContentsId);
    }, []),
  });
  const contextMenu = usePageContextMenu({ guestId, active });
  const restoreFindFocus = useCallback(() => {
    if (!url) {
      addressBar.focusAddress();
      return;
    }
    restorePageFocus();
  }, [addressBar.focusAddress, restorePageFocus, url]);
  const find = useFindInPage(browser.webview, {
    active,
    onRestorePageFocus: restoreFindFocus,
  });
  useDockWebviewBackgroundLifecycle({
    webview: browser.webview,
    webContentsId: guestId,
    workspaceId: activeWorkspaceId,
    tabId,
    enabled: mountWebview && !discard.discarded,
    active,
  });
  useWebviewRestore(browser.webview, discard.restore);

  // ⌘/Ctrl+L and ⌘/Ctrl+R target whichever web tab is currently visible; the
  // dock resolves the command and broadcasts, this tab claims it while active.
  const { focusAddress } = addressBar;
  const { reload, webview } = browser;
  const { openFind } = find;
  useEffect(() => {
    if (!active) return;
    const ownsRequest = (event: Event) => {
      const target = dockPageKeyFromFocusEvent(event);
      return target?.workspaceId === activeWorkspaceId && target.tabId === tabId;
    };
    const onFocusRequest = (event: Event) => { if (ownsRequest(event)) focusAddress(); };
    const onReloadRequest = (event: Event) => { if (ownsRequest(event)) reload(); };
    const onFindRequest = (event: Event) => { if (ownsRequest(event)) openFind(); };
    window.addEventListener(FOCUS_DOCK_ADDRESS_EVENT, onFocusRequest);
    window.addEventListener(RELOAD_DOCK_TAB_EVENT, onReloadRequest);
    window.addEventListener(FIND_IN_DOCK_TAB_EVENT, onFindRequest);
    return () => {
      window.removeEventListener(FOCUS_DOCK_ADDRESS_EVENT, onFocusRequest);
      window.removeEventListener(RELOAD_DOCK_TAB_EVENT, onReloadRequest);
      window.removeEventListener(FIND_IN_DOCK_TAB_EVENT, onFindRequest);
    };
  }, [active, activeWorkspaceId, focusAddress, openFind, reload, tabId]);

  useDockPageFocus({ active, workspaceId: activeWorkspaceId, tabId, webview });

  const handleOpenInBrowser = useCallback(() => {
    if (!browser.currentUrl) return;
    void window.canvasWorkspace.shell.openExternal(browser.currentUrl);
  }, [browser.currentUrl]);

  const handleAddToCanvas = useCallback(() => {
    if (!browser.currentUrl || !activeWorkspaceId) return;
    window.dispatchEvent(
      new CustomEvent('canvas:add-iframe-from-url', {
        detail: { workspaceId: activeWorkspaceId, url: browser.currentUrl },
      }),
    );
    onRequestClose();
  }, [browser.currentUrl, activeWorkspaceId, onRequestClose]);

  const handleAddToReference = useCallback(() => {
    if (!browser.currentUrl) return;
    onAddToReference(browser.currentUrl, title);
  }, [browser.currentUrl, onAddToReference, title]);

  const handlePickDomElement = useCallback(async () => {
    if (!activeWorkspaceId || !tabId || !browser.currentUrl) return;
    setDomPickerActive(true);
    try {
      const result = await window.canvasWorkspace.iframe.pickDomElement(activeWorkspaceId, tabId);
      if (result.ok && result.selection) {
        const receipt = await onAddDomSelectionToChat({
          ...result.selection,
          workspaceId: activeWorkspaceId,
          nodeId: tabId,
          nodeTitle: title || browser.currentUrl,
          url: browser.currentUrl,
        });
        notifyChatDelivery(receipt, result.selection.label);
      } else if (!result.cancelled) {
        notify({
          tone: 'error',
          title: t('linkDrawer.domSelectionFailed'),
          description: result.error ?? t('linkDrawer.domSelectionMissing'),
          autoCloseMs: 3600,
        });
      }
    } catch (error) {
      notify({
        tone: 'error',
        title: t('linkDrawer.domSelectionFailed'),
        description: error instanceof Error ? error.message : String(error),
        autoCloseMs: 3600,
      });
    } finally {
      setDomPickerActive(false);
    }
  }, [activeWorkspaceId, browser.currentUrl, notify, notifyChatDelivery, onAddDomSelectionToChat, t, tabId, title]);

  return (
    <>
      <header className="link-drawer__header">
        <BrowserNavigationButtons
          canGoBack={browser.canGoBack}
          canGoForward={browser.canGoForward}
          onBack={browser.goBack}
          onForward={browser.goForward}
          onReload={loading ? browser.stop : browser.reload}
          loading={loading}
          canStop
        />
        <form
          ref={addressBar.formRef}
          className="link-drawer__address-form"
          onFocus={onActivate}
          onSubmit={addressBar.onSubmit}
          onMouseEnter={addressBar.cancelScheduledSuggestClose}
          onMouseLeave={addressBar.scheduleSuggestClose}
        >
          <TextField
            className="link-drawer__url"
            value={addressBar.address}
            onChange={(event) => addressBar.onChange(event.target.value)}
            onFocus={(event) => addressBar.onFocus(event.currentTarget)}
            onBlur={addressBar.onBlur}
            onKeyDown={addressBar.onKeyDown}
            placeholder={t('linkDrawer.addressPlaceholder')}
            aria-label={t('linkDrawer.addressLabel')}
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={addressBar.suggestionsVisible}
            aria-controls={addressBar.suggestionsVisible ? addressBar.suggestionsId : undefined}
            aria-activedescendant={
              addressBar.suggestionsVisible && addressBar.activeSuggestion >= 0
                ? `${addressBar.suggestionsId}-option-${addressBar.activeSuggestion}`
                : undefined
            }
          />
          {addressBar.suggestionsVisible && (
            <AddressSuggestionList
              suggestions={addressBar.suggestions}
              activeIndex={addressBar.activeSuggestion}
              listId={addressBar.suggestionsId}
              onPick={addressBar.pickSuggestion}
              onHover={addressBar.setActiveSuggestion}
            />
          )}
        </form>
        <div className="link-drawer__actions">
          {tabRef && targetWorkspaceId && onAddTabToChat && (
            <TabChatAction
              iconOnly
              className="link-drawer__action"
              tab={tabRef}
              targetWorkspaceId={targetWorkspaceId}
              onAddToChat={onAddTabToChat}
            />
          )}
          <Button
            variant="icon"
            size="xs"
            className={`link-drawer__action${domPickerActive ? ' link-drawer__action--active' : ''}`}
            aria-label={domPickerActive ? t('linkDrawer.selectingDomElement') : t('linkDrawer.selectDomElement')}
            title={domPickerActive ? t('linkDrawer.selectingDomElement') : t('linkDrawer.selectDomElement')}
            onClick={() => void handlePickDomElement()}
            disabled={domPickerActive || !activeWorkspaceId || !tabId || !browser.currentUrl}
          >
            <InspectIcon />
          </Button>
          {
            scopeKind === 'workspace' ? <Button
              variant="icon"
              size="xs"
              className="link-drawer__action"
              aria-label={t('linkDrawer.addToReference')}
              title={t('linkDrawer.addToReference')}
              onClick={handleAddToReference}
              disabled={!browser.currentUrl}
            >
              <ReferenceIcon />
            </Button> : null
          }
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.openInBrowser')}
            title={t('linkDrawer.openInBrowser')}
            onClick={handleOpenInBrowser}
            disabled={!browser.currentUrl}
          >
            <ExternalLinkIcon />
          </Button>
          {
            scopeKind === 'workspace' ? <Button
              variant="icon"
              size="xs"
              className="link-drawer__action"
              aria-label={t('linkDrawer.addToCanvas')}
              onClick={handleAddToCanvas}
              disabled={!activeWorkspaceId || !browser.currentUrl}
              title={activeWorkspaceId ? t('linkDrawer.addToCanvas') : t('linkDrawer.noActiveCanvas')}
            >
              <PlusIcon size={12} strokeWidth={1.2} />
            </Button> : null
          }

        </div>
      </header>
      {loading && (
        <div
          className="link-drawer__loading-bar"
          role="progressbar"
          aria-label={t('linkDrawer.loadingPage')}
        />
      )}
      {isGoogleAuthUrl(browser.currentUrl) && (
        <div className="link-drawer__auth-notice" role="status">
          {isDefaultBrowser ? (
            // "Open in system browser" would hand the URL back to the default
            // handler — which is Pulse Canvas — and loop straight back into
            // this blocked page. Point the user at the real fix instead.
            <span className="link-drawer__auth-notice-text">
              {t('linkDrawer.googleAuthDefaultBrowser')}
            </span>
          ) : (
            <>
              <span className="link-drawer__auth-notice-text">
                {t('linkDrawer.googleAuthUnsupported')}
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={handleOpenInBrowser}
                disabled={!browser.currentUrl}
              >
                {t('linkDrawer.googleAuthOpenExternal')}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="link-drawer__webview-surface">
        <div ref={browser.hostRef} className="link-drawer__webview-host" />
        {find.open && (
          <FindInPageBar
            query={find.query}
            matches={find.matches}
            barRef={find.barRef}
            onQueryChange={find.onQueryChange}
            onStep={find.step}
            onClose={find.close}
          />
        )}
        {loadState === 'queued' && (
          <div className="link-drawer__queued" role="status">
            <strong>{title || t('node.type.webPage')}</strong>
            <span>{t('linkDrawer.waitingToLoad')}</span>
          </div>
        )}
        {errorKind && (
          <LinkTabLoadError
            kind={errorKind}
            detail={loadErrorDetail(browser.loadError)}
            url={browser.currentUrl || url}
            onRetry={browser.reload}
            onOpenExternal={handleOpenInBrowser}
          />
        )}
      </div>
      {contextMenu.menu && (
        <PageContextMenu
          request={contextMenu.menu.request}
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          canGoBack={browser.canGoBack}
          canGoForward={browser.canGoForward}
          pageUrl={browser.currentUrl || url}
          onClose={contextMenu.close}
          onRestorePageFocus={restorePageFocus}
          actions={{
            openLink: (target, options) => onOpenLink(target, options),
            openExternal: (target) => void window.canvasWorkspace.shell.openExternal(target),
            copyText: (text) => void navigator.clipboard?.writeText(text).catch(() => undefined),
            goBack: browser.goBack,
            goForward: browser.goForward,
            reload: browser.reload,
          }}
        />
      )}
    </>
  );
};
