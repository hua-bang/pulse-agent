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

describe('Markdown preview soft line breaks', () => {
  it('preserves the existing chat line-break default', () => {
    expect(renderMarkdown('first\nsecond')).toBe('<p>first<br>\nsecond</p>\n');
  });

  it('allows note previews to keep soft breaks without changing explicit hard breaks', () => {
    expect(renderMarkdown('first\nsecond', { softBreaks: false })).toBe('<p>first\nsecond</p>\n');
    expect(renderMarkdown('first  \nsecond', { softBreaks: false })).toBe('<p>first<br>\nsecond</p>\n');
  });

  it('keeps both render modes isolated in the settled-content cache', () => {
    const content = 'same note\ndifferent preview mode';
    const soft = renderMarkdown(content, { softBreaks: false });
    const chat = renderMarkdown(content);
    expect(soft).not.toContain('<br>');
    expect(chat).toContain('<br>');
    expect(renderMarkdown(content, { softBreaks: false })).toBe(soft);
    expect(renderMarkdown(content, { softBreaks: true })).toBe(chat);
  });

  it('uses the same mode when streaming bypasses the settled cache', () => {
    expect(renderMarkdown('first\nsecond', { softBreaks: false, streaming: true }))
      .toBe('<p>first\nsecond</p>\n');
    expect(renderMarkdown('first\nsecond', { streaming: true }))
      .toContain('<br>');
  });
});
