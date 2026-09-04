// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { SkillsLibraryLoading, SkillsRouteLoading } from './SkillsLibraryLoading';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

const render = async (element: React.ReactNode) => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(<I18nProvider>{element}</I18nProvider>);
  });
};

describe('SkillsLibraryLoading', () => {
  it('announces progress and keeps a stable four-row list skeleton', async () => {
    await render(<SkillsLibraryLoading />);

    const status = mount?.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-label')).toBe('Loading reusable workflows…');
    expect(mount?.querySelectorAll('.skills-library__loading-row')).toHaveLength(4);
  });

  it('marks the lazy route fallback as busy', async () => {
    await render(<SkillsRouteLoading />);

    expect(mount?.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  });
});
