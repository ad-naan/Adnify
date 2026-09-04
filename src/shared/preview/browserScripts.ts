// These scripts execute in the guest page, never in the editor's renderer.
// All user-supplied values are JSON encoded, not interpolated as source code.
const helpers = `
  const find = (selector) => {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) throw new Error('Selector must match exactly one element; matched ' + nodes.length);
    return nodes[0];
  };
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const visible = (element) => {
    const r = element.getBoundingClientRect(), s = getComputedStyle(element);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
`

export function domScript(selector: string | undefined, limit: number): string {
  return `(() => {
    ${helpers}
    const root = ${selector ? `find(${JSON.stringify(selector)})` : 'document.documentElement'};
    if (!root) throw new Error('Document is not ready');
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
    const elements = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = root, visited = 0;
    while (node && elements.length < ${limit} && visited++ < 10000) {
      if (!['SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD'].includes(node.tagName) && visible(node)) {
        elements.push({ selector: locator(node), tag: node.localName, role: node.getAttribute('role'),
          label: node.getAttribute('aria-label'), text: (node.innerText || '').slice(0, 160),
          type: node.getAttribute('type'), disabled: !!node.disabled, rect: rect(node) });
      }
      node = walker.nextNode();
    }
    const html = root.cloneNode(true);
    html.querySelectorAll('script,style,noscript').forEach(e => e.remove());
    for (const e of [html, ...html.querySelectorAll('input,textarea')]) {
      if (e.tagName === 'INPUT') e.removeAttribute('value');
      if (e.tagName === 'TEXTAREA') e.textContent = '';
    }
    const markup = html.outerHTML;
    return { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight },
      elements, truncated: !!node, html: markup.slice(0, 16000), htmlTruncated: markup.length > 16000 };
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
    const element = ${selector ? `find(${JSON.stringify(selector)})` : 'null'};
    const action = ${JSON.stringify(action)};
    if (action === 'wait_for') return { visible: visible(element) };
    if (action === 'scroll') {
      (element || window).scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' });
      return { scrolled: true };
    }
    if (!visible(element) || element.disabled || element.closest('[inert]')) throw new Error('Element is hidden, disabled or inert');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    if (action === 'click') {
      const r = element.getBoundingClientRect();
      const x = (Math.max(0,r.left) + Math.min(innerWidth,r.right)) / 2;
      const y = (Math.max(0,r.top) + Math.min(innerHeight,r.bottom)) / 2;
      const hit = document.elementFromPoint(x,y);
      if (!hit || !element.contains(hit)) throw new Error('Element is covered by another element');
      return { x, y };
    }
    if (action === 'fill') {
      if (element.readOnly) throw new Error('Element is read-only');
      const text = ${JSON.stringify(text ?? '')};
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (element instanceof HTMLInputElement && ['file','checkbox','radio','button','submit','reset','image','hidden'].includes(element.type))
          throw new Error('This input type cannot be filled; use click when appropriate');
        const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype
          : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, text);
        if (element.value !== text) throw new Error('Control rejected the value');
      } else if (element.isContentEditable) element.textContent = text;
      else throw new Error('Element is not an editable control');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true };
    }
    element.focus();
    return { focused: true };
  })()`
}
