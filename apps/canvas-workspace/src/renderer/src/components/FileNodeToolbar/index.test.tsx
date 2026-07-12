// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { FileNodeToolbar } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const renderToolbar = (statusText: string, statusTone: 'saving' | 'saved' | 'error', modified = false) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const noop = vi.fn();
  act(() => root?.render(
    <I18nProvider>
      <FileNodeToolbar
        onOpenFile={noop}
        onSave={noop}
        onSaveAs={noop}
        onInsertImage={noop}
        onOpenFind={noop}
        onToggleOutline={noop}
        onMoveBlockUp={noop}
        onMoveBlockDown={noop}
        onDuplicateBlock={noop}
        onDeleteBlock={noop}
        outlineOpen={false}
        statusText={statusText}
        statusTone={statusTone}
        modified={modified}
        fileName="note.md"
      />
    </I18nProvider>,
  ));
  return host;
};

describe('FileNodeToolbar save feedback', () => {
  it('announces a failed save and exposes the error tone', () => {
    const view = renderToolbar('Save failed', 'error');
    const status = view.querySelector<HTMLElement>('[role="status"]');

    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    expect(status?.dataset.active).toBe('true');
    expect(status?.querySelector('.note-status--error')?.textContent).toBe('Save failed');
  });

  it('marks an idle filename hint as inactive so narrow docks can hide only the hint', () => {
    const view = renderToolbar('', 'saved');

    expect(view.querySelector<HTMLElement>('[role="status"]')?.dataset.active).toBe('false');
    expect(view.querySelector('.note-file-hint-inline')?.textContent).toBe('note.md');
  });
});
