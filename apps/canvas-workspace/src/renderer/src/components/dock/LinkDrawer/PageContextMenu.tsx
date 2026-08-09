/**
 * Right-click menu for an embedded page.
 *
 * Chromium's own menu never appears inside a `<webview>` unless the app builds
 * one, so until now a right-click in a web tab did nothing at all — no "open
 * in new tab", no "copy link address", no way to act on a selection. The
 * entries here are the ones this surface can actually honour, drawn with the
 * same `context-menu` chrome as the canvas menus.
 */
import { useI18n, type I18nKey } from '../../../i18n';
import { Button, Popover } from '../../ui';
import { resolveAddressInput } from '../EmbeddedBrowser/address-input';
import type { WebviewContextMenuRequest } from '../../../../../shared/webview-context-menu';

/** Selection text is untrusted page content — cap it before it reaches a label. */
const SELECTION_LABEL_LIMIT = 24;

export interface PageContextMenuActions {
  openLink: (url: string, options?: { background?: boolean }) => void;
  openExternal: (url: string) => void;
  copyText: (text: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
}

interface Props {
  request: WebviewContextMenuRequest;
  /** Menu position in host viewport coordinates. */
  x: number;
  y: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The tab's own URL, for the page-level entries. */
  pageUrl: string;
  actions: PageContextMenuActions;
  onClose: () => void;
  onRestorePageFocus: () => void;
}

const truncate = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SELECTION_LABEL_LIMIT
    ? `${collapsed.slice(0, SELECTION_LABEL_LIMIT)}…`
    : collapsed;
};

export const PageContextMenu = ({
  request,
  x,
  y,
  canGoBack,
  canGoForward,
  pageUrl,
  actions,
  onClose,
  onRestorePageFocus,
}: Props) => {
  const { t } = useI18n();
  const selection = request.selectionText.trim();
  const isImage = request.mediaType === 'image' && Boolean(request.srcURL);

  const run = (action: () => void, restorePageFocus = true) => () => {
    onClose();
    action();
    if (restorePageFocus) onRestorePageFocus();
  };

  const closePopover = (reason?: 'escape' | 'outside') => {
    onClose();
    if (reason === 'escape') onRestorePageFocus();
  };

  // ui/Button + role="menuitem" is the blessed menu-row shape (see
  // RightDock/NewDockTabMenu); `context-menu-item` carries the shared
  // canvas-menu styling on top of it.
  const item = (key: I18nKey, onClick: () => void, params?: Record<string, string>) => (
    <Button size="sm" className="context-menu-item" role="menuitem" onClick={onClick}>
      <span className="context-menu-label">
        <strong>{t(key, params)}</strong>
      </span>
    </Button>
  );

  return (
    <Popover x={x} y={y} onClose={closePopover} className="context-menu context-menu--in-dock">
      {request.linkURL && (
        <>
          <div className="context-menu-title">{t('linkDrawer.menu.linkTitle')}</div>
          {item('linkDrawer.menu.openLinkInNewTab', run(
            () => actions.openLink(request.linkURL),
            false,
          ))}
          {item('linkDrawer.menu.openLinkInBackground', run(
            () => actions.openLink(request.linkURL, { background: true }),
          ))}
          {item('linkDrawer.menu.openLinkExternally', run(() => actions.openExternal(request.linkURL)))}
          {item('linkDrawer.menu.copyLinkAddress', run(() => actions.copyText(request.linkURL)))}
        </>
      )}
      {isImage && (
        <>
          <div className="context-menu-title">{t('linkDrawer.menu.imageTitle')}</div>
          {item('linkDrawer.menu.openImageInNewTab', run(
            () => actions.openLink(request.srcURL),
            false,
          ))}
          {item('linkDrawer.menu.copyImageAddress', run(() => actions.copyText(request.srcURL)))}
        </>
      )}
      {selection && (
        <>
          <div className="context-menu-title">{t('linkDrawer.menu.selectionTitle')}</div>
          {item('linkDrawer.menu.copySelection', run(() => actions.copyText(selection)))}
          {item(
            'linkDrawer.menu.searchSelection',
            run(() => actions.openLink(resolveAddressInput(selection)), false),
            { query: truncate(selection) },
          )}
        </>
      )}
      <div className="context-menu-title">{t('linkDrawer.menu.pageTitle')}</div>
      {canGoBack && item('linkDrawer.back', run(actions.goBack))}
      {canGoForward && item('linkDrawer.forward', run(actions.goForward))}
      {item('linkDrawer.reload', run(actions.reload))}
      {pageUrl && item('linkDrawer.menu.copyPageAddress', run(() => actions.copyText(pageUrl)))}
      {pageUrl && item('linkDrawer.openInBrowser', run(() => actions.openExternal(pageUrl)))}
    </Popover>
  );
};
