import { BrowserWindow, Notification } from 'electron';
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

function firstWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
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
  input: PluginNotificationInput,
): PluginNotificationDelivery {
  const event = normalize(pluginId, input);
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    send(focused, event);
    return 'in-app';
  }

  if (Notification.isSupported()) {
    const notification = new Notification({ title: event.title, body: event.body ?? '' });
    shown.add(notification);
    const release = () => shown.delete(notification);
    notification.on('click', () => {
      release();
      const window = firstWindow();
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (event.path) send(window, { ...event, open: true });
    });
    notification.on('close', release);
    notification.show();
    return 'system';
  }

  const window = firstWindow();
  if (!window) return 'none';
  send(window, event);
  return 'in-app';
}
