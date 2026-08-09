import { stringWidth } from './text-width.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Lean markdown-to-ANSI renderer for terminal transcripts.
 *
 * Scope is deliberately small (headings, bullets, blockquotes, rules, fenced
 * code markers, inline bold/code/links, GFM tables). Code block content is
 * left untouched so copy/paste from the terminal stays valid.
 */
export function renderMarkdownAnsi(source: string): string {
  const lines = source.split('\n');
  const rendered: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      rendered.push(`${DIM}${line}${RESET}`);
      continue;
    }

    if (inFence) {
      rendered.push(line);
      continue;
    }

    // Vertical squeeze, display-only (the stored text is untouched): outside
    // fences a run of blank lines collapses to one, and leading blanks are
    // dropped entirely. Terminal transcripts pay for every row — model output
    // with generous paragraph spacing reads as padding, not structure.
    if (!line.trim()) {
      if (rendered.length === 0 || !rendered[rendered.length - 1].trim()) {
        continue;
      }
      rendered.push('');
      continue;
    }

    // GFM table: a header row followed by a separator row. Raw pipe rows are
    // unreadable in a transcript; align cells on display columns instead.
    if (isTableRow(line) && isTableSeparator(lines[index + 1])) {
      let end = index + 2;
      while (end < lines.length && isTableRow(lines[end]) && !isTableSeparator(lines[end])) {
        end += 1;
      }
      rendered.push(...renderTableAnsi(lines[index], lines[index + 1], lines.slice(index + 2, end)));
      index = end - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      rendered.push(`${BOLD}${CYAN}${heading[2]}${RESET}`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      rendered.push(`${DIM}${'─'.repeat(40)}${RESET}`);
      continue;
    }

    let processed = line;
    processed = processed.replace(/^(\s*)[-*]\s+/, '$1• ');
    processed = processed.replace(/^>\s?/, `${DIM}▌ ${RESET}`);
    rendered.push(renderInlineAnsi(processed));
  }

  // Trailing blanks buy nothing at the end of a block; the layout owns
  // inter-block spacing.
  while (rendered.length > 0 && !rendered[rendered.length - 1].trim()) {
    rendered.pop();
  }

  return rendered.join('\n');
}

function renderInlineAnsi(line: string): string {
  // Inline code wins over every other marker inside it: `a.**b**` or code
  // containing [x](y) must stay one literal cyan span. Applying the bold/link
  // regexes first styled fragments of the span and dropped its colour — so
  // code spans are lifted out, the remainder styled, then restored.
  const codeSpans: string[] = [];
  let result = line.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`${CYAN}${code}${RESET}`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  result = result.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${CYAN}$1${RESET} ${DIM}($2)${RESET}`);
  result = result.replace(/\u0000(\d+)\u0000/g, (_match, span: string) => codeSpans[Number(span)]);
  return result;
}

function isTableRow(line: string | undefined): boolean {
  return typeof line === 'string' && /^\s*\|?.*\|.*$/.test(line) && line.includes('|') && Boolean(line.trim());
}

function isTableSeparator(line: string | undefined): boolean {
  return typeof line === 'string' && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split('|').map(cell => cell.trim());
}

type CellAlign = 'left' | 'right' | 'center';

/**
 * Renders one GFM table with cells padded on DISPLAY columns (CJK cells would
 * misalign under `padEnd`, which counts code units). Header bold, pipes dim,
 * alignment markers (`:---`, `---:`, `:---:`) respected. No column truncation
 * — tables land in `<Static>` scrollback, which wraps rather than reflows the
 * live region.
 */
function renderTableAnsi(headerLine: string, separatorLine: string, rowLines: string[]): string[] {
  const header = splitTableRow(headerLine);
  const aligns: CellAlign[] = splitTableRow(separatorLine).map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
  const rows = rowLines.map(splitTableRow);

  const columnCount = Math.max(header.length, ...rows.map(row => row.length), aligns.length);
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...[header, ...rows].map(row => stringWidth(row[column] ?? ''))));

  const pad = (cell: string, column: number): string => {
    const fill = Math.max(0, widths[column] - stringWidth(cell));
    const align = aligns[column] ?? 'left';
    if (align === 'right') {
      return ' '.repeat(fill) + cell;
    }
    if (align === 'center') {
      const head = Math.floor(fill / 2);
      return ' '.repeat(head) + cell + ' '.repeat(fill - head);
    }
    return cell + ' '.repeat(fill);
  };

  const renderRow = (row: string[], style: (cell: string) => string): string =>
    Array.from({ length: columnCount }, (_, column) => {
      const cell = row[column] ?? '';
      // Pad on the raw text, style afterwards — ANSI codes carry no columns.
      const padded = pad(cell, column);
      const styled = style(renderInlineAnsi(cell));
      return padded.replace(cell, () => styled);
    }).join(`${DIM} │ ${RESET}`);

  return [
    renderRow(header, cell => `${BOLD}${cell}${RESET}`),
    `${DIM}${widths.map(width => '─'.repeat(width)).join('─┼─')}${RESET}`,
    ...rows.map(row => renderRow(row, cell => cell)),
  ];
}
