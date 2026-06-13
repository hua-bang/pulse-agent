import { app, ipcMain } from 'electron';

const DEFAULT_DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev';
const DEFAULT_MANIFEST_URL = `${DEFAULT_DOWNLOAD_URL}/latest.json`;

interface UpdateManifest {
  version?: unknown;
  releasedAt?: unknown;
  downloadUrl?: unknown;
  notes?: unknown;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const configUrl = (envName: string, fallback: string): string => {
  const value = process.env[envName]?.trim();
  return value && isHttpUrl(value) ? value : fallback;
};

const normalizeVersion = (version: string): number[] => {
  const base = version.trim().replace(/^v/i, '').split(/[+-]/, 1)[0];
  return base.split('.').map((part) => {
    const numeric = Number.parseInt(part, 10);
    return Number.isFinite(numeric) ? numeric : 0;
  });
};

const compareVersions = (a: string, b: string): number => {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  const max = Math.max(left.length, right.length, 3);

  for (let index = 0; index < max; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }

  return 0;
};

const sanitizeManifest = (manifest: UpdateManifest, fallbackDownloadUrl: string) => {
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  if (!version) {
    throw new Error('manifest missing version');
  }

  const downloadUrl =
    typeof manifest.downloadUrl === 'string' && isHttpUrl(manifest.downloadUrl)
      ? manifest.downloadUrl
      : fallbackDownloadUrl;

  return {
    version,
    releasedAt: typeof manifest.releasedAt === 'string' ? manifest.releasedAt : undefined,
    downloadUrl,
    notes: typeof manifest.notes === 'string' ? manifest.notes : undefined,
  };
};

export function setupUpdateIpc(): void {
  ipcMain.handle('app:getInfo', async () => {
    const downloadUrl = configUrl('PULSE_CANVAS_DOWNLOAD_URL', DEFAULT_DOWNLOAD_URL);
    const updateManifestUrl = configUrl('PULSE_CANVAS_UPDATE_MANIFEST_URL', DEFAULT_MANIFEST_URL);

    return {
      ok: true,
      version: app.getVersion(),
      updateManifestUrl,
      downloadUrl,
    };
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    const currentVersion = app.getVersion();
    const downloadUrl = configUrl('PULSE_CANVAS_DOWNLOAD_URL', DEFAULT_DOWNLOAD_URL);
    const updateManifestUrl = configUrl('PULSE_CANVAS_UPDATE_MANIFEST_URL', DEFAULT_MANIFEST_URL);

    try {
      const response = await fetch(updateManifestUrl, { cache: 'no-store' });
      if (!response.ok) {
        return {
          ok: false,
          currentVersion,
          error: `manifest request failed: ${response.status}`,
        };
      }

      const manifest = sanitizeManifest((await response.json()) as UpdateManifest, downloadUrl);
      return {
        ok: true,
        currentVersion,
        updateAvailable: compareVersions(manifest.version, currentVersion) > 0,
        latest: manifest,
      };
    } catch (err) {
      return {
        ok: false,
        currentVersion,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export { compareVersions };
