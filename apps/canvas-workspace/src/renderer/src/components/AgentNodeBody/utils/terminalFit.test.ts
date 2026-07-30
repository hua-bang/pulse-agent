import { describe, expect, it, vi } from 'vitest';
import type { FitAddon, ITerminalDimensions } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { fitTerminalIfSane, MIN_FITTABLE_TERMINAL_COLS } from './terminal';

const fakeTerminal = (cols: number, rows: number): Terminal => ({ cols, rows } as Terminal);

const fakeFit = (proposed: ITerminalDimensions | undefined) => {
  const fit = vi.fn();
  return {
    addon: { fit, proposeDimensions: () => proposed } as unknown as FitAddon,
    fit,
  };
};

describe('fitTerminalIfSane', () => {
  it('applies a fit once the container measures to a usable width', () => {
    const { addon, fit } = fakeFit({ cols: 120, rows: 30 });
    expect(fitTerminalIfSane(fakeTerminal(80, 24), addon)).toBe(true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('refuses the handful of columns a mid-layout container proposes', () => {
    // This is the line-compression defect: applying cols=4 makes an agent CLI
    // hard-wrap every line it prints, and no later re-fit can reflow that.
    const { addon, fit } = fakeFit({ cols: 4, rows: 12 });
    expect(fitTerminalIfSane(fakeTerminal(80, 24), addon)).toBe(false);
    expect(fit).not.toHaveBeenCalled();
    expect(MIN_FITTABLE_TERMINAL_COLS).toBeGreaterThan(4);
  });

  it('refuses when the container is not measurable at all', () => {
    const { addon, fit } = fakeFit(undefined);
    expect(fitTerminalIfSane(fakeTerminal(80, 24), addon)).toBe(false);
    expect(fit).not.toHaveBeenCalled();
  });

  it('reports success without re-fitting when the geometry already matches', () => {
    const { addon, fit } = fakeFit({ cols: 80, rows: 24 });
    expect(fitTerminalIfSane(fakeTerminal(80, 24), addon)).toBe(true);
    expect(fit).not.toHaveBeenCalled();
  });

  it('survives a throwing addon and a missing terminal', () => {
    const throwing = {
      fit: vi.fn(),
      proposeDimensions: () => { throw new Error('detached'); },
    } as unknown as FitAddon;
    expect(fitTerminalIfSane(fakeTerminal(80, 24), throwing)).toBe(false);
    expect(fitTerminalIfSane(null, fakeFit({ cols: 120, rows: 30 }).addon)).toBe(false);
  });
});
