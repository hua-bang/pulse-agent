/**
 * Lazy-loaded mermaid render pipeline.
 *
 * The mermaid bundle weighs roughly 1MB so we only import it the first
 * time a chat message actually contains a `mermaid` fenced block. The
 * initialize call is idempotent — we kick it off once and reuse the
 * resulting promise for every subsequent render.
 */

type MermaidApi = typeof import('mermaid').default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let diagramIdCounter = 0;

const loadMermaid = (): Promise<MermaidApi> => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit',
      });
      return m;
    });
  }
  return mermaidPromise;
};

const renderInto = async (host: HTMLElement): Promise<void> => {
  const source = host.dataset.source ?? '';
  if (!source.trim()) {
    host.dataset.rendered = 'error';
    host.innerHTML = '<div class="chat-mermaid-error">Empty diagram</div>';
    return;
  }

  try {
    const mermaid = await loadMermaid();
    const id = `chat-mermaid-${++diagramIdCounter}-${Date.now().toString(36)}`;
    const { svg } = await mermaid.render(id, source);
    host.innerHTML = svg;
    host.dataset.rendered = 'true';
  } catch (err) {
    host.dataset.rendered = 'error';
    const message = err instanceof Error ? err.message : String(err);
    host.innerHTML = (
      '<div class="chat-mermaid-error">'
      + '<div class="chat-mermaid-error-title">Mermaid render failed</div>'
      + `<div class="chat-mermaid-error-detail">${escapeHtml(message)}</div>`
      + '</div>'
    );
  }
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Render every `.chat-mermaid[data-rendered="false"]` host within `root`.
 * Hosts that have already been rendered (or errored) are skipped so
 * streaming re-renders don't redo the work.
 */
export const renderMermaidIn = (root: HTMLElement | null): void => {
  if (!root) return;
  const hosts = root.querySelectorAll<HTMLElement>('.chat-mermaid[data-rendered="false"]');
  if (hosts.length === 0) return;
  hosts.forEach(host => {
    // Flip the flag immediately so concurrent passes don't double-render.
    host.dataset.rendered = 'pending';
    void renderInto(host);
  });
};
