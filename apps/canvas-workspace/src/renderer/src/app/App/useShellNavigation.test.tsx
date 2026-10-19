// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useRailExpanded, useSettingsNavigation } from './useShellNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSettingsNavigation', () => {
  it('returns to the page that opened settings, even after switching sections', () => {
    const setLocation = vi.fn();
    let api!: ReturnType<typeof useSettingsNavigation>;
    const Harness = ({ location, activeView }: { location: string; activeView: string }) => {
      api = useSettingsNavigation({ location, activeView, setLocation });
      return null;
    };
    const root = createRoot(document.createElement('div'));

    act(() => root.render(<Harness location="/chat" activeView="chat" />));
    act(() => api.openAppSettings('models'));
    expect(setLocation).toHaveBeenLastCalledWith('/settings?section=models');

    act(() => root.render(<Harness location="/settings?section=models" activeView="settings" />));
    act(() => api.openAppSettings('plugins'));
    act(() => api.closeAppSettings());
    expect(setLocation).toHaveBeenLastCalledWith('/chat');

    // With no remembered origin, closing falls back to the canvas.
    act(() => api.closeAppSettings());
    expect(setLocation).toHaveBeenLastCalledWith('/');
    act(() => root.unmount());
  });
});

describe('useRailExpanded', () => {
  const renderRail = () => {
    let state!: ReturnType<typeof useRailExpanded>;
    const Harness = () => {
      state = useRailExpanded();
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Harness />));
    return { get: () => state, unmount: () => act(() => root.unmount()) };
  };

  it('starts wide on first launch and remembers a later collapse', () => {
    window.localStorage.removeItem('pulse-canvas.rail-expanded');
    const first = renderRail();
    expect(first.get()[0]).toBe(true);
    act(() => first.get()[1]());
    expect(first.get()[0]).toBe(false);
    first.unmount();

    const second = renderRail();
    expect(second.get()[0]).toBe(false);
    second.unmount();
    window.localStorage.removeItem('pulse-canvas.rail-expanded');
  });
});
