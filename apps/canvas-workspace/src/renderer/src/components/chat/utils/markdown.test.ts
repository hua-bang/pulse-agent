import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('chat Markdown syntax highlighting', () => {
  it('highlights a supported TypeScript fence', () => {
    const html = renderMarkdown('```typescript\nconst answer: number = 42;\n```');

    expect(html).toContain('data-lang="typescript"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-built_in');
  });

  it('preserves highlighting for languages from the full common set', () => {
    const html = renderMarkdown('```ruby\nclass Greeter\nend\n```');

    expect(html).toContain('data-lang="ruby"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-title');
  });

  it('renders an unsupported language safely through auto-detection', () => {
    const html = renderMarkdown('```brainfuck\n++>---<\n```');

    expect(html).toContain('data-lang="brainfuck"');
    expect(html).toContain('&gt;');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('++>---<');
  });
});

describe('chat Markdown links', () => {
  it('preserves VS Code protocol links for editor handoff', () => {
    const html = renderMarkdown('[open file](vscode://file/root/project/src/App.tsx:12:3)');

    expect(html).toContain('href="vscode://file/root/project/src/App.tsx:12:3"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('preserves VS Code Insiders protocol links for editor handoff', () => {
    const html = renderMarkdown('[open file](vscode-insiders://file/root/project/src/App.tsx:12:3)');

    expect(html).toContain('href="vscode-insiders://file/root/project/src/App.tsx:12:3"');
  });
});
