// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import DOMPurify from 'dompurify';
import { describe, expect, it, vi } from 'vitest';
import { renderTextPreview } from './textPreview';

const preview = (content: string): HTMLDivElement => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<>{renderTextPreview(content)}</>);
  return host;
};

describe('Text node passive rich-content preview', () => {
  it('does not parse empty content', () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');
    try {
      expect(renderTextPreview('')).toBeNull();
      expect(sanitize).not.toHaveBeenCalled();
    } finally {
      sanitize.mockRestore();
    }
  });

  it('preserves headings, paragraphs, marks, quotes, and line breaks from stored HTML', () => {
    const view = preview([
      '<h1>Title</h1><h2>Subtitle</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>',
      '<p><b>bold</b> <i>italic</i> <u>underline</u> <s>strike</s> <del>deleted</del> <code>code</code><br>next</p>',
      '<blockquote><p>quoted</p></blockquote>',
    ].join(''));

    expect(view.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(6);
    expect(view.querySelector('strong')?.textContent).toBe('bold');
    expect(view.querySelector('em')?.textContent).toBe('italic');
    expect(view.querySelector('u')?.textContent).toBe('underline');
    expect(view.querySelector('s')?.textContent).toBe('strike');
    expect(view.querySelector('del')?.textContent).toBe('deleted');
    expect(view.querySelector('code')?.textContent).toBe('code');
    expect(view.querySelector('blockquote p')?.textContent).toBe('quoted');
    expect(view.querySelector('br')?.nextSibling?.textContent).toBe('next');
  });

  it('preserves text color and multicolor highlights without copying unrelated CSS', () => {
    const view = preview('<p><span style="color: rgb(255, 0, 0); position: fixed; font-size: 999px">red</span>'
      + '<mark data-color="#00ff00" style="background-color: blue; color: inherit; background-image: url(https://example.com/a)">green</mark>'
      + '<mark style="background-color: yellow; color: red">yellow</mark></p>');
    const span = view.querySelector('span');
    const marks = view.querySelectorAll('mark');

    expect(span?.style.color).toBe('rgb(255, 0, 0)');
    expect(span?.style.position).toBe('');
    expect(span?.style.fontSize).toBe('');
    expect(marks[0].style.backgroundColor).toBe('#00ff00');
    expect(marks[0].style.color).toBe('inherit');
    expect(marks[0].style.backgroundImage).toBe('');
    expect(marks[0].hasAttribute('data-color')).toBe(false);
    expect(marks[1].style.backgroundColor).toBe('yellow');
    expect(marks[1].style.color).toBe('red');
  });

  it('preserves ordered-list starts and nested bullet lists', () => {
    const view = preview('<ol start="4"><li><p>four</p><ul><li><p>nested</p></li></ul></li><li><p>five</p></li></ol>');

    expect(view.querySelector('ol')?.start).toBe(4);
    expect(view.querySelectorAll('li')).toHaveLength(3);
    expect(view.querySelector('ol > li > ul > li')?.textContent).toBe('nested');
  });

  it('renders the supported Markdown subset with no generated blank lines', () => {
    const view = preview('# Title\n\n3. three\n4. four\n\n- one\n- two\n\n> quote\n\n**bold** *italic* ~~gone~~ `code`\nnext');

    expect(view.querySelector('h1')?.textContent).toBe('Title');
    expect(view.querySelector('ol')?.start).toBe(3);
    expect(view.querySelectorAll('ul li')).toHaveLength(2);
    expect(view.querySelector('blockquote')?.textContent).toBe('quote');
    expect(view.querySelector('strong')?.textContent).toBe('bold');
    expect(view.querySelector('em')?.textContent).toBe('italic');
    expect(view.querySelector('s')?.textContent).toBe('gone');
    expect(view.querySelector('code')?.textContent).toBe('code');
    expect(view.querySelector('br')?.nextSibling?.textContent).toBe('next');
    expect(Array.from(view.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)).toHaveLength(0);
  });

  it('keeps plaintext, escaped markup, Unicode, and entities as text', () => {
    const view = preview('你好 &amp; &lt;script&gt;literal&lt;/script&gt; 2 < 3\nsecond line');

    expect(view.textContent).toBe('你好 & <script>literal</script> 2 < 3second line');
    expect(view.querySelector('script')).toBeNull();
    expect(view.querySelectorAll('br')).toHaveLength(1);
    expect(preview('').innerHTML).toBe('');
  });

  it('retains only explicitly permitted link protocols and supplies a fixed rel', () => {
    const view = preview('<p><a href="https://example.com/path?q=1&amp;x=2" target="_self" rel="opener">https</a>'
      + '<a href="http://example.com">http</a><a href="mailto:test@example.com">mail</a>'
      + '<a href="javascript:alert(1)">javascript</a><a href="data:text/html,test">data</a>'
      + '<a href="file:///tmp/a">file</a><a href="//example.com">relative</a><a href="#section">hash</a></p>');
    const links = view.querySelectorAll('a');

    expect(links).toHaveLength(3);
    expect(links[0].getAttribute('href')).toBe('https://example.com/path?q=1&x=2');
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    }
    expect(view.textContent).toBe('httpshttpmailjavascriptdatafilerelativehash');
  });

  it('does not add autolinks beyond the current Text-node Markdown behavior', () => {
    const view = preview('https://example.com [linked](https://example.com)');

    expect(view.querySelectorAll('a')).toHaveLength(1);
    expect(view.querySelector('a')?.textContent).toBe('linked');
  });

  // These are regression fixtures for our configuration and React projection.
  // DOMPurify's security guarantee depends on the production Chromium DOM;
  // happy-dom alone is not a browser-security acceptance test.
  it('removes active/embedded subtrees and arbitrary or event attributes', () => {
    const view = preview('<p id="location" class="evil" onclick="alert(1)" contenteditable="true">safe'
      + '<script>alert(1)</script><style>body{display:none}</style><iframe>frame</iframe>'
      + '<svg><a href="javascript:alert(1)"><text>svg</text></a></svg><object data="x">object</object>'
      + '<img src="https://example.com/a" onerror="alert(1)"><form><input autofocus><button>button</button></form>'
      + '<span onmouseover="alert(1)" style="color: blue; background: url(https://example.com)">blue</span></p>');

    expect(view.querySelector('script, style, iframe, svg, object, img, form, input, button')).toBeNull();
    expect(view.textContent).not.toMatch(/alert\(1\)|display:none|frame|svg|object|button/);
    expect(view.textContent).toContain('safeblue');
    for (const element of view.querySelectorAll('*')) {
      expect(element.hasAttribute('id')).toBe(false);
      expect(element.hasAttribute('class')).toBe(false);
      expect(element.hasAttribute('contenteditable')).toBe(false);
      expect(Array.from(element.attributes).some((attribute) => attribute.name.startsWith('on'))).toBe(false);
    }
    expect(view.querySelector('span')?.style.backgroundImage).toBe('');
  });

  it.each([
    '<p><a href="java&#x09;script:alert(1)">tab</a><a href="java&#x0a;script:alert(1)">newline</a></p>',
    '<svg><g/onload=alert(1)//<p>safe</p>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<p><span style="color: red; background-image: url(javascript:alert(1))">safe</span></p>',
  ])('keeps malformed payloads out of the supported visual output: %s', (content) => {
    const view = preview(content);

    expect(view.querySelector('svg, math, script, style, img, iframe')).toBeNull();
    for (const element of view.querySelectorAll('*')) {
      expect(Array.from(element.attributes).some((attribute) => attribute.name.startsWith('on'))).toBe(false);
      expect(element.getAttribute('href') ?? '').not.toMatch(/javascript|data:|file:/i);
      expect(element.getAttribute('style') ?? '').not.toMatch(/url\(|expression\(|position|background-image/i);
    }
  });
});
