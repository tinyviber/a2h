// Tiny DOM helpers. Deliberately not a framework: the viewer is a local,
// dependency-free app and every node here is created explicitly, so there is
// no template-injection surface.

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key === 'dataset') {
        for (const d of Object.keys(value)) node.dataset[d] = value[d];
      } else if (value !== false) {
        node.setAttribute(key, value === true ? '' : value);
      }
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  if (children == null) return node;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clear(node) {
  node.textContent = '';
  return node;
}

export function fragment() {
  return document.createDocumentFragment();
}

export function byId(id) {
  return document.getElementById(id);
}

export function spacer(px) {
  return el('div', { class: 'spacer', style: `height:${px}px` });
}
