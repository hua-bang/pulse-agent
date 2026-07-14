import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';

export interface WebviewRestoreSnapshot {
  url: string;
  scrollX: number;
  scrollY: number;
}

export type WebviewDiscardBlockReason =
  | 'active-editor'
  | 'audible'
  | 'devtools'
  | 'dirty-form'
  | 'focused-document'
  | 'focused-host'
  | 'loading'
  | 'non-reloadable'
  | 'probe-failed';

export type WebviewDiscardProbeResult =
  | { allowed: true; snapshot: WebviewRestoreSnapshot }
  | { allowed: false; reason: WebviewDiscardBlockReason };

interface GuestDocumentState extends WebviewRestoreSnapshot {
  activeEditable: boolean;
  dirty: boolean;
  focused: boolean;
  reloadable: boolean;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 2_000;
const DIRTY_TRACKER_KEY = '__pulseCanvasWebviewDirtySinceReady';

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => (
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  })
);

const INSTALL_DIRTY_TRACKER_SCRIPT = `(() => {
  const key = ${JSON.stringify(DIRTY_TRACKER_KEY)};
  const installedKey = key + 'TrackerInstalled';
  const frameTrackedKey = key + 'FrameTracked';
  const rootWindow = window;
  if (rootWindow[key] === undefined) rootWindow[key] = false;
  const mark = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    if (path.some((target) => target && (
      target.isContentEditable || target.matches?.('input, textarea, select, [contenteditable]')
    ))) rootWindow[key] = true;
  };

  const installFrame = (frame) => {
    try {
      if (!frame[frameTrackedKey]) {
        frame[frameTrackedKey] = true;
        frame.addEventListener('load', () => {
          try { installWindow(frame.contentWindow); } catch { /* cross-origin frame */ }
        }, true);
      }
      installWindow(frame.contentWindow);
    } catch { /* cross-origin frame */ }
  };

  const installWindow = (targetWindow) => {
    try {
      if (!targetWindow || targetWindow[installedKey]) return;
      const targetDocument = targetWindow.document;
      targetWindow[installedKey] = true;
      targetDocument.addEventListener('beforeinput', mark, true);
      targetDocument.addEventListener('input', mark, true);
      targetDocument.addEventListener('change', mark, true);
      for (const frame of targetDocument.querySelectorAll('iframe')) installFrame(frame);

      const Observer = targetWindow.MutationObserver;
      if (Observer && targetDocument.documentElement) {
        const observer = new Observer((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.matches?.('iframe')) installFrame(node);
              for (const frame of node.querySelectorAll?.('iframe') ?? []) installFrame(frame);
            }
          }
        });
        observer.observe(targetDocument.documentElement, { childList: true, subtree: true });
      }
    } catch { /* cross-origin frame */ }
  };

  installWindow(rootWindow);
})()`;

const INSPECT_GUEST_SCRIPT = `(() => {
  const documents = [document];
  for (let index = 0; index < documents.length; index += 1) {
    for (const frame of documents[index].querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument && !documents.includes(frame.contentDocument)) {
          documents.push(frame.contentDocument);
        }
      } catch { /* cross-origin frames cannot be inspected */ }
    }
  }
  const activeEditable = documents.some((doc) => {
    const active = doc.activeElement;
    return Boolean(active && (
      active.matches?.('input, textarea, select') || active.isContentEditable
    ));
  });
  const controls = documents.flatMap((doc) => Array.from(doc.querySelectorAll('input, textarea, select')));
  const hasContentEditable = documents.some((doc) => Boolean(
    doc.querySelector('[contenteditable]:not([contenteditable="false"])')
  ));
  const trackerDirty = documents.some((doc) => {
    try { return Boolean(doc.defaultView?.[${JSON.stringify(DIRTY_TRACKER_KEY)}]); }
    catch { return false; }
  });
  const dirty = trackerDirty || hasContentEditable || controls.some((control) => {
    const tagName = String(control.tagName ?? '').toLowerCase();
    if (tagName === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
      return control.checked !== control.defaultChecked;
    }
    if (tagName === 'select') {
      return Array.from(control.options ?? []).some((option) => option.selected !== option.defaultSelected);
    }
    return 'value' in control && 'defaultValue' in control && control.value !== control.defaultValue;
  });
  const url = location.href;
  const isBlankDocument = /^about:blank(?:[?#]|$)/.test(url);
  const populatedBlankDocument = isBlankDocument && Boolean(
    document.body?.children?.length
    || document.body?.textContent?.trim()
    || document.body?.attributes?.length
    || document.head?.children?.length
    || document.documentElement?.attributes?.length
    || document.adoptedStyleSheets?.length
  );
  return {
    activeEditable,
    dirty,
    focused: document.hasFocus(),
    reloadable: !url.startsWith('blob:') && !populatedBlankDocument,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    url,
  };
})()`;

const isGuestDocumentState = (value: unknown): value is GuestDocumentState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GuestDocumentState>;
  return typeof candidate.activeEditable === 'boolean'
    && typeof candidate.dirty === 'boolean'
    && typeof candidate.focused === 'boolean'
    && typeof candidate.reloadable === 'boolean'
    && typeof candidate.scrollX === 'number'
    && Number.isFinite(candidate.scrollX)
    && typeof candidate.scrollY === 'number'
    && Number.isFinite(candidate.scrollY)
    && typeof candidate.url === 'string';
};

export const inspectWebviewForDiscard = async (
  webview: EmbeddedWebviewTag,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
): Promise<WebviewDiscardProbeResult> => {
  try {
    if (webview.isCurrentlyAudible()) return { allowed: false, reason: 'audible' };
    if (webview.isLoading()) return { allowed: false, reason: 'loading' };
    if (webview.isDevToolsOpened()) return { allowed: false, reason: 'devtools' };
    if (webview.matches(':focus')) return { allowed: false, reason: 'focused-host' };

    const state = await withTimeout(
      webview.executeJavaScript<GuestDocumentState>(INSPECT_GUEST_SCRIPT),
      timeoutMs,
      'WebView discard probe',
    );
    if (!isGuestDocumentState(state)) return { allowed: false, reason: 'probe-failed' };
    if (!state.reloadable) return { allowed: false, reason: 'non-reloadable' };
    if (state.dirty) return { allowed: false, reason: 'dirty-form' };
    if (state.focused) return { allowed: false, reason: 'focused-document' };
    if (state.activeEditable) return { allowed: false, reason: 'active-editor' };

    return {
      allowed: true,
      snapshot: {
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        url: state.url,
      },
    };
  } catch {
    return { allowed: false, reason: 'probe-failed' };
  }
};

export const initializeWebviewDiscardTracking = async (
  webview: EmbeddedWebviewTag,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
): Promise<void> => {
  await withTimeout(
    webview.executeJavaScript(INSTALL_DIRTY_TRACKER_SCRIPT),
    timeoutMs,
    'WebView dirty-state tracker',
  );
};

export const restoreWebviewSnapshot = async (
  webview: EmbeddedWebviewTag,
  snapshot: WebviewRestoreSnapshot,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
): Promise<void> => {
  const x = Number.isFinite(snapshot.scrollX) ? snapshot.scrollX : 0;
  const y = Number.isFinite(snapshot.scrollY) ? snapshot.scrollY : 0;
  // Offscreen Chromium guests suspend requestAnimationFrame. Restoration can
  // itself happen while offscreen (manual wake, Agent operation), so it must
  // not wait on a freezable task or the lifecycle would stay "restoring".
  await withTimeout(
    webview.executeJavaScript(`(() => {
      window.scrollTo(${JSON.stringify(x)}, ${JSON.stringify(y)});
    })()`),
    timeoutMs,
    'WebView scroll restoration',
  );
};
