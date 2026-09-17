// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileContent } from '../FileContent';
import { I18nProvider } from '../../../../../../i18n';
import { copyTextToClipboard } from '../../../../../../utils/clipboard';

vi.mock('../../../../../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const content = '# Preview\n\n```ts\nconst value = 1;\n```';
const render = (source: boolean) => act(() => root.render(
  <I18nProvider><FileContent path="note.md" content={content} source={source} /></I18nProvider>,
));
const copyButton = () => {
  const button = host.querySelector<HTMLButtonElement>('[data-action="copy-code"]');
  if (!button) throw new Error('Missing rendered copy button');
  return button;
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(copyTextToClipboard).mockResolvedValue(undefined);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe('file Markdown preview public integration', () => {
  it('renders Markdown and copies code through the public preview surface', async () => {
    render(false);
    expect(host.querySelector('.folder-browser__markdown .chat-md h1')?.textContent).toBe('Preview');
    await act(async () => copyButton().click());
    expect(copyTextToClipboard).toHaveBeenCalledWith('const value = 1;\n');
    expect(copyButton().textContent).toBe('Copied');
  });

  it('restores the copy label when clipboard access fails', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('denied'));
    render(false);
    await act(async () => copyButton().click());
    expect(copyButton().textContent).toBe('Copy');
  });

  it('switches to literal source and back without retaining code-preview markup', () => {
    render(false);
    render(true);
    expect(host.querySelector('.folder-browser__markdown')).toBeNull();
    expect(host.querySelector('.folder-browser__code code')?.textContent).toBe(content);
    render(false);
    expect(host.querySelector('h1')?.textContent).toBe('Preview');
  });
});
