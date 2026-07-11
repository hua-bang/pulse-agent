import hljs from 'highlight.js/lib/core';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import { syntaxHighlightLanguages } from '../../../utils/syntaxHighlightLanguages';
import { count } from '../../../perf/counters';

for (const [name, language] of Object.entries(syntaxHighlightLanguages)) {
  hljs.registerLanguage(name, language);
}

// Minimum highlight.js auto-detection relevance before its guessed language is
// trusted as the code-block header label. Below this, syntax coloring is still
// applied but the block is labeled neutrally (`text`) rather than mislabeled.
const AUTO_DETECT_LABEL_MIN_RELEVANCE = 5;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightCode(
  code: string,
  lang: string,
  streaming: boolean,
): { html: string; lang: string } {
  const trimmedLang = lang.trim().toLowerCase();
  if (trimmedLang && hljs.getLanguage(trimmedLang)) {
    try {
      const { value } = hljs.highlight(code, { language: trimmedLang, ignoreIllegals: true });
      return { html: value, lang: trimmedLang };
    } catch {
      // fall through to plain rendering
    }
  }
  // Auto-detection tries every registered grammar, and the whole message is
  // re-rendered on every streamed token — running it while the block is still
  // growing is O(tokens × languages × size). Render plain until the stream
  // settles; the final render does the full pass.
  if (streaming) return { html: '', lang: '' };
  // No language hint (or unsupported) — auto-detect for syntax coloring. The
  // detected name only becomes the header label when highlight.js is reasonably
  // confident; otherwise we keep the coloring but fall back to a neutral label,
  // since a low-relevance guess is often wrong (e.g. brace/colon-heavy JSON
  // mislabeled as "css").
  try {
    const auto = hljs.highlightAuto(code);
    const confident = auto.relevance >= AUTO_DETECT_LABEL_MIN_RELEVANCE;
    return { html: auto.value, lang: confident ? (auto.language ?? '') : '' };
  } catch {
    return { html: '', lang: '' };
  }
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// GitHub-style task lists (`- [x] done`, `- [ ] todo`). Checkboxes stay
// disabled — toggling state in chat replies isn't a useful interaction
// for the assistant's output.
markdown.use(taskLists, { enabled: false, label: true, labelAfter: false });

/**
 * Emit a fenced-code-block shell: a header with the language label and a
 * copy button, plus the highlighted body. The button is wired up via
 * event delegation in ChatMessages — here we only emit the markup + a
 * stable data attribute so the delegate can locate the source code.
 */
function renderCodeBlockHtml(rawCode: string, requestedLang: string, streaming: boolean): string {
  const { html: highlighted, lang } = highlightCode(rawCode, requestedLang, streaming);
  const displayLang = requestedLang || lang || 'text';
  const codeHtml = highlighted
    ? highlighted
    : escapeAttr(rawCode);
  return (
    `<div class="chat-code-block" data-lang="${escapeAttr(displayLang)}">`
    + '<div class="chat-code-block-header">'
    + `<span class="chat-code-block-lang">${escapeAttr(displayLang)}</span>`
    + '<button type="button" class="chat-code-block-copy" data-action="copy-code" aria-label="Copy code">Copy</button>'
    + '</div>'
    + `<pre class="chat-code-block-pre"><code class="hljs language-${escapeAttr(displayLang)}">${codeHtml}\n</code></pre>`
    + '</div>'
  );
}

markdown.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx];
  const rawCode = token.content;
  const info = (token.info || '').trim();
  const requestedLang = info.split(/\s+/)[0] ?? '';

  // Mermaid diagrams render as a placeholder; the real SVG is mounted by
  // ChatMessage's effect after the parent message lands in the DOM.
  if (requestedLang.toLowerCase() === 'mermaid') {
    return (
      '<div class="chat-mermaid" data-rendered="false"'
      + ` data-source="${escapeAttr(rawCode)}">`
      + '<div class="chat-mermaid-loading">Rendering diagram…</div>'
      + '</div>'
    );
  }

  return renderCodeBlockHtml(rawCode, requestedLang, env?.streaming === true);
};

// Indented (4-space) code blocks — common when a user pastes code without
// fences — get the same polished shell + auto-detected highlighting as a
// fenced block, instead of a bare monospace `<pre>`.
markdown.renderer.rules.code_block = (tokens, idx, _options, env) =>
  renderCodeBlockHtml(tokens[idx].content.replace(/\n+$/, ''), '', env?.streaming === true);

/** Open external links in a new window and never leak referrer. */
const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  const href = hrefIndex >= 0 ? token.attrs![hrefIndex][1] : '';
  // Leave in-page hash links alone; everything else opens externally.
  if (href && !href.startsWith('#')) {
    const targetIdx = token.attrIndex('target');
    if (targetIdx < 0) token.attrPush(['target', '_blank']);
    else token.attrs![targetIdx][1] = '_blank';

    const relIdx = token.attrIndex('rel');
    if (relIdx < 0) token.attrPush(['rel', 'noopener noreferrer']);
    else token.attrs![relIdx][1] = 'noopener noreferrer';
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Wrap tables in a horizontal scroll container so wide tables don't
 *  blow out the panel width on narrow layouts. */
markdown.renderer.rules.table_open = () => '<div class="chat-md-table-scroll"><table>';
markdown.renderer.rules.table_close = () => '</table></div>';

/** Lazy-load images so long conversations don't burn bandwidth and
 *  layout time up front. */
const defaultImageRenderer = markdown.renderer.rules.image
  ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.attrIndex('loading') < 0) token.attrPush(['loading', 'lazy']);
  if (token.attrIndex('decoding') < 0) token.attrPush(['decoding', 'async']);
  return defaultImageRenderer(tokens, idx, options, env, self);
};

export interface RenderMarkdownOptions {
  /**
   * True while the source message is still streaming. Skips highlight.js
   * auto-detection for unhinted code blocks — the caller re-renders without
   * the flag once the stream settles, which does the full pass.
   */
  streaming?: boolean;
}

// Settled-render cache. renderMarkdown is pure in its input, and chat
// re-renders the same settled messages many times (e.g. the mention pass
// upstream re-runs whenever the canvas node list changes identity) — the
// markdown parse + highlight is the expensive part, so memoize it. Streaming
// renders are never reused (content grows every token) and skip the cache.
const settledRenderCache = new Map<string, string>();
const SETTLED_RENDER_CACHE_MAX = 100;

export function renderMarkdown(content: string, options?: RenderMarkdownOptions): string {
  if (options?.streaming === true) {
    count('chat-md-stream-render');
    return markdown.render(content, { streaming: true });
  }
  const cached = settledRenderCache.get(content);
  if (cached !== undefined) {
    count('chat-md-cache-hit');
    // Re-insert to keep recently used entries away from eviction.
    settledRenderCache.delete(content);
    settledRenderCache.set(content, cached);
    return cached;
  }
  count('chat-md-render');
  const html = markdown.render(content);
  settledRenderCache.set(content, html);
  if (settledRenderCache.size > SETTLED_RENDER_CACHE_MAX) {
    const oldest = settledRenderCache.keys().next().value;
    if (oldest !== undefined) settledRenderCache.delete(oldest);
  }
  return html;
}
