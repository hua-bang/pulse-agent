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
    focused: null as unknown,
    canvas: null as ReturnType<typeof createWindow> | null,
    created: false,
    owner: {},
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
    ipcMain: { handle: vi.fn() },
    BrowserWindow: {
      getFocusedWindow: () => fakes.focused,
    },
  };
});

vi.mock('../registry', () => ({ activations: new Map([['calendar', fakes.owner]]) }));

vi.mock('../../../main/app/window-manager', () => ({
  getLiveCanvasWindow: () => fakes.canvas,
  getOrCreateWindow: () => {
    if (fakes.created) fakes.canvas = fakes.createWindow();
    return fakes.canvas;
  },
}));


const OWNER = fakes.owner;
const { PLUGIN_NOTIFICATION_CHANNEL, showPluginNotification, takePendingPluginOpen } = await import('./plugin-notify');

beforeEach(() => {
  fakes.canvas = fakes.createWindow();
  fakes.focused = null;
  fakes.created = false;
  fakes.supported = true;
  fakes.notifications = [];
});

describe('showPluginNotification', () => {
  it('shows a toast in the focused window', () => {
    fakes.focused = fakes.canvas;

    expect(showPluginNotification('calendar', OWNER, { title: ' Standup starts ', body: 'In 5 minutes', path: '/calendar' })).toBe('in-app');
    expect(fakes.canvas!.webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, {
      pluginId: 'calendar',
      title: 'Standup starts',
      body: 'In 5 minutes',
      path: '/calendar',
    });
    expect(fakes.notifications).toHaveLength(0);
  });

  it('shows an OS notification when the app is in the background, and a click opens the plugin page', () => {
    expect(showPluginNotification('calendar', OWNER, { title: 'Standup ended', path: '/calendar' })).toBe('system');
    const [notification] = fakes.notifications;
    expect(notification.options).toEqual({ title: 'Standup ended', body: '' });
    expect(notification.show).toHaveBeenCalled();

    notification.handlers.click();
    expect(fakes.canvas!.webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, {
      pluginId: 'calendar',
      title: 'Standup ended',
      path: '/calendar',
      open: true,
    });
  });

  it('falls back to a toast without OS notification support, and rejects an empty title', () => {
    fakes.supported = false;
    expect(showPluginNotification('calendar', OWNER, { title: 'Hi', path: 'not-a-route' })).toBe('in-app');
    expect(fakes.canvas!.webContents.send).toHaveBeenCalledWith(PLUGIN_NOTIFICATION_CHANNEL, { pluginId: 'calendar', title: 'Hi' });
    fakes.canvas = null;
    expect(showPluginNotification('calendar', OWNER, { title: 'Hi' })).toBe('none');
    expect(() => showPluginNotification('calendar', OWNER, { title: '  ' })).toThrow(/title is required/);
  });

  it('uses an OS notification when another window, such as a sign-in popup, has focus', () => {
    fakes.focused = { popup: true };
    expect(showPluginNotification('calendar', OWNER, { title: 'Standup' })).toBe('system');
    expect(fakes.canvas!.webContents.send).not.toHaveBeenCalled();
  });

  it('opens the plugin page in a window that the click had to create', () => {
    fakes.canvas = null;
    showPluginNotification('calendar', OWNER, { title: 'Standup', path: '/plugin/calendar' });
    fakes.created = true;
    fakes.notifications[0].handlers.click();

    expect(takePendingPluginOpen()).toEqual({
      pluginId: 'calendar',
      title: 'Standup',
      path: '/plugin/calendar',
      open: true,
    });
    expect(takePendingPluginOpen()).toBeNull();
  });

  it('refuses a plugin activation that has ended', () => {
    expect(() => showPluginNotification('calendar', {}, { title: 'x' })).toThrow(/no longer active/);
  });
});
