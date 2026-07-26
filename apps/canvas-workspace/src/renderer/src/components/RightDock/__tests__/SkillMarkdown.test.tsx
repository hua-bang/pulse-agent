// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillMarkdown } from '../SkillMarkdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SkillMarkdown', () => {
  const hosts: HTMLDivElement[] = [];

  afterEach(() => {
    for (const host of hosts) host.remove();
    hosts.length = 0;
  });

  const renderMarkdown = (content: string) => {
    const host = document.createElement('div');
    hosts.push(host);
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<SkillMarkdown content={content} />));
    return { host, root };
  };

  it('renders tables as a horizontally contained reading surface', () => {
    const { host, root } = renderMarkdown([
      '| Topic | Use for |',
      '| --- | --- |',
      '| Routing | URL patterns |',
    ].join('\n'));

    expect(host.querySelector('.skill-detail__table-scroll')).not.toBeNull();
    expect(host.querySelectorAll('th')).toHaveLength(2);
    expect(host.querySelector('td')?.textContent).toBe('Routing');
    act(() => root.unmount());
  });

  it('escapes embedded HTML instead of executing it', () => {
    const { host, root } = renderMarkdown('<script>window.pwned = true</script>');

    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>');
    act(() => root.unmount());
  });

  it('keeps the pane heading above document headings', () => {
    const { host, root } = renderMarkdown('# Primary\n\n## Section');

    expect(host.querySelector('h1')).toBeNull();
    expect(host.querySelector('h2')?.textContent).toBe('Primary');
    expect(host.querySelector('h3')?.textContent).toBe('Section');
    act(() => root.unmount());
  });

  it('does not load images or unsafe links from Skill content', () => {
    const { host, root } = renderMarkdown([
      '![tracking pixel](https://tracker.example/pixel.png)',
      '[unsafe](javascript:alert(1))',
    ].join('\n\n'));

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.skill-detail__image-placeholder')?.textContent)
      .toBe('tracking pixel');
    expect(host.querySelector('a')).toBeNull();
    act(() => root.unmount());
  });
});
