/**
 * Thin wrappers over Electron's default-protocol-client APIs for the http and
 * https schemes (a "default browser" owns both). Registration is best-effort:
 * the OS is the source of truth, so status is always read back from
 * `app.isDefaultProtocolClient`, never cached.
 *
 * Note: in unpackaged dev runs OS registration is unreliable and generally
 * non-persistent; `DefaultBrowserStatus.isPackaged` signals that to the UI.
 */

import { app } from 'electron';
import type { DefaultBrowserStatus } from '../../shared/default-browser';

const SCHEMES = ['http', 'https'] as const;

export function readDefaultBrowserStatus(): DefaultBrowserStatus {
  const http = app.isDefaultProtocolClient('http');
  const https = app.isDefaultProtocolClient('https');
  return {
    http,
    https,
    isDefault: http && https,
    isPackaged: app.isPackaged,
    platform: process.platform,
  };
}

export function setDefaultBrowser(enabled: boolean): DefaultBrowserStatus {
  for (const scheme of SCHEMES) {
    if (enabled) {
      app.setAsDefaultProtocolClient(scheme);
    } else {
      app.removeAsDefaultProtocolClient(scheme);
    }
  }
  return readDefaultBrowserStatus();
}
