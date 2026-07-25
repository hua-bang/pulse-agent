import { describe, it, expect } from 'vitest';
import z from 'zod';

import { searchToolsBm25, searchToolsRegex } from './utils';
import type { Tool } from '../../shared/types';

const tool = (name: string, description: string, shape: z.ZodRawShape = {}): Tool =>
  ({ name, description, inputSchema: z.object(shape), execute: async () => '' }) as unknown as Tool;

/**
 * Regression suite for tool-search ranking.
 *
 * Both cases below are real defects observed against the canvas agent's 35
 * deferred tools, where a short keyword query could not reach the tool whose
 * NAME matched it.
 */
describe('searchToolsBm25', () => {
  it('reaches a snake_case tool from the parts of its name', () => {
    // The name is the only place "create" appears — `canvas_create_edge`'s real
    // description says "Connect two nodes ... with an arrow". Tokenizing `_` as
    // a word character made the name one unmatchable token, so this query
    // returned the tool nowhere in its results.
    const tools = {
      canvas_create_edge: tool('canvas_create_edge', 'Connect two nodes on the canvas with an arrow.'),
      canvas_screenshot: tool('canvas_screenshot', 'Capture the current window.'),
    };

    const names = searchToolsBm25(tools, 'create edge').map((r) => r.toolName);

    expect(names).toContain('canvas_create_edge');
  });

  it('keeps exact full-name queries working', () => {
    const tools = {
      canvas_create_edge: tool('canvas_create_edge', 'Connect two nodes on the canvas with an arrow.'),
      canvas_delete_edge: tool('canvas_delete_edge', 'Remove an edge.'),
    };

    expect(searchToolsBm25(tools, 'canvas_create_edge')[0]?.toolName).toBe('canvas_create_edge');
  });

  it('ranks a name hit above the same term in an argument description', () => {
    // DEFAULT_WEIGHTS gives name 3 and argDescription 1, but the bm25 path used
    // to flatten every field into one blob, dropping the weights entirely.
    const tools = {
      canvas_move_node: tool('canvas_move_node', 'Reposition something.'),
      unrelated_tool: tool('unrelated_tool', 'Does other things.', {
        target: z.string().describe('Ignored when you move node records around.'),
      }),
    };

    expect(searchToolsBm25(tools, 'move node')[0]?.toolName).toBe('canvas_move_node');
  });

  it('returns no results for a query with no indexable tokens', () => {
    const tools = { canvas_create_edge: tool('canvas_create_edge', 'Connect two nodes.') };

    // Documents current behaviour: the tokenizer is ASCII-only, so a CJK query
    // yields zero tokens and searchToolsBm25 bails out. Tracked separately.
    expect(searchToolsBm25(tools, '连线')).toEqual([]);
  });
});

describe('searchToolsRegex', () => {
  it('scores by field weight', () => {
    const tools = {
      canvas_create_edge: tool('canvas_create_edge', 'Connect two nodes.'),
      other_tool: tool('other_tool', 'Mentions edge only in prose.'),
    };

    expect(searchToolsRegex(tools, 'edge')[0]?.toolName).toBe('canvas_create_edge');
  });
});
