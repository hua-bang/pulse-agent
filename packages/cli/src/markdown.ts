const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Lean markdown-to-ANSI renderer for terminal transcripts.
 *
 * Scope is deliberately small (headings, bullets, blockquotes, rules, fenced
 * code markers, inline bold/code/links). Code block content is left untouched
 * so copy/paste from the terminal stays valid.
 */
export function renderMarkdownAnsi(source: string): string {
  const lines = source.split('\n');
  const rendered: string[] = [];
  let inFence = false;

  for (const line of lines) {
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
  let result = line;
  result = result.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  result = result.replace(/`([^`]+)`/g, `${CYAN}$1${RESET}`);
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${CYAN}$1${RESET} ${DIM}($2)${RESET}`);
  return result;
}
