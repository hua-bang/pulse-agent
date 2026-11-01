// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from '.';
import { loadMessages } from './messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
let i18n: ReturnType<typeof useI18n> | null = null;

const Probe = () => {
  i18n = useI18n();
  return null;
};

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  window.localStorage.clear();
  root = null;
  mount = null;
  i18n = null;
});

describe('I18nProvider', () => {
  it('keeps the latest choice when an earlier catalog finishes loading later', async () => {
    window.localStorage.setItem('pulse-canvas.language', 'en');
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    await act(async () => {
      root?.render(<I18nProvider><Probe /></I18nProvider>);
    });

    await act(async () => {
      i18n?.setLanguage('zh');
      i18n?.setLanguage('en');
      await loadMessages('zh');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(i18n?.language).toBe('en');
    expect(window.localStorage.getItem('pulse-canvas.language')).toBe('en');
  });
});
