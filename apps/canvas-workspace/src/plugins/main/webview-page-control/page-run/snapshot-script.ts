import type { ReadingRegion } from './types';

// Code-owned DOM instrumentation, executed in a separate Electron world.
// No selectors or JavaScript supplied by Jev are evaluated.
export interface SnapshotCommand {
  mode: 'observe' | 'fresh' | 'action_fresh' | 'target' | 'inspect' | 'reveal' | 'scroll_fresh' | 'scroll' | 'cleanup';
  runId: string;
  reading?: ReadingRegion;
  snapshotId?: string;
  ref?: string;
  strict?: boolean;
  direction?: 'up' | 'down';
  focused?: boolean;
  point?: { x: number; y: number };
}

export function snapshotScript(command: SnapshotCommand): string {
  return String.raw`(function(input) {
    const slot = '__pulsePageRun';
    if (input.mode === 'cleanup') {
      if (globalThis[slot]?.runId === input.runId) {
        for (const entry of globalThis[slot].targets.values()) entry.node.removeAttribute('data-pulse-run');
        delete globalThis[slot];
      }
      return true;
    }
    if (!document.body) throw new Error('Page has no body');
    if (input.mode === 'observe' && globalThis[slot]?.runId !== input.runId) {
      globalThis[slot] = { runId: input.runId, documentId: input.runId + ':' + performance.timeOrigin + ':' + Date.now(), seq: 0,
        nodes: new WeakMap(), next: 0, targets: new Map(), scrollers: new Map(), snapshot: null };
    }
    const cache = globalThis[slot];
    const answer = result => input.mode === 'target' ? result.status === 'ready' : result;
    if (!cache || cache.runId !== input.runId) return ['fresh', 'action_fresh', 'scroll_fresh'].includes(input.mode) ? false
      : answer({ status: 'stale', reason: 'document_changed' });
    const safe = e => !['password', 'file', 'hidden'].includes((e.getAttribute('type') || '').toLowerCase());
    const enabled = e => !e.matches(':disabled') && !e.closest('[inert],[aria-disabled="true"],[aria-hidden="true"]');
    const rendered = e => {
      if (!e.isConnected || !enabled(e) || !safe(e)) return false;
      const r = e.getBoundingClientRect(), style = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const placement = (e, point) => {
      const r = e.getBoundingClientRect();
      const x = point ? point.x : r.x + r.width / 2;
      const y = point ? point.y : r.y + r.height / 2;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
        return { status: 'stale', reason: 'coordinates_changed' };
      }
      let clipped = false, scrollable = false;
      for (let p = e.parentElement; p; p = p.parentElement) {
        // The document scrollport is the viewport, not the moving root box.
        if (p === document.documentElement || p === document.scrollingElement) continue;
        const s = getComputedStyle(p), box = p.getBoundingClientRect();
        const clipsX = /auto|scroll|hidden|clip/.test(s.overflowX);
        const clipsY = /auto|scroll|hidden|clip/.test(s.overflowY);
        const outsideX = x < box.left + p.clientLeft || x >= box.left + p.clientLeft + p.clientWidth;
        const outsideY = y < box.top + p.clientTop || y >= box.top + p.clientTop + p.clientHeight;
        if ((clipsX && outsideX) || (clipsY && outsideY)) {
          clipped = true;
          if ((outsideY && /auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight)
            || (outsideX && /auto|scroll/.test(s.overflowX) && p.scrollWidth > p.clientWidth)) scrollable = true;
        }
      }
      if (clipped) return { status: scrollable ? 'needs_scroll' : 'blocked', reason: 'clipped_by_scroll_container' };
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        const root = document.scrollingElement || document.documentElement;
        return { status: root.scrollHeight > innerHeight || root.scrollWidth > innerWidth ? 'needs_scroll' : 'blocked', reason: 'outside_viewport' };
      }
      return e.contains(document.elementFromPoint(x, y))
        ? { status: 'ready' } : { status: 'blocked', reason: 'covered_by_other_element' };
    };
    const name = e => {
      const labelled = (e.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      return (labelled || e.getAttribute('aria-label') || Array.from(e.labels || []).map(n => n.textContent).join(' ')
        || e.getAttribute('placeholder') || e.innerText || e.getAttribute('title') || e.value || e.tagName)
        .replace(/\s+/g, ' ').trim().slice(0, 160);
    };
    // Exact values stay in isolated-world guards; only model previews are bounded.
    const value = e => String(e.value ?? (e.isContentEditable ? e.innerText : ''));
    const identity = e => {
      if (!cache.nodes.has(e)) cache.nodes.set(e, 'e' + (++cache.next));
      return cache.nodes.get(e);
    };
    const semantic = e => JSON.stringify([e.tagName, name(e), e.getAttribute('role'),
      e.getAttribute('href'), e.href || null, e.getAttribute('type'), e.readOnly, e.disabled,
      e.getAttribute('aria-disabled'), e.getAttribute('aria-expanded'), e.checked,
      e.getAttribute('target'), e.getAttribute('aria-controls')]);
    const formState = e => {
      const form = e.closest('form,[role="dialog"],[aria-modal="true"]');
      if (!form) return '';
      return JSON.stringify([identity(form), Array.from(form.querySelectorAll('input,textarea,select'))
        .filter(safe).map(field => [identity(field), value(field), field.checked, field.disabled, field.readOnly])]);
    };
    const scrollSemantic = e => JSON.stringify([e.tagName, e.id, e.getAttribute('role'),
      e.getAttribute('aria-label'), e.getAttribute('aria-labelledby')]);
    const scrollable = e => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 2
      && /auto|scroll|overlay/.test(getComputedStyle(e).overflowY);
    const textVisible = (rect, parent) => {
      let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      for (let p = parent; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        // Viewport clipping was already applied above. Root clientHeight stays
        // viewport-sized while its bounding rect moves upward after scrolling.
        if (p === document.documentElement || p === document.scrollingElement) continue;
        if (/auto|scroll|hidden|clip/.test(style.overflowX) || /auto|scroll|hidden|clip/.test(style.overflowY)) {
          const box = p.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, box.left + p.clientLeft);
            right = Math.min(right, box.left + p.clientLeft + p.clientWidth);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, box.top + p.clientTop);
            bottom = Math.min(bottom, box.top + p.clientTop + p.clientHeight);
          }
        }
      }
      return right > left && bottom > top;
    };
    const read = () => {
      const requested = input.reading;
      const saved = requested?.ref ? cache.scrollers.get(requested.ref) : null;
      const modal = Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"]')).find(rendered);
      const readingRegionLost = !!requested && (requested.documentId !== cache.documentId || requested.url !== location.href
        || (requested.ref && (!saved || !saved.node.isConnected || scrollSemantic(saved.node) !== requested.signature
          || !rendered(saved.node) || placement(saved.node).status !== 'ready'))
        || (!!modal && (!saved || !modal.contains(saved.node))));
      const light = !!requested && !readingRegionLost;
      const readingRoot = light && saved ? saved.node : document.body;
      const targets = [], refs = new Map();
      let omitted = false, actionCount = 0;
      const selector = 'a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="option"],[role="textbox"],[role="combobox"]';
      for (const e of light ? [] : document.querySelectorAll(selector)) {
        if (!rendered(e)) continue;
        const position = placement(e);
        if (position.status !== 'ready' && position.status !== 'needs_scroll') continue;
        // Native select is deliberately not offered until it has a structured executor.
        if (e.tagName === 'SELECT') continue;
        const type = (e.getAttribute('type') || 'text').toLowerCase();
        const editable = !e.readOnly && e.getAttribute('aria-readonly') !== 'true' &&
          (e.tagName === 'TEXTAREA' || e.isContentEditable ||
            (e.tagName === 'INPUT' && ['text','search','email','url','tel','number'].includes(type)));
        const operations = editable ? ['click', 'fill', 'enter'] : ['click'];
        if (actionCount + operations.length > 200) { omitted = true; continue; }
        actionCount += operations.length;
        const ref = identity(e);
        const target = { ref, name: name(e), role: e.getAttribute('role') || e.tagName.toLowerCase(),
          value: value(e).slice(0, 500), checked: e.getAttribute('aria-checked') ?? (typeof e.checked === 'boolean' ? String(e.checked) : null),
          expanded: e.getAttribute('aria-expanded'), requiresScroll: position.status === 'needs_scroll', operations };
        if (e.tagName === 'A') {
          target.href = e.href;
          target.linkTarget = e.target || '_self';
        }
        targets.push(target);
        refs.set(ref, { node: e, semantic: semantic(e), value: value(e), form: formState(e) });
      }
      const root = document.scrollingElement || document.documentElement;
      const scrollRefs = new Map();
      const scrollAreas = (light ? (saved ? [saved.node] : []) : Array.from(document.querySelectorAll('*')))
        .filter(e => e !== root && !e.matches('input,textarea,select') && scrollable(e)
          && rendered(e) && placement(e).status === 'ready')
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
        .slice(0, 8).map(e => {
          const ref = identity(e);
          scrollRefs.set(ref, { node: e, top: e.scrollTop, semantic: scrollSemantic(e) });
          return { ref, name: name(e), role: e.getAttribute('role') || e.tagName.toLowerCase(), signature: scrollSemantic(e),
            top: e.scrollTop, height: e.clientHeight, width: e.clientWidth, scrollHeight: e.scrollHeight,
            atTop: e.scrollTop <= 1, atBottom: e.scrollTop + e.clientHeight >= e.scrollHeight - 2 };
        });
      const words = [], walker = document.createTreeWalker(readingRoot, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let n, length = 0;
      while ((n = walker.nextNode()) && length < 6_000) {
        const p = n.parentElement, text = n.textContent.trim();
        if (!text || !p || p.closest('script,style,noscript,template,[aria-hidden="true"],[inert]')) continue;
        if (getComputedStyle(p).visibility === 'hidden') continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width && r.height && textVisible(r, p)) {
          words.push(text); length += text.length;
        }
      }
      const text = words.join('\n').slice(0, 6_000);
      const loading = !!requested && (readingRoot.getAttribute('aria-busy') === 'true'
        || Array.from(readingRoot.querySelectorAll('[aria-busy="true"]'))
          .some(e => rendered(e) && placement(e).status === 'ready'));
      const state = { readingRegionLost, loading, documentId: cache.documentId, url: location.href, title: document.title, text,
        targets, scrollAreas, viewportHeight: innerHeight, scrollHeight: root.scrollHeight, textTruncated: length >= 6_000, truncated: omitted, scrollTop: scrollY, scrollUp: scrollY > 1,
        scrollDown: scrollY + innerHeight < root.scrollHeight - 2 };
      const fingerprint = JSON.stringify([state, scrollX, scrollY, innerWidth, innerHeight]);
      return { state, fingerprint, refs, scrollRefs };
    };
    if (input.mode === 'observe') {
      for (const entry of cache.targets.values()) entry.node.removeAttribute('data-pulse-run');
      const current = read();
      cache.targets = current.refs;
      cache.scrollers = current.scrollRefs;
      const id = cache.documentId + ':' + (++cache.seq);
      for (const [ref, entry] of cache.targets) entry.node.setAttribute('data-pulse-run', input.runId + ':' + ref);
      cache.snapshot = { ...current.state, id, fingerprint: current.fingerprint };
      return cache.snapshot;
    }
    if (cache.snapshot?.id !== input.snapshotId || cache.snapshot.url !== location.href) {
      return ['fresh', 'action_fresh', 'scroll_fresh'].includes(input.mode) ? false : answer({ status: 'stale', reason: 'snapshot_changed' });
    }
    if (input.mode === 'fresh') return read().fingerprint === cache.snapshot.fingerprint;
    if (input.mode === 'scroll' || input.mode === 'scroll_fresh') {
      const entry = input.ref ? cache.scrollers.get(input.ref) : null;
      let problem;
      if (input.ref && (!entry || !entry.node.isConnected || scrollSemantic(entry.node) !== entry.semantic)) {
        problem = { status: 'stale', reason: 'scroll_region_replaced' };
      } else if (entry && (!rendered(entry.node) || !scrollable(entry.node) || placement(entry.node).status !== 'ready')) {
        problem = { status: 'blocked', reason: 'scroll_region_unavailable' };
      } else if (entry ? Math.abs(entry.node.scrollTop - entry.top) > 1 : Math.abs(scrollY - cache.snapshot.scrollTop) > 1) {
        problem = { status: 'stale', reason: 'scroll_position_changed' };
      }
      if (input.mode === 'scroll_fresh') return !problem;
      if (problem) return problem;
      if (!['up', 'down'].includes(input.direction)) return { status: 'blocked', reason: 'invalid_scroll_direction' };
      const region = entry ? entry.node : window;
      const height = entry ? entry.node.clientHeight : innerHeight;
      // Validate and mutate in one guest task: a replaced region can never
      // receive the scroll. Overlap preserves context between reading views.
      region.scrollBy({ top: (input.direction === 'down' ? 1 : -1) * Math.max(1, Math.round(height * 0.85)), behavior: 'instant' });
      return { status: 'scrolled' };
    }

    const entry = cache.targets.get(input.ref);
    if (input.mode === 'action_fresh') {
      // Wait/scroll/Escape only require the same document. Targeted actions
      // preserve identity, meaning, field value and related form state, not
      // unrelated carousels, counters, recommendations or video clocks.
      if (!input.ref) return true;
      return !!entry && rendered(entry.node) && semantic(entry.node) === entry.semantic
        && value(entry.node) === entry.value && formState(entry.node) === entry.form;
    }
    if (!entry || !entry.node.isConnected) return answer({ status: 'stale', reason: 'target_replaced' });
    if (!rendered(entry.node) || semantic(entry.node) !== entry.semantic) return answer({ status: 'stale', reason: 'target_state_changed' });
    if (input.strict && (value(entry.node) !== entry.value || formState(entry.node) !== entry.form)) {
      return answer({ status: 'stale', reason: 'target_or_form_changed' });
    }
    const matches = document.querySelectorAll('[data-pulse-run="' + input.runId + ':' + input.ref + '"]');
    if (matches.length !== 1 || matches[0] !== entry.node) return answer({ status: 'stale', reason: 'ambiguous_target' });
    if (input.focused && !entry.node.contains(document.activeElement)) return answer({ status: 'stale', reason: 'focus_changed' });
    const position = placement(entry.node, input.point);
    if (input.mode === 'reveal' && position.status === 'needs_scroll') {
      // Preparation only: never click while scrolling. The caller must observe and decide again.
      entry.node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      return { status: 'revealed', reason: position.reason };
    }
    return answer(position);
  })(${JSON.stringify(command)})`;
}
