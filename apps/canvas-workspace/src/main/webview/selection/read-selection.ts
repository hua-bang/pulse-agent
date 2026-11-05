/**
 * Reads the user's text selection in a live guest page. Loaded on demand by
 * the `web:read-selection` IPC handler and the `browser.page.selection`
 * capability, so the page script stays out of the startup bundle.
 */
import type { WebSelection, WebSelectionInput, WebSelectionResult } from '../../../shared/web';
import { webviewRegistryKeyFor } from '../../../shared/webview-registration';
import type { AnyWebContents } from '../reader';
import { getWebContentsForNode } from '../registry';

const EXTRACT_TIMEOUT_MS = 8_000;
const DEFAULT_SELECTION_MAX_CHARS = 8_000;
const SELECTION_CONTEXT_CHARS = 160;

/**
 * Page script: the selected text in this frame, plus a short piece of the
 * text before and after it inside the nearest block element. A selection
 * inside an input or textarea is read from the control itself.
 */
const SELECTION_SCRIPT = `
  (function (contextChars) {
    try {
      var active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
        && typeof active.selectionStart === 'number' && active.selectionEnd > active.selectionStart) {
        var value = String(active.value || '');
        return {
          text: value.slice(active.selectionStart, active.selectionEnd),
          before: value.slice(Math.max(0, active.selectionStart - contextChars), active.selectionStart),
          after: value.slice(active.selectionEnd, active.selectionEnd + contextChars),
          title: document.title || '',
          url: location.href,
        };
      }
      var selection = window.getSelection();
      var text = selection ? selection.toString() : '';
      var before = '';
      var after = '';
      if (text.trim() && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        var node = range.commonAncestorContainer;
        var element = node.nodeType === 1 ? node : node.parentElement;
        var block = (element && element.closest
          && element.closest('p,li,blockquote,td,th,pre,h1,h2,h3,h4,h5,h6,section,article,div'))
          || document.body;
        if (block) {
          var head = document.createRange();
          head.selectNodeContents(block);
          head.setEnd(range.startContainer, range.startOffset);
          var tail = document.createRange();
          tail.selectNodeContents(block);
          tail.setStart(range.endContainer, range.endOffset);
          before = head.toString().slice(-contextChars);
          after = tail.toString().slice(0, contextChars);
        }
      }
      return { text: text, before: before, after: after, title: document.title || '', url: location.href };
    } catch (err) {
      return { text: '', before: '', after: '', title: '', url: '', error: String(err) };
    }
  })(${SELECTION_CONTEXT_CHARS});
`;

type FrameSelection = Omit<WebSelection, 'truncated' | 'frameUrl'> & { error?: string };

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), EXTRACT_TIMEOUT_MS)),
  ]);
}

/**
 * Read the user's text selection. The top page is tried first, then every
 * child frame, because reader sites often render the text in an iframe.
 */
export async function readSelection(
  wc: AnyWebContents,
  maxChars = DEFAULT_SELECTION_MAX_CHARS,
): Promise<{ ok: true; selection: WebSelection } | { ok: false; error: string }> {
  try {
    const top = await withTimeout(
      wc.executeJavaScript(SELECTION_SCRIPT, false) as Promise<FrameSelection>,
      'Selection read timed out',
    );
    if (top.error) return { ok: false, error: top.error };
    let found: FrameSelection = top;
    let frameUrl: string | undefined;
    if (!top.text.trim()) {
      for (const frame of wc.mainFrame.framesInSubtree) {
        if (frame === wc.mainFrame) continue;
        const result = await withTimeout(
          frame.executeJavaScript(SELECTION_SCRIPT, false) as Promise<FrameSelection>,
          'Selection read timed out',
        ).catch(() => null);
        if (result?.text.trim()) {
          found = result;
          frameUrl = result.url;
          break;
        }
      }
    }
    const truncated = maxChars > 0 && found.text.length > maxChars;
    return {
      ok: true,
      selection: {
        text: truncated ? found.text.slice(0, maxChars) : found.text,
        before: found.before,
        after: found.after,
        truncated,
        title: top.title,
        url: top.url,
        ...(frameUrl && frameUrl !== top.url ? { frameUrl } : {}),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `web:read-selection` handler: resolve the target, then read its selection. */
export async function readSelectionForTarget(payload: WebSelectionInput): Promise<WebSelectionResult> {
  const { workspaceId, nodeId } = payload ?? {};
  if (!workspaceId || !nodeId) {
    return { ok: false, nodeId: nodeId ?? '', error: 'workspaceId and nodeId are required' };
  }
  const key = webviewRegistryKeyFor(workspaceId, nodeId);
  const wc = getWebContentsForNode(key.workspaceId, key.nodeId);
  if (!wc) return { ok: false, nodeId, error: `No active webview found for ${nodeId}` };
  const result = await readSelection(wc, payload.maxChars);
  return result.ok
    ? { ok: true, nodeId, ...result.selection }
    : { ok: false, nodeId, error: result.error };
}
