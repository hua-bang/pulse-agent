// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import { EdgeStyleOptions } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EdgeStyleOptions', () => {
  it('emits the selected stroke width through its command interface', () => {
    const changeStroke = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider>
          <EdgeStyleOptions section="width" stroke={{ color: '#111', width: 1.6, style: 'solid' }} head="triangle" tail="none" changeStroke={changeStroke} changeHead={vi.fn()} changeTail={vi.fn()} />
        </I18nProvider>,
      );
    });
    act(() => { host.querySelectorAll<HTMLButtonElement>('button')[1]?.click(); });
    expect(changeStroke).toHaveBeenCalledWith({ width: 2.4 });
    act(() => root.unmount());
  });
});
