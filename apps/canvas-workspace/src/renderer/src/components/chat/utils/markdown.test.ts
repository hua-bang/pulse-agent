import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('chat Markdown syntax highlighting', () => {
  it('highlights a supported TypeScript fence', () => {
    const html = renderMarkdown('```typescript\nconst answer: number = 42;\n```');

    expect(html).toContain('data-lang="typescript"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-built_in');
  });

  it('renders an unsupported language safely through auto-detection', () => {
    const html = renderMarkdown('```brainfuck\n++>---<\n```');

    expect(html).toContain('data-lang="brainfuck"');
    expect(html).toContain('&gt;');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('++>---<');
  });
});
