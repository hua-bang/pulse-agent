// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '../PageHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

describe('ui/PageHeader', () => {
  it('renders every slot in one header, with the title as the page heading', () => {
    const el = render(
      <PageHeader
        className="page-x"
        kicker="Library"
        title="Knowledge"
        titleAccessory={<button type="button">Graph</button>}
        description="12 nodes"
        actions={<button type="button">Refresh</button>}
      />,
    );
    const header = el.querySelector('header.ui-page-header.page-x')!;
    expect(header.querySelector('.ui-page-header__kicker')?.textContent).toBe('Library');
    expect(header.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(header.querySelector('.ui-page-header__title-row button')?.textContent).toBe('Graph');
    expect(header.querySelector('.ui-page-header__description')?.textContent).toBe('12 nodes');
    expect(header.querySelector('.ui-page-header__actions button')?.textContent).toBe('Refresh');
  });

  it('omits the optional slots when they are not given', () => {
    const el = render(<PageHeader title="Scheduled" />);
    expect(el.querySelector('.ui-page-header__kicker')).toBeNull();
    expect(el.querySelector('.ui-page-header__description')).toBeNull();
    expect(el.querySelector('.ui-page-header__actions')).toBeNull();
  });
});
