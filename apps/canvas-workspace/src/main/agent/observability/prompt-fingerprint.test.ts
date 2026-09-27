import { jsonSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { promptFingerprint } from './prompt-fingerprint';

const tools = () => ({
  canvas_read_node: { description: 'Read a node', inputSchema: z.object({ nodeId: z.string() }) },
  mcp_exa_search: { description: 'Search', inputSchema: jsonSchema({ type: 'object', properties: { q: { type: 'string' } } }) },
});

describe('prompt prefix fingerprint', () => {
  it('is stable for an equal prompt and tool list even when tool objects are rebuilt', () => {
    expect(promptFingerprint('system', tools())).toEqual(promptFingerprint('system', tools()));
  });

  it('changes when tool order, a schema, or the system prompt changes', () => {
    const base = promptFingerprint('system', tools());
    const [first, second] = Object.entries(tools());
    expect(promptFingerprint('system', Object.fromEntries([second, first])).toolsHash).not.toBe(base.toolsHash);
    expect(promptFingerprint('system', {
      ...tools(),
      canvas_read_node: { description: 'Read a node', inputSchema: z.object({ nodeId: z.number() }) },
    }).toolsHash).not.toBe(base.toolsHash);
    expect(promptFingerprint('system 2', tools()).systemHash).not.toBe(base.systemHash);
  });

  it('includes input schemas in the measured size and counts tools', () => {
    const fingerprint = promptFingerprint('system', tools());
    expect(fingerprint.toolCount).toBe(2);
    expect(fingerprint.mcpToolCount).toBe(1);
    expect(fingerprint.mcpToolsChars).toBeGreaterThan(0);
    expect(fingerprint.mcpToolsChars).toBeLessThan(fingerprint.toolsChars);
    expect(fingerprint.toolsChars).toBeGreaterThan(JSON.stringify(Object.keys(tools())).length + 40);
  });

  it('tolerates tools without a usable schema', () => {
    expect(promptFingerprint(undefined, { odd: { inputSchema: 42 }, bare: {} }).toolCount).toBe(2);
  });
});
