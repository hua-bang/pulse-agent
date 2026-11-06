import { BrowserWindow, Notification, ipcMain } from 'electron';
import { getLiveCanvasWindow, getOrCreateWindow } from '../../../main/app/window-manager';
import { activations } from '../registry';
import type { PluginNotificationEvent } from '../../../shared/api/settings-config';
import type {
  PluginNotificationDelivery,
  PluginNotificationInput,
} from '../../host-api-types';

export const PLUGIN_NOTIFICATION_CHANNEL = 'canvas-plugins:notification';

const MAX_TITLE = 200;
const MAX_BODY = 1000;

/** A shown OS notification must stay referenced, or its click handler is collected. */
const shown = new Set<Notification>();

/**
 * A plugin page to open in a Canvas window that a notification click had to
 * create. Its renderer subscribes only after it mounts, so it takes this once.
 * The handler lives here: no page can be pending before this module loads,
 * and the renderer ignores the missing handler until then.
 */
let pendingOpen: PluginNotificationEvent | null = null;
ipcMain.handle('canvas-plugins:take-pending-open', () => takePendingPluginOpen());

export function takePendingPluginOpen(): PluginNotificationEvent | null {
  const event = pendingOpen;
  pendingOpen = null;
  return event;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalize(pluginId: string, input: PluginNotificationInput): PluginNotificationEvent {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('Plugin notification title is required');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const path = typeof input.path === 'string' && input.path.startsWith('/') ? input.path : undefined;
  return {
    pluginId,
    title: clip(title, MAX_TITLE),
    ...(body ? { body: clip(body, MAX_BODY) } : {}),
    ...(path ? { path } : {}),
  };
}

function send(window: BrowserWindow, event: PluginNotificationEvent): void {
  window.webContents.send(PLUGIN_NOTIFICATION_CHANNEL, event);
}

/**
 * Tells the user something from a plugin. When the app window has focus the
 * user is looking at the app, so the renderer shows a toast. Otherwise the
 * host shows an OS notification; clicking it brings the window back and
 * opens the plugin page.
 */
export function showPluginNotification(
  pluginId: string,
  owner: object,
  input: PluginNotificationInput,
): PluginNotificationDelivery {
  if (activations.get(pluginId) !== owner) throw new Error(`Plugin ${pluginId} is no longer active`);
  const event = normalize(pluginId, input);
  // Only the Canvas window renders toasts; a focused sign-in popup does not.
  const canvas = getLiveCanvasWindow();
  if (canvas && BrowserWindow.getFocusedWindow() === canvas) {
    send(canvas, event);
    return 'in-app';
  }

  if (Notification.isSupported()) {
    const notification = new Notification({ title: event.title, body: event.body ?? '' });
    shown.add(notification);
    const release = () => shown.delete(notification);
    notification.on('click', () => {
      release();
      // On macOS the app keeps running with no window, so this may create one.
      // A new renderer takes the page to open when it mounts.
      const live = getLiveCanvasWindow();
      const window = getOrCreateWindow();
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (!event.path) return;
      if (window === live) send(window, { ...event, open: true });
      else pendingOpen = { ...event, open: true };
    });
    notification.on('close', release);
    notification.show();
    return 'system';
  }

  if (!canvas) return 'none';
  send(canvas, event);
  return 'in-app';
}
