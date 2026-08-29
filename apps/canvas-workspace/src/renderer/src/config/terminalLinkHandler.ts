import type { ILinkHandler } from '@xterm/xterm';
import { getInitialLanguage } from '../i18n';
import { messages } from '../i18n/messages';

const OPEN_DIALOG_CLASS = 'terminal-link-confirm';

function dialogCopy() {
  const dict = messages[getInitialLanguage()];
  return {
    title: dict['terminalLink.confirmTitle'],
    description: dict['terminalLink.confirmDescription'],
    openLabel: dict['terminalLink.openLink'],
    cancelLabel: dict['shell.cancel'],
  };
}

// Reuses the app-shell confirm dialog's classes (backdrop/card/header/footer)
// so this looks like every other confirmation in the app, without needing
// the AppShellProvider React context — this handler is wired into xterm's
// ITerminalOptions, constructed outside any component tree.
function confirmNavigate(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    if (document.querySelector(`.${OPEN_DIALOG_CLASS}`)) {
      resolve(false);
      return;
    }

    const text = dialogCopy();
    const backdrop = document.createElement('div');
    backdrop.className = `ui-modal-backdrop ${OPEN_DIALOG_CLASS}`;

    const card = document.createElement('div');
    card.className = 'ui-modal';
    card.style.width = 'min(480px, 100%)';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', text.title);

    const header = document.createElement('div');
    header.className = 'shell-dialog__header';
    const title = document.createElement('h2');
    title.className = 'shell-dialog__title';
    title.textContent = text.title;
    header.appendChild(title);

    const description = document.createElement('div');
    description.className = 'shell-dialog__description';
    const lead = document.createElement('p');
    lead.style.margin = '0 0 10px';
    lead.textContent = text.description;
    const linkPreview = document.createElement('code');
    linkPreview.textContent = url;
    Object.assign(linkPreview.style, {
      display: 'block',
      wordBreak: 'break-all',
      maxHeight: '96px',
      overflowY: 'auto',
      fontSize: '12px',
      fontFamily: "'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      background: 'rgba(0, 0, 0, 0.04)',
      borderRadius: '8px',
      padding: '8px 10px',
    });
    description.append(lead, linkPreview);

    const footer = document.createElement('div');
    footer.className = 'shell-dialog__footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'shell-dialog__button';
    cancelBtn.textContent = text.cancelLabel;
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'shell-dialog__button shell-dialog__button--primary';
    confirmBtn.textContent = text.openLabel;
    footer.append(cancelBtn, confirmBtn);

    card.append(header, description, footer);
    backdrop.appendChild(card);

    const settle = (accepted: boolean) => {
      backdrop.remove();
      resolve(accepted);
    };
    // Scoped to the backdrop (not document/window): Escape bubbles up from
    // whichever button has focus. Keeps this out of the hand-rolled
    // document/window keydown-listener count that ui-reuse-governance.test.ts
    // ratchets — that counter targets the pattern useEscapeClose replaces,
    // which isn't reachable here since this dialog is built outside React.
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    });
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) settle(false);
    });
    cancelBtn.addEventListener('click', () => settle(false));
    confirmBtn.addEventListener('click', () => settle(true));

    document.body.appendChild(backdrop);
    confirmBtn.focus();
  });
}

/**
 * xterm's built-in OSC 8 link handler falls back to a native `window.confirm`
 * plus a bare `window.open()` when `ITerminalOptions.linkHandler` is unset.
 * That popup always gets denied by this app's `setWindowOpenHandler`
 * (main/app/link-policy.ts), because it opens as `about:blank` before the
 * real URL is known — so the native dialog's "OK" silently does nothing.
 * Show an app-styled confirmation instead and, once accepted, route through
 * the same `shell.openExternal` IPC every other external link in this app
 * uses.
 */
export function createTerminalLinkHandler(): ILinkHandler {
  return {
    activate: (_event, uri) => {
      void confirmNavigate(uri).then((accepted) => {
        if (accepted) void window.canvasWorkspace?.shell.openExternal(uri);
      });
    },
  };
}
