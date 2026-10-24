import { describe, expect, it } from 'vitest';
import { formatQuickActionBlock, formatQuickActionLines } from './quick-action-context';

describe('formatQuickActionLines', () => {
  it('adds the hidden instructions for the knowledge summary action', () => {
    const lines = formatQuickActionLines('summarize_knowledge_node');
    expect(lines[0]).toBe('- Suggested action the user invoked: summarize_knowledge_node');
    expect(lines[1]).toContain('knowledge_read_node');
  });

  it('names an unknown action without extra guidance', () => {
    expect(formatQuickActionLines('custom')).toEqual(['- Suggested action the user invoked: custom']);
  });

  it('gives the global prompt a section only when an action was invoked', () => {
    expect(formatQuickActionBlock(undefined)).toBe('');
    expect(formatQuickActionBlock('summarize_knowledge_node')).toContain('knowledge_read_node');
  });
});
