import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightCode(code: string, lang: string): { html: string; lang: string } {
  const trimmedLang = lang.trim().toLowerCase();
  if (trimmedLang && hljs.getLanguage(trimmedLang)) {
    try {
      const { value } = hljs.highlight(code, { language: trimmedLang, ignoreIllegals: true });
      return { html: value, lang: trimmedLang };
    } catch {
      // fall through to plain rendering
    }
  }
  // No language hint (or unsupported) — render plain, but auto-detect for display.
  try {
    const auto = hljs.highlightAuto(code);
    return { html: auto.value, lang: auto.language ?? '' };
  } catch {
    return { html: '', lang: '' };
  }
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

/**
 * Wrap fenced code blocks in a header that exposes the language label
 * and a copy button. The button itself is wired up via event delegation
 * inside ChatMessages — here we only emit the markup + a stable data
 * attribute so the delegate can locate the source code.
 */
markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const rawCode = token.content;
  const info = (token.info || '').trim();
  const requestedLang = info.split(/\s+/)[0] ?? '';
  const { html: highlighted, lang } = highlightCode(rawCode, requestedLang);
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
};

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

export function renderMarkdown(content: string): string {
  return markdown.render(content);
}
