import { promises as fs } from 'fs';
import { join } from 'path';
import {
  desktopCapturer,
  screen,
  systemPreferences,
  type Display,
  type NativeImage,
} from 'electron';
import { z } from 'zod';
import type { CanvasTool } from './types';
import { STORE_DIR } from './_shared/canvas-io';
import { getCanvasWindow } from '../../app/window-manager';

// Capture the OS screen, another app window, or this app's own canvas window
// and return it as a PNG file. The channel image relay (and the desktop chat)
// pick the file up from `outputPath` + `mimeType` and deliver it natively, so
// a Feishu/Discord user can ask the bot to "screenshot my screen" and get the
// image back in chat.

const MAX_WINDOW_NAMES = 30;

function screenshotsDir(workspaceId: string): string {
  // Global chat has no workspace; keep its captures in a shared bucket.
  return join(STORE_DIR, workspaceId || '_global', 'screenshots');
}

/** A capture's full pixel size, so the thumbnail is grabbed at native res. */
function pixelSize(display: Display): { width: number; height: number } {
  const factor = display.scaleFactor || 1;
  return {
    width: Math.max(1, Math.round(display.size.width * factor)),
    height: Math.max(1, Math.round(display.size.height * factor)),
  };
}

async function writePng(
  image: NativeImage,
  workspaceId: string,
  label: string,
): Promise<{ outputPath: string; width: number; height: number; bytes: number }> {
  const dir = screenshotsDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const { width, height } = image.getSize();
  const png = image.toPNG();
  const outputPath = join(dir, `${label}-${Date.now()}.png`);
  await fs.writeFile(outputPath, png);
  return { outputPath, width, height, bytes: png.length };
}

/**
 * macOS gates screen / other-window capture behind the Screen Recording
 * permission; without it `desktopCapturer` quietly returns black frames. Return
 * a clear, actionable error instead of sending a black image. Capturing this
 * app's OWN window (`capturePage`) does not need the permission, so callers
 * skip this check for the `app` target.
 */
function screenRecordingBlocked(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      return (
        `Screen Recording permission is "${status}". Grant it in System Settings → ` +
        'Privacy & Security → Screen Recording for this app (Pulse Canvas), then retry. ' +
        'Capturing the canvas window itself (target: "app") works without this permission.'
      );
    }
  } catch {
    // Non-darwin builds / older Electron without the API: don't block.
  }
  return null;
}

function clampDisplayIndex(raw: unknown, count: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), Math.max(0, count - 1));
}

async function captureApp(workspaceId: string): Promise<string> {
  const win = getCanvasWindow();
  if (!win) {
    return 'Error: the canvas-workspace window is not open, so there is nothing to capture.';
  }
  // A hidden/minimized window has a throttled (or blank) renderer; bring it
  // on-screen without stealing focus so the capture reflects the live canvas.
  if (!win.isVisible() || win.isMinimized()) {
    win.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const image = await win.webContents.capturePage();
  if (image.isEmpty()) {
    return 'Error: the canvas window capture was empty (the window may be off-screen).';
  }
  const meta = await writePng(image, workspaceId, 'canvas-window');
  return JSON.stringify(
    { ok: true, type: 'screenshot', target: 'app', title: win.getTitle() || 'Canvas window', mimeType: 'image/png', ...meta },
    null,
    2,
  );
}

async function captureWindow(workspaceId: string, match?: string): Promise<string> {
  const blocked = screenRecordingBlocked();
  if (blocked) return `Error: ${blocked}`;

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: pixelSize(screen.getPrimaryDisplay()),
  });
  const usable = sources.filter((s) => s.name && s.thumbnail && !s.thumbnail.isEmpty());
  if (usable.length === 0) {
    return 'Error: no capturable windows were found.';
  }

  const names = usable.map((s) => s.name).slice(0, MAX_WINDOW_NAMES).join(' | ');
  const needle = match?.trim();
  if (!needle) {
    return `Multiple windows are open — pass "match" with part of the target window's title. Open windows: ${names}`;
  }

  const lowered = needle.toLowerCase();
  const hits = usable.filter((s) => s.name.toLowerCase().includes(lowered));
  if (hits.length === 0) {
    return `Error: no open window title contains "${needle}". Open windows: ${names}`;
  }

  const chosen = hits[0];
  const meta = await writePng(chosen.thumbnail, workspaceId, 'window');
  return JSON.stringify(
    {
      ok: true,
      type: 'screenshot',
      target: 'window',
      title: chosen.name,
      matchedCount: hits.length,
      mimeType: 'image/png',
      ...meta,
    },
    null,
    2,
  );
}

async function captureScreen(workspaceId: string, displayInput: unknown): Promise<string> {
  const blocked = screenRecordingBlocked();
  if (blocked) return `Error: ${blocked}`;

  const displays = screen.getAllDisplays();
  const index = clampDisplayIndex(displayInput, displays.length);
  const display = displays[index] ?? screen.getPrimaryDisplay();

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: pixelSize(display),
  });
  if (sources.length === 0) {
    return 'Error: no screen sources were returned by the OS.';
  }
  // Match the requested display by id; fall back to positional / first source.
  const chosen =
    sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[index] ?? sources[0];
  if (!chosen || chosen.thumbnail.isEmpty()) {
    return (
      'Error: screen capture returned an empty image. On macOS this usually means ' +
      'Screen Recording permission has not been granted to this app.'
    );
  }

  const meta = await writePng(chosen.thumbnail, workspaceId, 'screen');
  return JSON.stringify(
    {
      ok: true,
      type: 'screenshot',
      target: 'screen',
      title: chosen.name,
      display: index,
      displayCount: displays.length,
      mimeType: 'image/png',
      ...meta,
    },
    null,
    2,
  );
}

export function createScreenshotTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_screenshot: {
      name: 'canvas_screenshot',
      defer_loading: true,
      description:
        'Take a screenshot (截图 / 截屏 / capture) and return it as a PNG so it can be sent back in chat ' +
        '(e.g. through the Feishu/Discord bot). Targets:\n' +
        '- "screen": capture an entire display (the whole screen 屏幕). Default. Use `display` to pick a monitor.\n' +
        '- "window": capture another open application window (某个窗口) matched by `match` (part of its title).\n' +
        '- "app": capture THIS Pulse Canvas / canvas-workspace window (the canvas 画布窗口).\n' +
        'Use this whenever the user asks to screenshot / capture / 截图 / 截屏 / 看一下屏幕或某个窗口. ' +
        'On macOS, "screen" and "window" need Screen Recording permission; "app" does not.',
      inputSchema: z.object({
        target: z
          .enum(['screen', 'window', 'app'])
          .optional()
          .describe('What to capture: "screen" (a whole display, default), "window" (another app window via match), or "app" (this canvas window).'),
        match: z
          .string()
          .optional()
          .describe('For target "window": case-insensitive substring of the target window title, e.g. "Chrome", "微信", "Figma".'),
        display: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('For target "screen": monitor index (0 = primary). Defaults to the primary display.'),
      }),
      execute: async (input) => {
        const target = (input.target as 'screen' | 'window' | 'app' | undefined) ?? 'screen';
        try {
          if (target === 'app') return await captureApp(workspaceId);
          if (target === 'window') return await captureWindow(workspaceId, input.match as string | undefined);
          return await captureScreen(workspaceId, input.display);
        } catch (err) {
          return `Error: screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}
