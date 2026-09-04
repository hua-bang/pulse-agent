import { DOM_MENTION_PREFIX } from '../ChatMentionPopup/constants';
import type { AgentContextDomReviewComment } from '../../../../types';

function escapeDomMentionPart(value: string): string {
  return value.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Batch DOM review comments → one composer prompt with `@[dom:...]` markers.
 * (Moved out of ChatPanel for the 500-line governance gate.)
 */
export function buildDomReviewPrompt(comments: AgentContextDomReviewComment[]): string {
  const lines = [
    `Apply these ${comments.length} DOM review comments to the selected web UI elements.`,
    '',
  ];
  comments.forEach((comment, index) => {
    const selection = comment.selection;
    const label = escapeDomMentionPart(selection.label || `DOM selection ${index + 1}`);
    const marker = `@[${DOM_MENTION_PREFIX}${selection.id}|${label}]`;
    lines.push(`${index + 1}. ${marker}`);
    lines.push(`   Comment: ${comment.text.trim()}`);
    lines.push(`   Selector: ${selection.selector}`);
    if (selection.text) {
      const excerpt = selection.text.replace(/\s+/g, ' ').trim().slice(0, 220);
      if (excerpt) lines.push(`   Element text: ${excerpt}`);
    }
  });
  return lines.join('\n');
}
