// These scripts execute in the guest page, never in the editor's renderer.
// All user-supplied values are JSON encoded, not interpolated as source code.

const helpers = `
  const cache = window.__adnifyFast ||= { ids: new WeakMap(), nodes: new Map(), next: 1 };

  const getOrSetId = (el) => {
    if (!cache.ids.has(el)) {
      cache.ids.set(el, cache.next++);
    }
    const id = cache.ids.get(el);
    cache.nodes.set(id, el);
    try { el.setAttribute('data-adnify-id', String(id)); } catch {}
    return id;
  };

  const visible = (element) => {
    if (!element || element.closest('[aria-hidden="true"],[inert]')) return false;
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const r = element.getBoundingClientRect(), s = getComputedStyle(element);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const find = (selector) => {
    if (!selector) throw new Error('Target selector or element ID is required');
    const s = String(selector).trim();
    const num = s.startsWith('@') ? s.slice(1) : (/^\\d+$/.test(s) ? s : null);
    if (num !== null) {
      const id = Number(num);
      const cached = cache.nodes.get(id);
      if (cached && cached.isConnected) return cached;
      const el = document.querySelector('[data-adnify-id="' + num + '"]');
      if (el) return el;
      throw new Error('Element [' + num + '] not found or no longer in DOM; call browser_inspect(dom) to refresh');
    }
    const nodes = document.querySelectorAll(s);
    if (nodes.length === 0) throw new Error('Selector matched 0 elements: ' + s);
    if (nodes.length === 1) return nodes[0];
    for (const n of nodes) {
      if (visible(n) && !n.disabled) return n;
    }
    return nodes[0];
  };

  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      cx: Math.round(r.x + r.width / 2),
      cy: Math.round(r.y + r.height / 2),
    };
  };

  const accessibleName = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced = (e.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map(id => accessibleName(document.getElementById(id), seen)).filter(Boolean).join(' ');
    if (referenced) return referenced;
    const ariaLabel = e.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    if (e.labels && e.labels.length) {
      const labelText = [...e.labels].map(l => accessibleName(l, seen)).filter(Boolean).join(' ');
      if (labelText) return labelText;
    }
    if (['button', 'submit', 'reset'].includes(e.type) && e.value) return e.value;
    if (e.getAttribute('alt')) return e.getAttribute('alt');
    if (e.tagName !== 'INPUT') {
      const text = [...e.childNodes]
        .map(n => n.nodeType === 3 ? n.textContent : (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' ? accessibleName(n, seen) : ''))
        .join(' ').trim();
      if (text) return text.replace(/\\s+/g, ' ').slice(0, 160);
    }
    return (e.getAttribute('placeholder') || e.getAttribute('title') || '').slice(0, 160);
  };

  const interactiveRoles = ['button','link','checkbox','radio','switch','tab','menuitem','option','combobox','textbox','searchbox','spinbutton'];
  const interactiveSelector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"]),' +
    interactiveRoles.map(r => '[role="' + r + '"]').join(',');

  const resolveRole = (e) => {
    const explicit = e.getAttribute('role');
    if (interactiveRoles.includes(explicit)) return explicit;
    if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
    if (e.tagName === 'A') return 'link';
    if (e.tagName === 'SELECT') return 'combobox';
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName === 'INPUT') {
      if (['checkbox', 'radio'].includes(e.type)) return e.type;
      if (['button', 'submit', 'reset', 'image'].includes(e.type)) return 'button';
      if (e.type === 'search') return 'searchbox';
      if (e.type === 'number') return 'spinbutton';
      if (['text', 'email', 'url', 'tel', 'password'].includes(e.type)) return 'textbox';
    }
    if (e.onclick || e.getAttribute('onclick') || getComputedStyle(e).cursor === 'pointer') return 'button';
    return null;
  };
`

export function cursorOverlayScript(): string {
  return `(() => {
    let overlay = document.getElementById('adnify-agent-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'adnify-agent-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:hidden;';

      const cursor = document.createElement('div');
      cursor.id = 'adnify-agent-cursor';
      cursor.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;margin-top:-2px;margin-left:-2px;pointer-events:none;transform:translate3d(-50px,-50px,0);filter:drop-shadow(0 2px 5px rgba(0,0,0,0.45));will-change:transform;';
      cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 3L11 20L14 13L21 10L4 3Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="14" cy="13" r="2.5" fill="#60a5fa"/></svg>';
      overlay.appendChild(cursor);

      const style = document.createElement('style');
      style.textContent = \`
        @keyframes adnify-ripple-anim {
          0% { transform: translate3d(var(--rx), var(--ry), 0) translate(-50%, -50%) scale(0.2); opacity: 0.95; }
          100% { transform: translate3d(var(--rx), var(--ry), 0) translate(-50%, -50%) scale(2.2); opacity: 0; }
        }
        .adnify-ripple {
          position: fixed; top: 0; left: 0; width: 32px; height: 32px; border-radius: 50%;
          border: 2.5px solid #2563eb; background: rgba(37, 99, 235, 0.25);
          pointer-events: none; animation: adnify-ripple-anim 0.45s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
        }
      \`;
      overlay.appendChild(style);
      document.documentElement.appendChild(overlay);
    }

    window.__adnifyUpdateCursor = (x, y) => {
      const c = document.getElementById('adnify-agent-cursor');
      if (c) c.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
    };

    window.__adnifyClickRipple = (x, y) => {
      const container = document.getElementById('adnify-agent-overlay');
      if (!container) return;
      const ripple = document.createElement('div');
      ripple.className = 'adnify-ripple';
      ripple.style.setProperty('--rx', x + 'px');
      ripple.style.setProperty('--ry', y + 'px');
      container.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
    };
  })()`
}

export function domScript(selector: string | undefined, limit: number): string {
  return `(() => {
    ${helpers}
    const root = ${selector ? `find(${JSON.stringify(selector)})` : 'document.documentElement'};
    if (!root) throw new Error('Document is not ready');

    for (const [id, e] of cache.nodes) {
      if (!e.isConnected) cache.nodes.delete(id);
    }

    const locator = (element) => {
      const parts = [];
      while (element && element.nodeType === 1) {
        if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) {
          parts.unshift('#' + CSS.escape(element.id)); break;
        }
        let index = 1, sibling = element.previousElementSibling;
        while (sibling) { if (sibling.tagName === element.tagName) index++; sibling = sibling.previousElementSibling; }
        parts.unshift(element.localName + ':nth-of-type(' + index + ')');
        element = element.parentElement;
      }
      return parts.join(' > ');
    };

    const elements = [];
    const tableRows = [];
    const matchedNodes = root.querySelectorAll(interactiveSelector);

    for (const el of matchedNodes) {
      if (elements.length >= ${limit}) break;
      if (!visible(el) || el.disabled || el.closest('[inert]')) continue;

      const r = rect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      // In-viewport or reasonable near-viewport check
      if (r.cx < -20 || r.cy < -20 || r.cx > innerWidth + 100 || r.cy > innerHeight + 100) continue;

      const id = getOrSetId(el);
      const role = resolveRole(el) || el.localName;
      const label = accessibleName(el) || role;
      const val = 'value' in el && el.value !== undefined ? String(el.value).slice(0, 100) : (el.isContentEditable ? el.innerText.trim().slice(0, 100) : '');

      const item = {
        id,
        ref: '@' + id,
        tag: el.localName,
        role,
        label,
        value: val || undefined,
        checked: 'checked' in el ? !!el.checked : undefined,
        disabled: !!el.disabled,
        rect: r,
        selector: locator(el),
      };
      elements.push(item);

      const valPart = val ? ' · value: ' + JSON.stringify(val) : '';
      tableRows.push('[' + id + '] ' + role + ' "' + label.replace(/\\n/g, ' ') + '"' + valPart + ' · (center: ' + r.cx + ', ' + r.cy + ')');
    }

    const html = root.cloneNode(true);
    html.querySelectorAll('script,style,noscript,#adnify-agent-overlay').forEach(e => e.remove());
    for (const e of [html, ...html.querySelectorAll('input,textarea')]) {
      if (e.tagName === 'INPUT') e.removeAttribute('value');
      if (e.tagName === 'TEXTAREA') e.textContent = '';
    }
    const markup = html.outerHTML;

    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      elements,
      indexedTable: tableRows.join('\\n'),
      totalInteractive: elements.length,
      html: markup.slice(0, 16000),
      htmlTruncated: markup.length > 16000,
    };
  })()`
}

export function stylesScript(selector: string): string {
  return `(() => {
    ${helpers}
    const element = find(${JSON.stringify(selector)});
    const properties = ['display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
      'margin','padding','gap','overflow','overflow-x','overflow-y','flex','flex-direction','align-items','justify-content',
      'grid-template-columns','grid-template-rows','font-family','font-size','font-weight','line-height','color','background-color',
      'border','border-radius','opacity','visibility','z-index','transform','pointer-events'];
    const describe = (e, pseudo) => {
      const s = getComputedStyle(e, pseudo);
      return Object.fromEntries(properties.map(p => [p, s.getPropertyValue(p)]));
    };
    const ancestors = []; let parent = element.parentElement;
    while (parent && ancestors.length < 5) {
      ancestors.push({ tag: parent.localName, id: parent.id, rect: rect(parent), styles: describe(parent) });
      parent = parent.parentElement;
    }
    return { selector: ${JSON.stringify(selector)}, rect: rect(element), visible: visible(element),
      inlineStyle: element.getAttribute('style'), computed: describe(element),
      before: describe(element, '::before'), after: describe(element, '::after'), ancestors };
  })()`
}

export function elementActionScript(action: string, selector?: string, text?: string, x = 0, y = 600): string {
  return `(() => {
    ${helpers}
    const action = ${JSON.stringify(action)};
    if (action === 'scroll') {
      return { scrolled: true, x: ${x}, y: ${y} };
    }
    const element = ${selector ? `find(${JSON.stringify(selector)})` : 'null'};
    if (action === 'wait_for') return { visible: visible(element) };
    if (!visible(element) || element.disabled || element.closest('[inert]')) {
      throw new Error('Element is hidden, disabled or inert');
    }
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

    if (action === 'click') {
      const r = element.getBoundingClientRect();
      const x = Math.round((Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2);
      const y = Math.round((Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2);
      return { x, y, id: element.getAttribute('data-adnify-id') || null };
    }

    if (action === 'fill') {
      if (element.readOnly) throw new Error('Element is read-only');
      const text = ${JSON.stringify(text ?? '')};
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (element instanceof HTMLInputElement && ['file','checkbox','radio','button','submit','reset','image','hidden'].includes(element.type)) {
          throw new Error('This input type cannot be filled; use click when appropriate');
        }
        const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype
          : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, text);
        if (element.value !== text) element.value = text;
      } else if (element.isContentEditable) {
        element.textContent = text;
      } else {
        throw new Error('Element is not an editable control');
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      const r = element.getBoundingClientRect();
      return { filled: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }

    element.focus();
    const r = element.getBoundingClientRect();
    return { focused: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`
}
