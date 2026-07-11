import { promises as fs } from 'node:fs';
import { parseArgs } from './args.mjs';
import { getPageTarget, getTargets, withPage, withTarget } from './cdp.mjs';
import { HarnessError } from './errors.mjs';
import { assertPoint, parseKeyCombo } from './input.mjs';
import { onboardHashRoute, openOnboard } from './navigation.mjs';
import { formatValue, printResult } from './output.mjs';
import {
  evaluateRenderer,
  focusAndClearExpression,
  pointForSelectorExpression,
  pointForTextExpression,
  uiSnapshotExpression,
} from './renderer.mjs';
import {
  clearCurrentSession,
  requireLiveSession,
  requireSession,
  stopSession,
} from './session.mjs';
import { isPidAlive, tailFile } from './utils.mjs';

export async function onboardCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  await openOnboard(session);
  printResult(opts.json, { opened: 'onboard', route: onboardHashRoute() }, [
    `Opened onboard workspace: ${onboardHashRoute()}`,
  ]);
}

export async function statusCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireSession();
  const target = await getPageTarget(session).catch(() => null);
  const status = {
    ...session,
    alive: isPidAlive(session.pid),
    cdpReady: !!target,
    target: target ? { id: target.id, title: target.title, url: target.url, type: target.type } : null,
  };
  printResult(opts.json, status, [
    `Harness session ${session.id}`,
    `alive=${status.alive}`,
    `cdpReady=${status.cdpReady}`,
    `profile=${session.profile}`,
    `home=${session.home}`,
    `artifacts=${session.artifactsDir}`,
  ]);
}

export async function snapshotUiCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  const snapshot = await evaluateRenderer(session, `(${uiSnapshotExpression})()`);
  printResult(opts.json, snapshot, [JSON.stringify(snapshot, null, 2)]);
}

export async function evalRendererCommand(rawArgs) {
  const { opts, positional } = parseArgs(rawArgs);
  if (positional.length === 0) throw new HarnessError('eval-renderer requires a JavaScript expression.');
  const session = await requireLiveSession();
  const value = await evaluateRenderer(session, positional.join(' '));
  printResult(opts.json, value, [formatValue(value)]);
}

export async function clickCommand(rawArgs) {
  const { opts, positional } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  let point;
  if (opts.xy) {
    const [xRaw, yRaw] = String(opts.xy).split(',');
    point = { x: Number(xRaw), y: Number(yRaw) };
  } else if (positional.length >= 2 && isFinite(Number(positional[0])) && isFinite(Number(positional[1]))) {
    point = { x: Number(positional[0]), y: Number(positional[1]) };
  } else if (opts.selector || positional[0]) {
    const selector = opts.selector ?? positional[0];
    point = await evaluateRenderer(session, `(${pointForSelectorExpression})(${JSON.stringify(selector)})`);
  } else if (opts.text) {
    point = await evaluateRenderer(session, `(${pointForTextExpression})(${JSON.stringify(opts.text)})`);
  } else {
    throw new HarnessError('click requires --selector, --text, --xy, or x y coordinates.');
  }
  assertPoint(point);
  await withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  });
  printResult(opts.json, { point }, [`Clicked at ${point.x}, ${point.y}`]);
}

export async function fillCommand(rawArgs) {
  const { opts, positional } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  const selector = opts.selector ?? positional.shift();
  const text = positional.join(' ');
  if (!selector || !text) throw new HarnessError('fill requires --selector <css> <text>.');
  const focusResult = await evaluateRenderer(session, `(${focusAndClearExpression})(${JSON.stringify(selector)})`);
  if (!focusResult?.ok) throw new HarnessError(focusResult?.error ?? `Could not focus ${selector}`);
  await withPage(session, async (cdp) => {
    await cdp.send('Input.insertText', { text });
  });
  printResult(opts.json, { selector, textLength: text.length }, [`Filled ${selector}`]);
}

export async function pressCommand(rawArgs) {
  const { opts, positional } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  const combo = positional.join(' ');
  if (!combo) throw new HarnessError('press requires a key or key combo, e.g. Escape or Meta+K.');
  const keyEvent = parseKeyCombo(combo);
  await withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyEvent });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent, text: undefined });
  });
  printResult(opts.json, { combo }, [`Pressed ${combo}`]);
}

export async function logsCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireSession();
  const lines = Number(opts.lines ?? 80);
  const logs = {};
  for (const [name, file] of Object.entries(session.logFiles ?? {})) {
    logs[name] = await tailFile(file, lines);
  }
  if (opts.json) {
    console.log(JSON.stringify({ files: session.logFiles, logs }, null, 2));
  } else {
    for (const [name, text] of Object.entries(logs)) {
      console.log(`--- ${name}: ${session.logFiles[name]} ---`);
      console.log(text || '(empty)');
    }
  }
}

export async function closeCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireSession();
  await stopSession(session, { cleanup: !!opts.cleanup });
  await clearCurrentSession();
  printResult(opts.json, { closed: true, cleaned: !!opts.cleanup }, [
    `Closed harness session ${session.id}${opts.cleanup ? ' and cleaned disposable HOME' : ''}.`,
  ]);
}

export async function resetArtifactsCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireSession();
  await fs.rm(session.artifactsDir, { recursive: true, force: true });
  printResult(opts.json, { removed: session.artifactsDir }, [`Removed artifacts: ${session.artifactsDir}`]);
}

function targetMatches(target, needle) {
  const value = String(needle ?? '').toLowerCase();
  return String(target.url ?? '').toLowerCase().includes(value)
    || String(target.title ?? '').toLowerCase().includes(value);
}

export async function verifyWebviewInputFocusCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const session = await requireLiveSession();
  const hostSelector = opts['host-selector'] ?? '.sidebar-layer-search-input';
  const guestSelector = opts['guest-selector'] ?? '#guest-input';
  const targetNeedle = opts.target ?? 'webview-input-fixture';
  const text = opts.text ?? 'webview-focus-check';

  const hostBefore = await evaluateRenderer(session, `(${focusAndClearExpression})(${JSON.stringify(hostSelector)})`);
  if (!hostBefore?.ok) throw new HarnessError(hostBefore?.error ?? `Could not focus host input ${hostSelector}`);

  const targets = await getTargets(session);
  const guest = targets.find((target) => target.webSocketDebuggerUrl && targetMatches(target, targetNeedle));
  if (!guest) throw new HarnessError(`No guest WebView target matching ${JSON.stringify(targetNeedle)}.`);

  // Mirror the product's `webContents.focus()` guard by focusing the owning
  // <webview> element from the host renderer. Page.bringToFront (and even
  // Target.activateTarget) alone does not transfer Chromium's input route.
  const webviewFocused = await evaluateRenderer(session, `(() => {
    const needle = ${JSON.stringify(targetNeedle)}.toLowerCase();
    const el = Array.from(document.querySelectorAll('webview')).find((candidate) =>
      String(candidate.getURL?.() || candidate.src || '').toLowerCase().includes(needle));
    if (!el) return false;
    el.focus();
    return true;
  })()`);
  if (!webviewFocused) throw new HarnessError(`No host <webview> element matching ${JSON.stringify(targetNeedle)}.`);

  const guestValue = await withTarget(guest, async (cdp) => {
    await cdp.send('Page.bringToFront');
    const prepared = await cdp.send('Runtime.evaluate', {
      expression: `(${focusAndClearExpression})(${JSON.stringify(guestSelector)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (!prepared?.result?.value?.ok) {
      throw new HarnessError(prepared?.result?.value?.error ?? `Could not focus guest input ${guestSelector}`);
    }
    await cdp.send('Input.insertText', { text });
    const value = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(guestSelector)})?.value ?? null`,
      returnByValue: true,
    });
    return value?.result?.value;
  });

  const hostValue = await evaluateRenderer(session,
    `(() => { const el = document.querySelector(${JSON.stringify(hostSelector)}); return el?.value ?? el?.textContent ?? null; })()`);
  const result = { ok: guestValue === text && !hostValue, guestValue, hostValue, target: guest.url };
  if (!result.ok) {
    throw new HarnessError(`WebView input focus leaked: ${JSON.stringify(result)}`);
  }
  printResult(opts.json, result, ['WebView input stayed in the guest target; host input remained empty.']);
}
