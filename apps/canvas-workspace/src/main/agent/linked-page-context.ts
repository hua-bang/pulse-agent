import { getNodeRenderedText } from '../webview/registry';

// ─── Web page fetching (for iframe / link nodes) ───────────────────

const PAGE_FETCH_TIMEOUT_MS = 10_000;
const PAGE_MAX_BYTES = 200_000;

/**
 * Fetch a web page and return its readable text content. Strips
 * `<script>`, `<style>`, and `<noscript>` blocks, drops remaining HTML
 * tags, and collapses whitespace so the LLM sees the prose.
 *
 * Fails gracefully: a network error or non-2xx response returns a short
 * error string instead of throwing, so the agent can surface a useful
 * message to the user.
 */
async function fetchPageText(url: string): Promise<string> {
  if (url === 'about:blank') return '[blank web page — no content]';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (PulseCoder Canvas Agent)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    if (!res.ok) {
      return `[fetch failed: HTTP ${res.status} ${res.statusText}]`;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();

    // Cap by bytes (approx) to avoid blowing up the context.
    const truncated = raw.length > PAGE_MAX_BYTES;
    const body = truncated ? raw.slice(0, PAGE_MAX_BYTES) : raw;

    let text = body;
    if (contentType.includes('html') || /<[a-z!/]/i.test(body)) {
      // Try to grab <title> for a nicer summary header.
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
      const title = titleMatch ? titleMatch[1].trim() : '';

      text = body
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        // Decode a minimal set of HTML entities — enough for readability.
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();

      if (title) text = `Title: ${title}\n\n${text}`;
    }

    if (truncated) text += '\n\n[…content truncated]';
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      return `[fetch timed out after ${PAGE_FETCH_TIMEOUT_MS / 1000}s]`;
    }
    return `[fetch failed: ${msg}]`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the text content of an iframe/link node.
 *
 * Prefers the live webview DOM (what the user is actually seeing, with JS
 * executed and login cookies applied) and falls back to a fresh server-side
 * HTTP fetch when the webview isn't mounted — e.g. the workspace isn't open
 * in the foreground window, or the page hasn't finished attaching yet.
 *
 * Never returns an empty string: each failure path returns a bracketed
 * diagnostic so the agent can tell the user *why* it couldn't read the
 * page (SPA with no static HTML, auth-gated, webview not attached, etc.)
 * instead of silently producing empty content.
 */
export async function readIframeContent(
  workspaceId: string,
  nodeId: string,
  url: string,
): Promise<string> {
  if (!url) return '[empty link node — no URL set]';
  if (url === 'about:blank') return '[blank web page — no content]';

  let liveError: string | null = null;
  try {
    const live = await getNodeRenderedText(workspaceId, nodeId);
    if (live && live.trim()) return live;
    if (live !== null) {
      // getNodeRenderedText returned a diagnostic like a timeout — keep it
      // so we can surface it if the server fetch also fails to help.
      liveError = live.trim() ? live : null;
    } else {
      liveError = '[live webview not registered — node may not be mounted in the foreground window, or webviewTag is off (a full Electron restart is required for that flag to take effect)]';
    }
  } catch (err) {
    liveError = `[live webview read failed: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const fetched = await fetchPageText(url);
  if (fetched.trim()) return fetched;

  // Both paths produced nothing readable. Tell the agent precisely why so
  // it can explain to the user instead of pretending the page is empty.
  return [
    '[canvas_read_node could not extract text from this link node]',
    '- Tried the live webview first:',
    `  ${liveError ?? '(succeeded but returned empty text — the page may still be loading)'}`,
    '- Then tried a plain server fetch:',
    '  Succeeded with no readable text — the page is almost certainly a JS-rendered SPA (React/Vue) whose content only exists after scripts run.',
    '',
    'To summarise this page, open it in a Link node on the canvas, wait for it to finish loading (log in if needed), then ask again. If it still fails, ask the user to paste the text directly.',
  ].join('\n');
}
