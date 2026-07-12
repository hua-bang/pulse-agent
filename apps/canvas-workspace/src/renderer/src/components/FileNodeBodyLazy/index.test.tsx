import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '.';

describe('MarkdownPreview', () => {
  it('renders common Markdown structures without injecting raw HTML', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'# Heading\n- [x] done\n`code`\n<script>alert(1)</script>'} />,
    );

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('☑ done');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders links as escaped React elements', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'[site](https://example.com?a=1&b=2)'} />,
    );

    expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(html).toContain('>site</a>');
  });

  it('uses block spacing instead of extra break elements for Markdown blank lines', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview content={'## First\n\nParagraph\n\n## Second'} />,
    );

    expect(html).not.toContain('<br');
    expect(html).toContain('<h2>First</h2><p>Paragraph</p><h2>Second</h2>');
  });
});
