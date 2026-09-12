// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode, IframeNodeData } from '../../../../../types';
import { IframeOverviewControl } from './IframeOverviewControl';
import { IframeOverviewBadge } from './IframeOverviewBadge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
const render = (content: React.ReactNode) => {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(<I18nProvider>{content}</I18nProvider>));
};
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  localStorage.clear();
});
const makeNode = (data: Partial<IframeNodeData> = {}): CanvasNode => ({
  id: 'preview-node', type: 'iframe', title: 'Quarterly planning',
  x: 0, y: 0, width: 900, height: 600,
  data: { mode: 'url', url: 'https://example.com/plan', faviconUrl: 'https://example.com/icon.png', ...data },
});

describe('overview preview control', () => {
  it('opts a legacy node in, preserves content, and can switch back from persisted data', () => {
    const node = makeNode();
    const update = vi.fn();
    render(<IframeOverviewControl node={node} onUpdate={update} />);
    let button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Show content');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    act(() => button.click());
    const patch = { data: { ...node.data, showContentAtOverview: true } };
    expect(update).toHaveBeenCalledWith(node.id, patch);
    render(<IframeOverviewControl node={{ ...node, ...JSON.parse(JSON.stringify(patch)) }} onUpdate={update} />);
    button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Show overview');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    act(() => button.click());
    expect(update).toHaveBeenLastCalledWith(node.id, { data: { ...node.data, showContentAtOverview: false } });
  });

  it('does not leak drag, double-click, keyboard, or click events to the canvas', () => {
    const bubble = vi.fn();
    const update = vi.fn();
    render(<div onPointerDown={bubble} onMouseDown={bubble} onClick={bubble} onDoubleClick={bubble} onKeyDown={bubble}>
      <IframeOverviewControl node={makeNode({ mode: 'html', html: '<h1>Hello</h1>' })} onUpdate={update} />
    </div>);
    const button = host.querySelector('button')!;
    act(() => {
      for (const name of ['pointerdown', 'mousedown', 'dblclick', 'keydown']) {
        button.dispatchEvent(new Event(name, { bubbles: true }));
      }
      button.click();
    });
    expect(bubble).not.toHaveBeenCalled();
    expect(update.mock.calls[0][1].data.html).toBe('<h1>Hello</h1>');
  });

  it('localizes the action labels', () => {
    localStorage.setItem('pulse-canvas.language', 'zh');
    render(<IframeOverviewControl node={makeNode()} onUpdate={vi.fn()} />);
    expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('显示内容');
  });
});

describe('title-first overview identity', () => {
  it('keeps the complete title and places the small source ahead of it', () => {
    render(<IframeOverviewBadge mode="url" url="https://www.example.com/page" title="很长的文档标题：产品设计与交互方案" />);
    expect(host.querySelector('.iframe-overview-badge-title')!.textContent).toBe('很长的文档标题：产品设计与交互方案');
    expect(host.querySelector('.iframe-overview-badge-host')!.textContent).toBe('example.com');
    expect(host.querySelector('.iframe-overview-badge')!.firstElementChild!.className).toBe('iframe-overview-badge-source');
  });
  it('falls back when a favicon fails and retries when its URL changes', () => {
    render(<IframeOverviewBadge mode="url" url="https://example.com" faviconUrl="https://example.com/bad.png" />);
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.iframe-overview-badge-tile svg')).not.toBeNull();
    render(<IframeOverviewBadge mode="url" url="https://example.com" faviconUrl="https://example.com/good.png" />);
    expect(host.querySelector('img')!.src).toBe('https://example.com/good.png');
    expect(host.querySelector('.iframe-overview-badge-host')).toBeNull();
  });
});
