import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFocusedWindow = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow },
}));

import {
  getCanvasWindow,
  getLiveCanvasWindow,
  setWindowFactory,
} from './window-manager';

const createWindow = () => ({
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => true),
  isMinimized: vi.fn(() => false),
  showInactive: vi.fn(),
  webContents: {
    isLoading: vi.fn(() => false),
    executeJavaScript: vi.fn(),
  },
}) as unknown as BrowserWindow;

describe('window manager getters', () => {
  beforeEach(() => {
    getFocusedWindow.mockReset();
  });

  it('returns only the registered live Canvas window when a non-Canvas popup is focused', () => {
    const canvasWindow = createWindow();
    const oauthPopup = createWindow();
    const factory = vi.fn(() => canvasWindow);
    setWindowFactory(factory, canvasWindow);
    getFocusedWindow.mockReturnValue(oauthPopup);

    expect(getCanvasWindow()).toBe(oauthPopup);
    expect(getLiveCanvasWindow()).toBe(canvasWindow);
    expect(factory).not.toHaveBeenCalled();
    expect(canvasWindow.showInactive).not.toHaveBeenCalled();
    expect(canvasWindow.webContents.executeJavaScript).not.toHaveBeenCalled();
  });
});
