/**
 * Freeze-time safety/restore probe for the webview lifecycle ladder.
 *
 * Key architectural fact this module exploits: in our ladder a page is
 * FROZEN (L2 — script execution disabled) before it can ever be discarded
 * (L3), and a frozen page cannot acquire new dirty state. So everything a
 * safe discard needs — unsaved-input detection, the real current URL, the
 * scroll position for restore — is captured ONCE here, at freeze time,
 * while guest scripts still run. The L3 sweep then consults the stored
 * record and never has to thaw-probe a candidate.
 *
 * The probe is time-bounded and FAIL-CLOSED: if the guest doesn't answer
 * in time (wedged page, navigation race) the record is marked dirty, so
 * the page simply never gets discarded. Pure module — structural types
 * instead of an electron import — so it is unit-testable.
 */

/** What the in-guest script reports (see FREEZE_PROBE_SCRIPT). */
export interface FreezeProbeResult {
  scrollX: number;
  scrollY: number;
  /** Unsaved in-page state: edited form control, focused editable, or
   *  non-empty contenteditable (no defaultValue exists for those, so any
   *  content is conservatively treated as possibly user-typed). */
  dirty: boolean;
  /** Any editable surface exists at all (diagnostic, not a discard veto). */
  hasEditable: boolean;
  /** Guest DOM has real content — turns `about:blank` non-reloadable,
   *  since a reload would wipe script/user-populated content. */
  nonTrivialDom: boolean;
}

/**
 * The per-node record the L3 discard monitor stores at freeze time, keyed
 * by `${workspaceId}::${nodeId}` (see discard-monitor.ts).
 */
export interface FreezeRecord {
  /** Last-frame capture for the sleeping placeholder (may be absent). */
  imageDataUrl?: string;
  /** Real guest URL at freeze time — may differ from the node's saved url
   *  after in-page navigation; this is what a wake should restore. */
  url: string;
  scrollX: number;
  scrollY: number;
  /** True blocks discard entirely (unsaved state would be lost). */
  dirty: boolean;
  /** False blocks discard (blob:/populated about:blank cannot reload). */
  reloadable: boolean;
}

export const FREEZE_PROBE_TIMEOUT_MS = 1_500;

/**
 * Runs in the guest with scripts still enabled (freeze happens after).
 * Kept lean: main document only — cross-origin frames can't be inspected
 * anyway, and same-origin subframe forms are rare enough that the
 * conservative contenteditable/control checks on the top document carry
 * the common cases.
 */
const FREEZE_PROBE_SCRIPT = `
  (function () {
    try {
      var doc = document;
      var controls = Array.prototype.slice.call(doc.querySelectorAll('input, textarea, select'));
      var controlsDirty = controls.some(function (control) {
        var tag = String(control.tagName || '').toLowerCase();
        if (tag === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
          return control.checked !== control.defaultChecked;
        }
        if (tag === 'select') {
          return Array.prototype.slice.call(control.options || []).some(function (option) {
            return option.selected !== option.defaultSelected;
          });
        }
        return typeof control.value === 'string'
          && typeof control.defaultValue === 'string'
          && control.value !== control.defaultValue;
      });
      var editableRoots = Array.prototype.slice.call(
        doc.querySelectorAll('[contenteditable]:not([contenteditable="false"])')
      );
      var editedContentEditable = editableRoots.some(function (el) {
        return String(el.textContent || '').trim().length > 0;
      });
      var active = doc.activeElement;
      var focusedEditable = Boolean(active && (
        active.isContentEditable
        || /^(input|textarea|select)$/i.test(String(active.tagName || ''))
      ));
      var body = doc.body;
      var nonTrivialDom = Boolean(
        (body && (body.children.length > 0 || String(body.textContent || '').trim().length > 0))
        || (doc.head && doc.head.children.length > 0)
      );
      return {
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        dirty: controlsDirty || editedContentEditable || focusedEditable,
        hasEditable: controls.length > 0 || editableRoots.length > 0,
        nonTrivialDom: nonTrivialDom,
      };
    } catch (err) {
      return null;
    }
  })();
`;

const isProbeResult = (value: unknown): value is FreezeProbeResult => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<FreezeProbeResult>;
  return typeof v.scrollX === 'number' && Number.isFinite(v.scrollX)
    && typeof v.scrollY === 'number' && Number.isFinite(v.scrollY)
    && typeof v.dirty === 'boolean'
    && typeof v.hasEditable === 'boolean'
    && typeof v.nonTrivialDom === 'boolean';
};

/**
 * Time-bounded guest probe. Resolves `undefined` on timeout, rejection, or
 * a malformed reply — callers must treat that as dirty (fail closed). Never
 * throws and never hangs: like capturePage, executeJavaScript against a
 * misbehaving guest must not stall the renderer's freeze IPC.
 */
export const probeFreezeState = (
  wc: { executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown> },
  timeoutMs = FREEZE_PROBE_TIMEOUT_MS,
): Promise<FreezeProbeResult | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    wc.executeJavaScript(FREEZE_PROBE_SCRIPT, false).then(
      (result) => {
        clearTimeout(timer);
        resolve(isProbeResult(result) ? result : undefined);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });

/**
 * Combine the main-side facts (url, snapshot) with the guest probe into the
 * freeze record. A missing probe yields a dirty, non-reloadable record: the
 * page stays resident until resumed — safe, just not reclaimable.
 */
export const buildFreezeRecord = (
  url: string,
  imageDataUrl: string | undefined,
  probe: FreezeProbeResult | undefined,
): FreezeRecord => {
  if (!probe) {
    return { imageDataUrl, url, scrollX: 0, scrollY: 0, dirty: true, reloadable: false };
  }
  const reloadable = !(
    url.startsWith('blob:')
    || (url.startsWith('about:blank') && probe.nonTrivialDom)
  );
  return {
    imageDataUrl,
    url,
    scrollX: probe.scrollX,
    scrollY: probe.scrollY,
    dirty: probe.dirty,
    reloadable,
  };
};
