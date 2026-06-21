import { HarnessError } from './errors.mjs';
import { withPage } from './cdp.mjs';

export async function evaluateRenderer(session, expression) {
  return withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new HarnessError(result.exceptionDetails.text ?? 'Renderer evaluation failed.');
    }
    return result.result?.value ?? result.result?.description ?? null;
  });
}

export const uiSnapshotExpression = String(function uiSnapshot() {
  const interestingSelector = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role]',
    '[data-testid]',
    '[contenteditable="true"]',
  ].join(',');
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  return {
    title: document.title,
    url: location.href,
    route: location.hash || location.pathname + location.search,
    viewport: { width: innerWidth, height: innerHeight },
    elements: Array.from(document.querySelectorAll(interestingSelector))
      .filter(isVisible)
      .slice(0, 200)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          testId: el.getAttribute('data-testid') || undefined,
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120),
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
          selected: el.getAttribute('aria-selected') === 'true' || el.classList.contains('is-active'),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      }),
  };
});

export const pointForSelectorExpression = String(function pointForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { error: `No element matches selector: ${selector}` };
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { error: `Element is not visible: ${selector}` };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});

export const pointForTextExpression = String(function pointForText(text) {
  const needle = String(text).trim().toLowerCase();
  const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[data-testid],input,textarea,[contenteditable="true"]'));
  for (const el of candidates) {
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (!label.includes(needle)) continue;
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { error: `No visible interactive element contains text: ${text}` };
});

export const focusAndClearExpression = String(function focusAndClear(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: `No element matches selector: ${selector}` };
  el.focus();
  if ('value' in el) {
    el.value = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }
  return { ok: true };
});
