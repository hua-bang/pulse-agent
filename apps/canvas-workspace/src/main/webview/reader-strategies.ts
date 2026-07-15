import { createDomElementSnapshotScript, type DomElementSnapshotResult } from './dom-snapshot-script';
import { withCdp, type CdpSender } from './cdp-session';
import type { AnyWebContents } from './reader';

const EXTRACT_TIMEOUT_MS = 8_000;

export async function readDOM(
  wc: AnyWebContents,
  maxChars: number,
): Promise<{ ok: boolean; text: string; title: string; url: string; error?: string }> {
  const script = `
    (function () {
      try {
        return {
          ok: true,
          title: document.title || '',
          text: document.body ? (document.body.innerText || document.body.textContent || '') : '',
          url: location.href,
        };
      } catch (err) {
        return { ok: false, title: '', text: '', url: '', error: String(err) };
      }
    })();
  `;

  try {
    const raw = await Promise.race([
      wc.executeJavaScript(script, false) as Promise<{
        ok: boolean; title: string; text: string; url: string; error?: string;
      }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DOM extraction timed out')), EXTRACT_TIMEOUT_MS),
      ),
    ]);

    if (!raw.ok) return { ok: false, text: '', title: '', url: '', error: raw.error };

    const cleaned = (raw.text ?? '').replace(/\s+/g, ' ').trim();
    const truncated = maxChars > 0 && cleaned.length > maxChars;
    const text = truncated ? cleaned.slice(0, maxChars) + '\n\n[…content truncated]' : cleaned;

    return { ok: true, text, title: raw.title, url: raw.url };
  } catch (err) {
    return { ok: false, text: '', title: '', url: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readDOMElement(
  wc: AnyWebContents,
  selector: string,
  maxChars: number,
): Promise<DomElementSnapshotResult> {
  const script = createDomElementSnapshotScript(selector, maxChars);

  try {
    const raw = await Promise.race([
      wc.executeJavaScript(script, false) as Promise<DomElementSnapshotResult>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DOM element extraction timed out')), EXTRACT_TIMEOUT_MS),
      ),
    ]);

    return raw.ok ? raw : { ...raw, ok: false };
  } catch (err) {
    return {
      ok: false,
      title: '',
      url: '',
      selector,
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Flatten an AX node tree into indented readable text. */
function flattenA11yNodes(
  nodes: Array<{
    nodeId: string;
    role?: { value?: string };
    name?: { value?: string };
    description?: { value?: string };
    value?: { value?: string };
    childIds?: string[];
  }>,
  idMap: Map<string, (typeof nodes)[number]>,
  nodeId: string,
  depth = 0,
  lines: string[] = [],
): string[] {
  const node = idMap.get(nodeId);
  if (!node) return lines;

  const role = node.role?.value ?? '';
  const name = node.name?.value?.trim() ?? '';
  const desc = node.description?.value?.trim() ?? '';
  const val = node.value?.value?.trim() ?? '';

  if (role && role !== 'none' && role !== 'unknown' && role !== 'generic') {
    const parts: string[] = [role];
    if (name) parts.push(`"${name}"`);
    if (desc) parts.push(`(${desc})`);
    if (val) parts.push(`= ${val}`);
    lines.push(`${'  '.repeat(depth)}${parts.join(' ')}`);
  }

  for (const childId of node.childIds ?? []) {
    flattenA11yNodes(nodes, idMap, childId, depth + 1, lines);
  }

  return lines;
}

export async function readA11y(
  wc: AnyWebContents,
): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    // Go through the per-wc mutex so a concurrent screenshot read or
    // CDP-based click can't race us on `debugger.attach`.
    const result = await withCdp(wc, async (send: CdpSender) => {
      await send('Accessibility.enable');
      return (await Promise.race([
        send<{
          nodes: Array<{
            nodeId: string;
            role?: { value?: string };
            name?: { value?: string };
            description?: { value?: string };
            value?: { value?: string };
            childIds?: string[];
          }>;
        }>('Accessibility.getFullAXTree'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('a11y extraction timed out')), EXTRACT_TIMEOUT_MS),
        ),
      ]));
    });

    const { nodes } = result;
    const idMap = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes[0];
    const lines = root ? flattenA11yNodes(nodes, idMap, root.nodeId) : [];
    return { ok: true, text: lines.join('\n') || '(empty a11y tree)' };
  } catch (err) {
    return { ok: false, text: '', error: err instanceof Error ? err.message : String(err) };
  }
}
