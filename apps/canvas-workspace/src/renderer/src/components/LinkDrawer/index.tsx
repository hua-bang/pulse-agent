/**
 * Right-dock tab content for external links intercepted from embedded
 * webviews and sandboxed iframes. Each open link preview owns its own
 * <webview>; the dock dedupes exact URLs while allowing different links
 * to stay open side by side.
 *
 * Tab chrome and switching live in components/RightDock; link actions live
 * beside the address bar, and the resolved page title is reported up via
 * `onTitleChange`. Address-bar editing rules live in `useAddressBar`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { useInitialWebviewLoadSlot } from '../EmbeddedBrowser/useInitialWebviewLoadSlot';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { classifyLoadError, loadErrorDetail } from '../EmbeddedBrowser/load-error';
import { AddressSuggestionList } from './AddressSuggestions';
import { LinkTabLoadError } from './LinkTabLoadError';
import { PageContextMenu } from './PageContextMenu';
import { FindInPageBar } from './FindInPageBar';
import { useAddressBar } from './useAddressBar';
import { useFindInPage } from './useFindInPage';
import { usePageContextMenu } from './usePageContextMenu';
import { useWebviewRegistration } from '../IframeNodeBody/useWebviewRegistration';
import { useWebviewRestore } from '../IframeNodeBody/useWebviewDiscard';
import {
  useDockWebviewBackgroundLifecycle,
  useDockWebviewDiscard,
} from './useDockWebviewLifecycle';
import { registerLinkTabWebview } from '../RightDock/link-tab-webviews';
import {
  FIND_IN_DOCK_TAB_EVENT,
  FOCUS_DOCK_ADDRESS_EVENT,
  FOCUS_DOCK_PAGE_EVENT,
  RELOAD_DOCK_TAB_EVENT,
} from '../RightDock/dock-browser-commands';
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { useAppShell } from '../AppShellProvider';
import type { AgentContextDomSelectionRef } from '../../types';
import { ExternalLinkIcon, PlusIcon } from "../icons";
import { Button, TextField } from "../ui";
import { EXPERIMENTAL_FLAG_DEFAULT_BROWSER } from "../../../../shared/experimental-features";
import type { ChatDeliveryReceipt } from '../chat/ChatTargetContext';
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
   *  read this tab's live page via `canvas_read_tab`. */
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
  onOpenLink,
  activeWorkspaceId,
  onRequestClose,
}: LinkTabViewProps) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
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
  const discard = useDockWebviewDiscard({
    workspaceId: activeWorkspaceId,
    tabId,
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

  const addressBar = useAddressBar({ url, currentUrl: browser.currentUrl, onNavigate });

  // Register this tab's <webview> with main so the Canvas Agent can read the
  // live page (via canvas_read_tab), keyed by the dock tab id. The same
  // handshake feeds the renderer-side guest→tab index, which is how a link
  // opened from this page knows to land next to this tab.
  const [guestId, setGuestId] = useState<number | null>(null);
  useWebviewRegistration({
    webview: browser.webview,
    workspaceId: activeWorkspaceId,
    nodeId: tabId ?? '',
    enabled: Boolean(tabId && activeWorkspaceId),
    onWebContentsId: useCallback((webContentsId: number | null) => {
      setGuestId(webContentsId);
      if (webContentsId === null || !tabId) return;
      registerLinkTabWebview(webContentsId, tabId);
    }, [tabId]),
  });
  const contextMenu = usePageContextMenu({ guestId });
  const find = useFindInPage(browser.webview);
  useDockWebviewBackgroundLifecycle({
    webview: browser.webview,
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
    const onFocusRequest = () => focusAddress();
    const onReloadRequest = () => reload();
    const onFindRequest = () => openFind();
    window.addEventListener(FOCUS_DOCK_ADDRESS_EVENT, onFocusRequest);
    window.addEventListener(RELOAD_DOCK_TAB_EVENT, onReloadRequest);
    window.addEventListener(FIND_IN_DOCK_TAB_EVENT, onFindRequest);
    return () => {
      window.removeEventListener(FOCUS_DOCK_ADDRESS_EVENT, onFocusRequest);
      window.removeEventListener(RELOAD_DOCK_TAB_EVENT, onReloadRequest);
      window.removeEventListener(FIND_IN_DOCK_TAB_EVENT, onFindRequest);
    };
  }, [active, focusAddress, reload, openFind]);

  // A user click on this tab hands keyboard focus to the page, so scrolling
  // and typing work without a second click. Addressed by tab id rather than
  // `active` so the click that CREATES the activation is not missed.
  useEffect(() => {
    if (!tabId || !webview) return;
    const onFocusPage = (event: Event) => {
      if ((event as CustomEvent<{ tabId?: string }>).detail?.tabId !== tabId) return;
      // After the activation commit, or the pane is still hidden.
      requestAnimationFrame(() => webview.focus());
    };
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, onFocusPage);
    return () => window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, onFocusPage);
  }, [tabId, webview]);

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
        notify({
          tone: receipt.status === 'delivered' || receipt.status === 'queued' ? 'success' : 'error',
          title: receipt.status === 'delivered' || receipt.status === 'queued'
            ? t('linkDrawer.domSelectionAdded')
            : t('linkDrawer.domSelectionFailed'),
          description: receipt.target
            ? t('linkDrawer.domSelectionTarget', {
              selection: result.selection.label,
              target: receipt.target.contextSnapshot.label,
            })
            : receipt.status === 'failed' && receipt.error
              ? receipt.error
              : t('linkDrawer.domSelectionMissing'),
          autoCloseMs: 1800,
        });
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
  }, [activeWorkspaceId, browser.currentUrl, notify, onAddDomSelectionToChat, t, tabId, title]);

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
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.addToReference')}
            title={t('linkDrawer.addToReference')}
            onClick={handleAddToReference}
            disabled={!browser.currentUrl}
          >
            <ReferenceIcon />
          </Button>
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
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.addToCanvas')}
            onClick={handleAddToCanvas}
            disabled={!activeWorkspaceId || !browser.currentUrl}
            title={activeWorkspaceId ? t('linkDrawer.addToCanvas') : t('linkDrawer.noActiveCanvas')}
          >
            <PlusIcon size={12} strokeWidth={1.2} />
          </Button>
        </div>
      </header>
      {loading && (
        <div
          className="link-drawer__loading-bar"
          role="progressbar"
          aria-label={t('linkDrawer.loadingPage')}
        />
      )}
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

const ReferenceIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 1.75h6v8.5L6 8.3l-3 1.95v-8.5z" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
  </svg>
);

const InspectIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M2 2.5A.5.5 0 012.5 2h7a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-7zM4.2 5L3.2 6l1 1M7.8 5l1 1-1 1M5.4 8l1.2-4"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
