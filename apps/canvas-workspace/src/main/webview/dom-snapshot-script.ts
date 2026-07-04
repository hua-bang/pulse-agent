const PICK_TIMEOUT_MS = 30_000;
const DOM_SELECTION_MAX_TEXT = 12_000;
const DOM_SELECTION_MAX_HTML = 8_000;
const DOM_TREE_MAX_DEPTH = 5;
const DOM_TREE_MAX_CHILDREN = 30;
const DOM_TREE_MAX_TOTAL_NODES = 300;
const DOM_TREE_MAX_TEXT_PER_NODE = 500;
const DOM_CONTROLS_MAX = 80;

interface DomSnapshotScriptConfig {
  mode: 'pick' | 'read';
  workspaceId?: string;
  nodeId?: string;
  selector?: string;
  timeoutMs: number;
  maxText: number;
  maxHtml: number;
  maxDepth: number;
  maxChildrenPerNode: number;
  maxTotalNodes: number;
  maxTextPerNode: number;
  maxControls: number;
}

export interface DomElementSnapshotResult {
  ok: boolean;
  title: string;
  url: string;
  selector: string;
  label?: string;
  id?: string;
  workspaceId?: string;
  nodeId?: string;
  tagName?: string;
  rect?: { x: number; y: number; width: number; height: number; scrollX?: number; scrollY?: number };
  text: string;
  html?: string;
  htmlPreview?: string;
  tree?: unknown;
  controls?: unknown[];
  accessibility?: unknown;
  snapshot?: { nodeCount: number; controlCount: number; truncated: boolean } & Record<string, unknown>;
  error?: string;
}

export function createDomElementSnapshotScript(selector: string, maxText: number): string {
  return createDomSnapshotScript({
    mode: 'read',
    selector,
    timeoutMs: PICK_TIMEOUT_MS,
    maxText,
    maxHtml: Math.min(Math.max(maxText, 1), 16_000),
    maxDepth: DOM_TREE_MAX_DEPTH,
    maxChildrenPerNode: DOM_TREE_MAX_CHILDREN,
    maxTotalNodes: DOM_TREE_MAX_TOTAL_NODES,
    maxTextPerNode: DOM_TREE_MAX_TEXT_PER_NODE,
    maxControls: DOM_CONTROLS_MAX,
  });
}

export function createDomPickerScript(workspaceId: string, nodeId: string): string {
  return createDomSnapshotScript({
    mode: 'pick',
    workspaceId,
    nodeId,
    timeoutMs: PICK_TIMEOUT_MS,
    maxText: DOM_SELECTION_MAX_TEXT,
    maxHtml: DOM_SELECTION_MAX_HTML,
    maxDepth: DOM_TREE_MAX_DEPTH,
    maxChildrenPerNode: DOM_TREE_MAX_CHILDREN,
    maxTotalNodes: DOM_TREE_MAX_TOTAL_NODES,
    maxTextPerNode: DOM_TREE_MAX_TEXT_PER_NODE,
    maxControls: DOM_CONTROLS_MAX,
  });
}

function createDomSnapshotScript(config: DomSnapshotScriptConfig): string {
  return `
    (function () {
      var CONFIG = ${JSON.stringify(config)};

      if (CONFIG.mode === 'pick' && window.__pulseDomPickerCancel) {
        try { window.__pulseDomPickerCancel('replaced by a new picker'); } catch (_) {}
      }

      function cleanText(value, max) {
        value = String(value || '').replace(/\s+/g, ' ').trim();
        return value.length > max ? value.slice(0, max) + '\n\n[...truncated]' : value;
      }

      function escapeCss(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
          var hex = ch.charCodeAt(0).toString(16);
          return '\\' + hex + ' ';
        });
      }

      function uniqueSelector(el) {
        if (!(el instanceof Element)) return '';
        if (el.id) {
          var byId = '#' + escapeCss(el.id);
          try {
            if (document.querySelectorAll(byId).length === 1) return byId;
          } catch (_) {}
        }
        var preferredAttrs = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name'];
        for (var ai = 0; ai < preferredAttrs.length; ai += 1) {
          var attr = preferredAttrs[ai];
          var val = el.getAttribute(attr);
          if (!val) continue;
          var candidate = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(val) + ']';
          try {
            if (document.querySelectorAll(candidate).length === 1) return candidate;
          } catch (_) {}
        }
        var parts = [];
        var cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
          var part = cur.tagName.toLowerCase();
          if (cur.id) {
            part += '#' + escapeCss(cur.id);
            parts.unshift(part);
            break;
          }
          var cls = Array.prototype.slice.call(cur.classList || [])
            .filter(function (name) { return name && !/^\d/.test(name); })
            .slice(0, 2)
            .map(function (name) { return '.' + escapeCss(name); })
            .join('');
          if (cls) part += cls;
          var parent = cur.parentElement;
          if (parent) {
            var siblings = Array.prototype.filter.call(parent.children, function (child) {
              return child.tagName === cur.tagName;
            });
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
          }
          parts.unshift(part);
          var selector = parts.join(' > ');
          try {
            if (document.querySelectorAll(selector).length === 1) return selector;
          } catch (_) {}
          cur = parent;
        }
        return parts.join(' > ');
      }

      function attrMap(el) {
        var attrs = {};
        var names = [
          'id', 'class', 'role', 'aria-label', 'aria-labelledby', 'title', 'alt',
          'href', 'src', 'type', 'name', 'value', 'placeholder',
          'data-testid', 'data-test', 'data-cy'
        ];
        for (var i = 0; i < names.length; i += 1) {
          var name = names[i];
          var value = el.getAttribute(name);
          if (!value) continue;
          attrs[name] = cleanText(value, 240);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          if (el.value && !attrs.value) attrs.value = cleanText(el.value, 240);
        }
        return Object.keys(attrs).length ? attrs : undefined;
      }

      function roleFor(el) {
        var explicit = el.getAttribute('role');
        if (explicit) return explicit;
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'a' && el.getAttribute('href')) return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'input') {
          var type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'checkbox' || type === 'radio') return type;
          if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
          return 'textbox';
        }
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'table') return 'table';
        if (tag === 'ul' || tag === 'ol') return 'list';
        if (tag === 'li') return 'listitem';
        return undefined;
      }

      function labelFor(el) {
        var attr = el.getAttribute('aria-label')
          || el.getAttribute('title')
          || el.getAttribute('alt')
          || el.getAttribute('placeholder')
          || el.getAttribute('data-testid')
          || el.getAttribute('name')
          || '';
        var text = cleanText(attr || el.innerText || el.textContent || '', 96);
        var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
        if (text) return tag + ': ' + text;
        if (el.id) return tag + '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          return tag + '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        return tag;
      }

      function rectFor(el, includeScroll) {
        var rect = el.getBoundingClientRect();
        var value = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
        if (includeScroll) {
          value.scrollX = Math.round(window.scrollX || 0);
          value.scrollY = Math.round(window.scrollY || 0);
        }
        return value;
      }

      function shouldSkip(el) {
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (!tag) return true;
        if (/^(script|style|meta|link|noscript|template|svg|path|canvas)$/.test(tag)) return true;
        return false;
      }

      function isProbablyHidden(el) {
        try {
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
          var rect = el.getBoundingClientRect();
          return rect.width === 0 && rect.height === 0;
        } catch (_) {
          return false;
        }
      }

      function isControl(el) {
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        var role = roleFor(el);
        if (/^(a|button|input|select|textarea|summary|option)$/.test(tag)) return true;
        if (el.getAttribute('contenteditable') === 'true') return true;
        return /^(button|link|menuitem|tab|checkbox|radio|textbox|switch|combobox|option)$/.test(role || '');
      }

      function buildSnapshot(root) {
        var state = { nodeCount: 0, controlCount: 0, truncated: false, controls: [] };

        function nodeSnapshot(el, depth) {
          if (!(el instanceof Element) || shouldSkip(el) || isProbablyHidden(el)) return null;
          if (state.nodeCount >= CONFIG.maxTotalNodes) {
            state.truncated = true;
            return null;
          }
          state.nodeCount += 1;
          var out = {
            tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
            selector: uniqueSelector(el)
          };
          var role = roleFor(el);
          if (role) out.role = role;
          var attrs = attrMap(el);
          if (attrs) out.attrs = attrs;
          var text = cleanText(el.innerText || el.textContent || '', CONFIG.maxTextPerNode);
          if (text) out.text = text;
          out.rect = rectFor(el, false);

          if (isControl(el) && state.controls.length < CONFIG.maxControls) {
            state.controls.push({
              selector: out.selector,
              tagName: out.tagName,
              role: role,
              label: labelFor(el),
              text: text,
              attrs: attrs,
              rect: out.rect
            });
            state.controlCount += 1;
          }

          if (depth >= CONFIG.maxDepth) {
            if (el.children && el.children.length > 0) {
              out.truncated = true;
              state.truncated = true;
            }
            return out;
          }

          var children = [];
          var childElements = Array.prototype.slice.call(el.children || []);
          for (var i = 0; i < childElements.length; i += 1) {
            if (children.length >= CONFIG.maxChildrenPerNode) {
              out.truncated = true;
              state.truncated = true;
              break;
            }
            var child = nodeSnapshot(childElements[i], depth + 1);
            if (child) children.push(child);
          }
          if (children.length) out.children = children;
          return out;
        }

        var tree = nodeSnapshot(root, 0);
        return {
          tree: tree,
          controls: state.controls,
          accessibility: {
            role: roleFor(root),
            name: labelFor(root)
          },
          snapshot: {
            nodeCount: state.nodeCount,
            controlCount: state.controls.length,
            truncated: state.truncated,
            maxDepth: CONFIG.maxDepth,
            maxChildrenPerNode: CONFIG.maxChildrenPerNode,
            maxTotalNodes: CONFIG.maxTotalNodes
          }
        };
      }

      function details(el) {
        var text = cleanText(el.innerText || el.textContent || '', CONFIG.maxText);
        var htmlPreview = cleanText(el.outerHTML || '', CONFIG.maxHtml);
        var snapshot = buildSnapshot(el);
        return {
          id: 'dom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          label: labelFor(el),
          workspaceId: CONFIG.workspaceId,
          nodeId: CONFIG.nodeId,
          url: location.href,
          selector: uniqueSelector(el),
          tagName: el.tagName ? el.tagName.toLowerCase() : '',
          rect: rectFor(el, true),
          text: text,
          html: htmlPreview,
          htmlPreview: htmlPreview,
          tree: snapshot.tree,
          controls: snapshot.controls,
          accessibility: snapshot.accessibility,
          snapshot: snapshot.snapshot
        };
      }

      if (CONFIG.mode === 'read') {
        try {
          var selected = document.querySelector(CONFIG.selector);
          if (!selected) {
            return { ok: false, title: document.title || '', url: location.href, selector: CONFIG.selector, text: '', error: 'selector not found: ' + CONFIG.selector };
          }
          var data = details(selected);
          data.ok = true;
          data.title = document.title || '';
          data.selector = CONFIG.selector;
          return data;
        } catch (err) {
          return { ok: false, title: '', url: '', selector: CONFIG.selector, text: '', error: String(err) };
        }
      }

      return new Promise(function (resolve) {
        var doc = document;
        var activeElement = null;
        var settled = false;
        var style = doc.createElement('style');
        style.textContent = [
          '.pulse-dom-picker-outline {',
          '  position: fixed;',
          '  z-index: 2147483646;',
          '  pointer-events: none;',
          '  border: 2px solid #2383e2;',
          '  background: rgba(35, 131, 226, 0.10);',
          '  box-shadow: 0 0 0 99999px rgba(15, 23, 42, 0.08);',
          '  border-radius: 4px;',
          '}',
          '.pulse-dom-picker-label {',
          '  position: fixed;',
          '  z-index: 2147483647;',
          '  pointer-events: none;',
          '  max-width: min(420px, calc(100vw - 24px));',
          '  padding: 5px 7px;',
          '  border-radius: 5px;',
          '  background: #111827;',
          '  color: #fff;',
          '  font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
          '  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);',
          '  white-space: nowrap;',
          '  overflow: hidden;',
          '  text-overflow: ellipsis;',
          '}'
        ].join('');
        var outline = doc.createElement('div');
        outline.className = 'pulse-dom-picker-outline';
        var label = doc.createElement('div');
        label.className = 'pulse-dom-picker-label';
        label.textContent = 'Click an element to add it to AI Chat · Esc to cancel';
        doc.documentElement.appendChild(style);
        doc.documentElement.appendChild(outline);
        doc.documentElement.appendChild(label);

        function setBox(el) {
          if (!(el instanceof Element)) return;
          activeElement = el;
          var r = el.getBoundingClientRect();
          outline.style.left = Math.max(0, r.left) + 'px';
          outline.style.top = Math.max(0, r.top) + 'px';
          outline.style.width = Math.max(1, r.width) + 'px';
          outline.style.height = Math.max(1, r.height) + 'px';
          var top = Math.max(8, r.top - 30);
          if (r.top < 36) top = Math.min(window.innerHeight - 28, r.bottom + 6);
          label.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 24)) + 'px';
          label.style.top = top + 'px';
          label.textContent = labelFor(el);
        }

        function finish(result) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        }

        function cleanup() {
          clearTimeout(timer);
          doc.removeEventListener('mousemove', onMove, true);
          doc.removeEventListener('mousedown', onMouseDown, true);
          doc.removeEventListener('mouseup', onMouseUp, true);
          doc.removeEventListener('click', onClick, true);
          doc.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onScroll, true);
          try { outline.remove(); } catch (_) {}
          try { label.remove(); } catch (_) {}
          try { style.remove(); } catch (_) {}
          if (window.__pulseDomPickerCancel === cancel) delete window.__pulseDomPickerCancel;
        }

        function cancel(reason) {
          finish({ ok: false, cancelled: true, error: reason || 'cancelled' });
        }

        function onMove(event) {
          var target = event.target;
          if (target instanceof Element) setBox(target);
        }

        function onScroll() {
          if (activeElement) setBox(activeElement);
        }

        function block(event) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }

        function onMouseDown(event) {
          block(event);
        }

        function onMouseUp(event) {
          block(event);
        }

        function onClick(event) {
          block(event);
          var target = activeElement || event.target;
          if (!(target instanceof Element)) {
            finish({ ok: false, error: 'No element under pointer' });
            return;
          }
          finish({ ok: true, selection: details(target) });
        }

        function onKeyDown(event) {
          if (event.key === 'Escape') {
            block(event);
            cancel('cancelled');
          }
        }

        var timer = setTimeout(function () {
          finish({ ok: false, error: 'DOM picker timed out' });
        }, CONFIG.timeoutMs);
        window.__pulseDomPickerCancel = cancel;
        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('mousedown', onMouseDown, true);
        doc.addEventListener('mouseup', onMouseUp, true);
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, true);
        setBox(doc.body || doc.documentElement);
      });
    })();
  `;
}
