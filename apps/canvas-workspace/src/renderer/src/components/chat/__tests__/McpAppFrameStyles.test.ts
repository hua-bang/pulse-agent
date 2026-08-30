import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const mcpAppCss = readFileSync(new URL('../McpAppFrame.css', import.meta.url), 'utf8');

describe('MCP App frame styles', () => {
  it('keeps the portaled inline surface above the Right Dock that contains chat', () => {
    expect(mcpAppCss).toMatch(
      /\.chat-mcp-app__surface\s*\{[^}]*z-index:\s*calc\(var\(--layer-dock\) \+ 1\);/s,
    );
  });
});
