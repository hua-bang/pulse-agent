import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from './args.mjs';
import { HarnessError } from './errors.mjs';
import { printResult } from './output.mjs';
import { requireLiveSession } from './session.mjs';
import { execFileText } from './utils.mjs';
import { withPage } from './cdp.mjs';

export async function screenshotCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  const output = resolve(opts.output ?? join(session.artifactsDir, `screenshot-${Date.now()}.png`));
  const methods = screenshotMethods(opts.method ?? 'auto');
  const errors = [];

  for (const method of methods) {
    try {
      const result = method === 'system'
        ? await captureSystemScreenshot(session, output)
        : await captureCdpScreenshot(session, output);
      printResult(opts.json, { output, method: result.method }, [
        `Screenshot saved: ${output}`,
        `method=${result.method}`,
      ]);
      return;
    } catch (err) {
      errors.push(`${method}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new HarnessError(`Screenshot failed. ${errors.join(' | ')}`);
}

function screenshotMethods(method) {
  if (method === 'system' || method === 'cdp') return [method];
  if (method !== 'auto') {
    throw new HarnessError(`Unknown screenshot method: ${method}`);
  }
  return process.platform === 'darwin' ? ['cdp', 'system'] : ['cdp'];
}

async function captureSystemScreenshot(session, output) {
  if (process.platform !== 'darwin') {
    throw new HarnessError('system screenshot is only implemented for macOS.');
  }
  const windowId = await getMacWindowId(session.pid);
  await fs.mkdir(dirname(output), { recursive: true });
  await execFileText('screencapture', [
    '-x',
    '-l',
    String(windowId),
    output,
  ], { timeoutMs: 10_000 });
  const stat = await fs.stat(output);
  if (stat.size <= 0) throw new HarnessError('screencapture wrote an empty file.');
  return { method: 'system-screencapture', windowId };
}

async function getMacWindowId(pid) {
  const script = `
import CoreGraphics
import Foundation

let targetPid = ${Number(pid)}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
let candidates = windows.filter { window in
  (window[kCGWindowOwnerPID as String] as? Int ?? -1) == targetPid
}

func windowName(_ window: [String: Any]) -> String {
  return window[kCGWindowName as String] as? String ?? ""
}

let selected = candidates.first { windowName($0).contains("Pulse Canvas") }
  ?? candidates.first { !windowName($0).hasPrefix("Developer Tools") }
  ?? candidates.first

if let selected, let number = selected[kCGWindowNumber as String] as? Int {
  print(number)
} else {
  exit(2)
}
`;
  const raw = await execFileText('swift', ['-e', script], { timeoutMs: 45_000 });
  const windowId = Number(raw.trim());
  if (!Number.isFinite(windowId) || windowId <= 0) {
    throw new HarnessError(`Could not resolve macOS window id: ${raw}`);
  }
  return windowId;
}

async function captureCdpScreenshot(session, output) {
  await fs.mkdir(dirname(output), { recursive: true });
  await withPage(session, async (cdp, target) => {
    await cdp.send('Page.enable', {}, 5_000).catch(() => {});
    await cdp.send('Target.activateTarget', { targetId: target.id }, 5_000).catch(() => {});
    await cdp.send('Page.bringToFront', {}, 5_000).catch(() => {});
    await normalizeCdpWindow(cdp, target.id).catch(() => {});
    let result;
    try {
      const clip = await viewportClip(cdp).catch(() => null);
      result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        ...(clip ? { clip } : {}),
      }, 10_000);
    } catch {
      result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, 10_000);
    }
    await fs.writeFile(output, Buffer.from(result.data, 'base64'));
  });
  return { method: 'cdp-captureScreenshot' };
}

async function normalizeCdpWindow(cdp, targetId) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId }, 5_000);
  if (!windowId) return;
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'normal' },
  }, 5_000);
}

async function viewportClip(cdp) {
  const viewport = await cdp.send('Runtime.evaluate', {
    expression: '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 })',
    awaitPromise: true,
    returnByValue: true,
  }, 5_000);
  const value = viewport.result?.value;
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { x: 0, y: 0, width, height, scale: 1 };
}
