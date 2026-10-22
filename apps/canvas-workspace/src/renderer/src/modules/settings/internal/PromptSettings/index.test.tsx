// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import type { PromptProfileStatus } from '../../../../types';
import { ReplyStyleSection } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = { preset: 'balanced', customPrompt: '' } as PromptProfileStatus;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const render = (onSave: (next: unknown) => Promise<void>) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <I18nProvider>
        <ReplyStyleSection
          profile={profile}
          onClose={vi.fn()}
          onSave={onSave}
          onReset={vi.fn(async () => {})}
        />
      </I18nProvider>,
    );
  });
};

describe('ReplyStyleSection', () => {
  it('saves an unsaved draft when the section is left', () => {
    const onSave = vi.fn(async () => {});
    render(onSave);
    act(() => {
      host!.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0].click();
    });
    act(() => root?.unmount());
    root = null;
    expect(onSave).toHaveBeenCalledWith({ preset: 'concise', customPrompt: '' });
  });

  it('does not save when nothing changed', () => {
    const onSave = vi.fn(async () => {});
    render(onSave);
    act(() => root?.unmount());
    root = null;
    expect(onSave).not.toHaveBeenCalled();
  });
});
