import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  const createWindow = () => ({
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  });
  return {
    createWindow,
    focused: null as ReturnType<typeof createWindow> | null,
    windows: [] as ReturnType<typeof createWindow>[],
    supported: true,
    notifications: [] as Array<{ options: unknown; handlers: Record<string, () => void>; show: ReturnType<typeof vi.fn> }>,
  };
});

vi.mock('electron', () => {
  class Notification {
    static isSupported = () => fakes.supported;
    handlers: Record<string, () => void> = {};
    show = vi.fn();
    constructor(public options: unknown) {
      fakes.notifications.push(this);
    }
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
      return this;
    }
  }
  return {
    Notification,
    BrowserWindow: {
      getFocusedWindow: () => fakes.focused,
      getAllWindows: () => fakes.windows,
    },
  };
});

const { PLUGIN_NOTIFICATION_CHANNEL, showPluginNotification } = await import('./plugin-notify');

beforeEach(() => {
  fakes.windows = [fakes.createWindow()];
  fakes.focused = null;
  fakes.supported = true;
  fakes.notifications = [];
});

describe('showPluginNotification', () => {
  it('shows a toast in the focused window', () => {
    fakes.focused = fakes.windows[0];

    expect(showPluginNotification('calendar', { title: ' Standup starts ', body: 'In 5 minutes', path: '/calendar' })).toBe('in-app');
    expect(fakes.focused.webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, {
      pluginId: 'calendar',
      title: 'Standup starts',
      body: 'In 5 minutes',
      path: '/calendar',
    });
    expect(fakes.notifications).toHaveLength(0);
  });

  it('shows an OS notification when the app is in the background, and a click opens the plugin page', () => {
    expect(showPluginNotification('calendar', { title: 'Standup ended', path: '/calendar' })).toBe('system');
    const [notification] = fakes.notifications;
    expect(notification.options).toEqual({ title: 'Standup ended', body: '' });
    expect(notification.show).toHaveBeenCalled();

    notification.handlers.click();
    const [window] = fakes.windows;
    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, {
      pluginId: 'calendar',
      title: 'Standup ended',
      path: '/calendar',
      open: true,
    });
  });

  it('falls back to a toast without OS notification support, and rejects an empty title', () => {
    fakes.supported = false;
    expect(showPluginNotification('calendar', { title: 'Hi', path: 'not-a-route' })).toBe('in-app');
    expect(fakes.windows[0].webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, { pluginId: 'calendar', title: 'Hi' });
    fakes.windows = [];
    expect(showPluginNotification('calendar', { title: 'Hi' })).toBe('none');
    expect(() => showPluginNotification('calendar', { title: '  ' })).toThrow(/title is required/);
  });
});
