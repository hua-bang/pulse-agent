/**
 * Reads a live, registered canvas WebView without another network request.
 * Auto strategy cascade:
 *   1. DOM innerText.
 *   2. CDP accessibility tree.
 *   3. Bounded viewport scroll-and-stitch PNG for full-page vision input.
 * Current authentication and page state are preserved.
 */

import type { getWebContentsForNode } from './registry';
import type { DomElementSnapshotResult } from './dom-snapshot-script';

// ---------------------------------------------------------------------------
// Strategy implementations  (all take a live WebContents)
// ---------------------------------------------------------------------------

export type AnyWebContents = NonNullable<ReturnType<typeof getWebContentsForNode>>;

export async function wakeWebviewHostForCapture(wc: AnyWebContents): Promise<boolean> {
  return (await import('./screenshot-capture')).wakeWebviewHostForCapture(wc);
}

export async function restoreWebviewHostAfterCapture(wc: AnyWebContents): Promise<boolean> {
  return (await import('./screenshot-capture')).restoreWebviewHostAfterCapture(wc);
}

export async function readDOM(
  wc: AnyWebContents,
  maxChars: number,
): Promise<{ ok: boolean; text: string; title: string; url: string; error?: string }> {
  return (await import('./reader-strategies')).readDOM(wc, maxChars);
}

export async function readDOMElement(
  wc: AnyWebContents,
  selector: string,
  maxChars: number,
): Promise<DomElementSnapshotResult> {
  return (await import('./reader-strategies')).readDOMElement(wc, selector, maxChars);
}

export async function readA11y(
  wc: AnyWebContents,
): Promise<{ ok: boolean; text: string; error?: string }> {
  return (await import('./reader-strategies')).readA11y(wc);
}

export async function captureScreenshot(
  wc: AnyWebContents,
): Promise<{ ok: boolean; imagePath: string; error?: string }> {
  return (await import('./screenshot-capture')).captureScreenshot(wc);
}

// ---------------------------------------------------------------------------
// IPC payload types
// ---------------------------------------------------------------------------

export type WebReadStrategy = 'auto' | 'dom' | 'a11y' | 'screenshot';

export interface WebReadInput {
  workspaceId: string;
  nodeId: string;
  strategy?: WebReadStrategy;
  /** Max characters for DOM text extraction. Defaults to 12 000. */
  maxChars?: number;
  /**
   * In auto mode, minimum extracted text length to be considered "useful"
   * before trying the next strategy. Defaults to 200.
   */
  sparseThreshold?: number;
}

export type WebReadResult =
  | { ok: true;  nodeId: string; strategy: 'dom';        text: string; title: string; url: string }
  | { ok: true;  nodeId: string; strategy: 'a11y';       text: string }
  | { ok: true;  nodeId: string; strategy: 'screenshot'; imagePath: string }
  | { ok: false; nodeId: string; strategy: WebReadStrategy; error: string };
