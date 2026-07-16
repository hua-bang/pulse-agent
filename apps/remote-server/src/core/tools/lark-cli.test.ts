import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { larkCliTool } from './lark-cli.js';

describe('larkCliTool inputSchema', () => {
  it('converts to JSON schema without crashing (zod v4 record regression)', () => {
    expect(() => z.toJSONSchema(larkCliTool.inputSchema)).not.toThrow();
  });
});
