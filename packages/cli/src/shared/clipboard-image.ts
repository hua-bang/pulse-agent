import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Reads an image from the system clipboard and returns it as a `data:` URL.
 *
 * The terminal protocol does NOT carry clipboard images: when a user presses
 * Cmd/Ctrl+V in a terminal, only clipboard TEXT reaches the app (or nothing
 * at all when the clipboard holds a bitmap). To support "paste my screenshot"
 * the CLI must read the clipboard itself, outside the terminal.
 *
 * Platform backends (all shell out to a tiny helper; no native deps):
 * - macOS: `/usr/bin/swift` reads clipboard PNG data via AppKit. Swift ships
 *   with every macOS install (Command Line Tools), so no brew tools needed.
 * - Linux X11/Wayland: `xclip` / `wl-paste` (must be installed by the user).
 * - Windows: PowerShell + System.Windows.Forms.
 */
export interface ClipboardImageResult {
  /** `data:` URL ready for an AI SDK image part. */
  dataUrl: string;
  /** MIME type detected from the clipboard payload. */
  mimeType: string;
  /** How the image was obtained (for diagnostics). */
  source: string;
}

const MAX_CLIPBOARD_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The clipboard backend implementation is injectable so tests can pin its
 * behavior without depending on the real system clipboard.
 */
export type ClipboardImageBackend = (platform: NodeJS.Platform) => Promise<Buffer>;

function runCommand(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      maxBuffer: MAX_CLIPBOARD_IMAGE_BYTES + 64 * 1024,
      // Keep binary output as a Buffer — the default utf8 decoding replaces
      // non-text bytes with U+FFFD and corrupts PNG data.
      encoding: 'buffer',
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} failed: ${error.message}${stderr ? ` (${stderr.toString().trim()})` : ''}`));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

/** Turns raw PNG bytes into a data URL (pure, unit-testable). */
export function pngBufferToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

const MAC_SWIFT_SCRIPT = `
import AppKit

let pb = NSPasteboard.general
guard let data = pb.data(forType: .png) else {
  exit(0)
}
FileHandle.standardOutput.write(data)
`;

/**
 * macOS: read clipboard as PNG data via AppKit (Swift is bundled with macOS).
 *
 * Swift is invoked with a temp file (not `swift -`): the `-` form starts the
 * REPL, which reads stdin interactively and does not terminate cleanly from a
 * scripted child process. A temp file is plain script execution — measured
 * ~0.17s cold.
 */
async function readMacClipboardImage(): Promise<Buffer> {
  const scriptPath = path.join(os.tmpdir(), `pulse-clipboard-${process.pid}-${Date.now()}.swift`);
  try {
    await fs.writeFile(scriptPath, MAC_SWIFT_SCRIPT);
    return await runCommand('/usr/bin/swift', [scriptPath]);
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
}

/** Linux: xclip (X11) or wl-paste (Wayland). */
async function readLinuxClipboardImage(): Promise<Buffer> {
  const candidates: Array<[string, string[]]> = [
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
    ['wl-paste', ['--no-newline', '--type', 'image/png']],
  ];
  for (const [cmd, args] of candidates) {
    try {
      const out = await runCommand(cmd, args);
      if (out.length > 0) {
        return out;
      }
    } catch {
      // try the next backend
    }
  }
  throw new Error('clipboard image read failed (need xclip on X11 or wl-paste on Wayland)');
}

/** Windows: PowerShell + System.Windows.Forms clipboard image. */
async function readWindowsClipboardImage(): Promise<Buffer> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($null -eq $img) { exit 0 }',
    '$ms = New-Object System.IO.MemoryStream',
    '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
    '[Convert]::ToBase64String($ms.ToArray())',
  ].join('; ');
  const out = await runCommand('powershell', ['-NoProfile', '-Command', script]);
  const base64 = out.toString('utf-8').trim();
  if (!base64) {
    return Buffer.alloc(0);
  }
  return Buffer.from(base64, 'base64');
}

export async function readClipboardImage(
  platform: NodeJS.Platform = process.platform,
  backend: ClipboardImageBackend = readPlatformClipboardImage,
): Promise<ClipboardImageResult | null> {
  const buffer = await backend(platform);
  if (buffer.length === 0) {
    return null;
  }
  if (buffer.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error(`clipboard image too large (${buffer.length} bytes, limit ${MAX_CLIPBOARD_IMAGE_BYTES})`);
  }
  return { dataUrl: pngBufferToDataUrl(buffer), mimeType: 'image/png', source: 'platform backend' };
}

/** Default backend: dispatch to the platform-specific clipboard reader. */
export async function readPlatformClipboardImage(platform: NodeJS.Platform): Promise<Buffer> {
  if (platform === 'darwin') {
    return await readMacClipboardImage();
  }
  if (platform === 'linux') {
    return await readLinuxClipboardImage();
  }
  if (platform === 'win32') {
    return await readWindowsClipboardImage();
  }
  throw new Error(`clipboard image reading is not supported on ${platform}`);
}
