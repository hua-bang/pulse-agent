/**
 * Minimal, escape-first Markdown renderer for node previews. Every input
 * character is HTML-escaped before any markup is added, so node content can
 * never inject elements or attributes. Links keep only http(s) targets and
 * are opened through the host (`data-href`), never by the iframe itself.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(escaped: string): string {
  const codeSpans: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a data-href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)]);
}

type ListKind = 'ul' | 'ol';

export function renderMarkdown(source: string): string {
  // NUL is reserved for the inline code-span placeholders.
  const lines = source.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let list: ListKind | null = null;
  let inCode = false;
  let code: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  for (const raw of lines) {
    if (inCode) {
      if (/^\s*```/.test(raw)) {
        html.push(`<pre><code>${code.join('\n')}</code></pre>`);
        inCode = false;
        code = [];
      } else {
        code.push(escapeHtml(raw));
      }
      continue;
    }
    if (/^\s*```/.test(raw)) {
      flushParagraph();
      closeList();
      inCode = true;
      continue;
    }
    const line = escapeHtml(raw);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
    } else if (bullet || ordered) {
      flushParagraph();
      const kind: ListKind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        html.push(`<${kind}>`);
        list = kind;
      }
      const check = bullet?.[1] ? (bullet[1].trim() ? '☑ ' : '☐ ') : '';
      html.push(`<li>${check}${renderInline(bullet ? bullet[2] : ordered![1])}</li>`);
    } else if (line.startsWith('&gt;')) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^&gt;\s?/, ''))}</blockquote>`);
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  if (inCode) html.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join('');
}
