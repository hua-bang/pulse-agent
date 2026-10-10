/** Runs inside the opaque app document; only node hosts enable observation. */
export const MCP_APP_VIEW_CONTEXT_SCRIPT = String.raw`(() => {
  let enabled = false;
  let timer;
  let previous = '';
  const visible = element => {
    if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth)) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const ancestor = getComputedStyle(parent);
      if (ancestor.display === 'none' || ancestor.visibility === 'hidden' || ancestor.opacity === '0') return false;
      const clip = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(ancestor.overflowY)
        && (rect.top >= clip.bottom || rect.bottom <= clip.top)) return false;
      if (/(auto|scroll|hidden|clip)/.test(ancestor.overflowX)
        && (rect.left >= clip.right || rect.right <= clip.left)) return false;
    }
    return true;
  };
  const capture = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts = [];
    let length = 0;
    let scanned = 0;
    while (walker.nextNode() && scanned++ < 5000 && length < 12000) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, input, textarea') || !visible(parent)) continue;
      const text = node.textContent.trim();
      if (text) { texts.push(text); length += text.length; }
    }
    const fields = [...document.querySelectorAll('input, select, textarea')]
      .filter(element => visible(element) && !['password', 'hidden', 'file'].includes(element.type))
      .slice(0, 20).map(element => ({
        label: element.getAttribute('aria-label') || element.placeholder || element.name || element.tagName,
        value: String(element.value).slice(0, 200),
      }));
    const text = JSON.stringify({ visibleText: texts.join('\n').slice(0, 12000), fields });
    if (text === previous) return;
    previous = text;
    window.parent.postMessage({
      type: 'pulse-mcp-app-host-event', action: 'context',
      context: { content: [{ type: 'text', text }] },
    }, '*');
  };
  const queue = () => {
    if (!enabled || timer) return;
    timer = setTimeout(() => { timer = undefined; capture(); }, 300);
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.method !== 'pulse/observe-context' || enabled) return;
    enabled = true;
    new MutationObserver(queue).observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    queue();
  });
  window.addEventListener('input', queue, true);
  window.addEventListener('change', queue, true);
  window.addEventListener('scroll', queue, true);
  window.addEventListener('resize', queue);
})();`;
