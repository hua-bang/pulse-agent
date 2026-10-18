// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { WorkspaceNodeListItem } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import { RightDockProvider } from '../../../dock/internal/RightDock';

const node = (
  id: string,
  overrides: Partial<WorkspaceNodeListItem> = {},
): WorkspaceNodeListItem => ({
  id,
  type: 'text',
  title: `Node ${id}`,
  tags: [],
  hasData: true,
  linkCount: 0,
  workspaceId: 'ws-1',
  workspaceName: 'One',
  ...overrides,
});

// Ten tags so the tag row collapses past its visible limit.
const TAGS = Array.from({ length: 10 }, (_, index) => `tag-${index}`);
const NODES = [
  node('a', { tags: TAGS }),
  node('b', { type: 'file', tags: ['tag-0'] }),
  node('c', { workspaceId: 'ws-2', workspaceName: 'Two' }),
];

vi.mock('../useWorkspaceNodes', () => ({
  useAllWorkspaceNodeList: () => ({
    nodes: NODES,
    tags: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import { NodesPage } from '../NodesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const WORKSPACES = [
  { id: 'ws-1', name: 'One' },
  { id: 'ws-2', name: 'Two' },
] as WorkspaceEntry[];

const renderPage = () => {
  window.localStorage.setItem('pulse-canvas.language', 'en');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider>
      <RightDockProvider>
        <NodesPage workspaces={WORKSPACES} />
      </RightDockProvider>
    </I18nProvider>,
  ));
  return host;
};

const chips = (page: HTMLElement, row: string) => Array.from(
  page.querySelectorAll<HTMLButtonElement>(`.knowledge-node-facet-row[aria-label="${row}"] button`),
);

const chip = (page: HTMLElement, row: string, label: string) => {
  const match = chips(page, row).find((button) => button.textContent?.startsWith(label));
  if (!match) throw new Error(`Expected a ${row} chip named ${label}`);
  return match;
};

const subtitle = (page: HTMLElement) => (
  page.querySelector('.workspace-nodes-page__header p')?.textContent
);

describe('NodesPage inline filters', () => {
  it('applies a filter with one click and a second click on the same chip clears it', () => {
    const page = renderPage();

    act(() => chip(page, 'Types', 'File').click());
    expect(subtitle(page)).toBe('1 / 3 nodes');
    expect(chip(page, 'Types', 'File').getAttribute('aria-pressed')).toBe('true');

    act(() => chip(page, 'Types', 'File').click());
    expect(subtitle(page)).toBe('3 nodes');
    expect(chip(page, 'Types', 'All').getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows from all workspaces to the clicked workspace', () => {
    const page = renderPage();

    act(() => chip(page, 'Workspaces', 'Two').click());
    expect(subtitle(page)).toBe('1 / 3 nodes');
    expect(chip(page, 'Workspaces', 'One').getAttribute('aria-pressed')).toBe('false');

    act(() => chip(page, 'Workspaces', 'Two').click());
    expect(chip(page, 'Workspaces', 'All').getAttribute('aria-pressed')).toBe('true');
  });

  it('collapses long tag lists behind a toggle', () => {
    const page = renderPage();
    // "All", eight tags, then the "+N" toggle for the rest (two tags plus "Untagged").
    expect(chips(page, 'Tags')).toHaveLength(10);

    const more = chip(page, 'Tags', '+3');
    act(() => more.click());
    expect(chips(page, 'Tags').map((button) => button.textContent)).toContain('Untagged1');
  });
});
