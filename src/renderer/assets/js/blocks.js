// Presentation block rendering.
//
// Every block kind a producer can author is drawn by a renderer registered
// here. Adding a new visual language to A2H means registering one more
// function — no changes to the router, the views, or the server.
//
// Unknown block types are not an error: they render as a quiet, inspectable
// fallback so a producer can adopt a newer block kind without breaking an
// older viewer.

import { el, append } from './dom.js';
import { statusLabel, statusTone, fmtStamp, prettify } from './format.js';
import { hrefFor } from './router.js';

const renderers = new Map();

export function registerBlock(type, renderer) {
  renderers.set(type, renderer);
}

/**
 * @param blocks  resolved blocks from the presentation payload
 * @param ctx     { data, renderActions(ids, options) }
 * @param options { card: boolean } — whether each block gets its own surface
 */
export function renderBlocks(blocks, ctx, options = {}) {
  const out = [];
  for (const block of blocks || []) {
    const node = renderBlock(block, ctx, options);
    if (node) out.push(node);
  }
  return out;
}

export function renderBlock(block, ctx, options = {}) {
  if (!block || typeof block.type !== 'string') return null;
  const renderer = renderers.get(block.type);
  const body = renderer ? renderer(block, ctx) : unknownBlock(block);
  if (!body) return null;
  return options.card ? el('section', { class: 'block-card' }, [body]) : body;
}

function headline(block) {
  if (!block.title) return null;
  return el('h3', { class: 'block-title', text: block.title });
}

function unknownBlock(block) {
  return el('div', { class: 'block-unknown' }, [
    el('p', {
      class: 'notice-inline',
      text: `This viewer does not know how to draw a "${block.type}" block.`,
    }),
    el('details', {}, [
      el('summary', { text: 'Raw block' }),
      el('pre', { class: 'raw', text: JSON.stringify(block, null, 2) }),
    ]),
  ]);
}

// ---------------------------------------------------------------- text-like

registerBlock('text', (block) => {
  const tone = block.tone && block.tone !== 'neutral' ? ` tone-${block.tone}` : '';
  return el('div', { class: 'block block-text' }, [
    headline(block),
    el('p', { class: `block-body${tone}`, text: block.text == null ? '' : String(block.text) }),
  ]);
});

registerBlock('markdown', (block) => {
  // `html` is rendered server-side by the same conservative renderer used for
  // artifacts (raw HTML escaped, unsafe link protocols rejected).
  const prose = el('div', { class: 'prose prose-block' });
  prose.innerHTML = typeof block.html === 'string' ? block.html : '';
  return el('div', { class: 'block block-markdown' }, [headline(block), prose]);
});

registerBlock('notice', (block) => {
  const tone = block.tone || 'info';
  return el('div', { class: `block-notice tone-${tone}` }, [
    el('span', { class: 'notice-label', text: tone === 'error' ? 'Error' : tone === 'warn' ? 'Warning' : 'Note' }),
    el('span', { class: 'notice-body', text: block.text == null ? '' : String(block.text) }),
  ]);
});

// -------------------------------------------------------------------- lists

registerBlock('list', (block) => {
  const items = Array.isArray(block.items) ? block.items : [];
  const list = el(block.ordered ? 'ol' : 'ul', { class: 'block-list' });
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = el('li', { class: 'block-list-item' }, [
      el('div', { class: 'block-list-head' }, [
        item.href ? linkNode(item.href, item.title) : el('span', { class: 'block-list-title', text: item.title }),
        item.status ? statusPill(item.status) : null,
      ]),
      item.detail ? el('p', { class: 'block-list-detail', text: item.detail }) : null,
      item.meta ? el('p', { class: 'block-list-meta', text: item.meta }) : null,
    ]);
    list.appendChild(row);
  }
  return el('div', { class: 'block block-list' }, [headline(block), list]);
});

function linkNode(href, text) {
  return el('a', { class: 'block-list-title link', href: resolveHref(href), text: text });
}

/** A producer may write a workspace path; we route it as an artifact. */
export function resolveHref(href) {
  if (typeof href !== 'string' || href === '') return '#/';
  if (href.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
  return hrefFor('artifact', href);
}

// ------------------------------------------------------------------- tables

registerBlock('table', (block) => {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const table = el('table', { class: 'data-table' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const col of columns) {
    headRow.appendChild(
      el('th', { class: col.align === 'right' ? 'align-right' : '', text: col.label || col.key }),
    );
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const col of columns) {
      const value = row ? row[col.key] : '';
      tr.appendChild(
        el('td', {
          class: col.align === 'right' ? 'align-right' : '',
          text: value == null ? '' : String(value),
        }),
      );
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return el('div', { class: 'block block-table' }, [
    headline(block),
    el('div', { class: 'table-wrap' }, [table]),
    block.note ? el('p', { class: 'block-note', text: block.note }) : null,
  ]);
});

// -------------------------------------------------------------- comparison

registerBlock('comparison', (block) => {
  const options = Array.isArray(block.options) ? block.options : [];
  const grid = el('div', { class: 'comparison' });
  for (const option of options) {
    const tone = option.tone && option.tone !== 'neutral' ? ` tone-${option.tone}` : '';
    const col = el('div', { class: `comparison-option${tone}` }, [
      el('h4', { class: 'comparison-title', text: option.title }),
      option.summary ? el('p', { class: 'comparison-summary', text: option.summary }) : null,
    ]);
    const facts = Array.isArray(option.facts) ? option.facts : [];
    if (facts.length) {
      const dl = el('dl', { class: 'kv' });
      for (const fact of facts) {
        dl.appendChild(el('dt', { text: fact.label }));
        dl.appendChild(el('dd', { text: fact.value == null ? '' : String(fact.value) }));
      }
      col.appendChild(dl);
    }
    grid.appendChild(col);
  }
  return el('div', { class: 'block block-comparison' }, [
    headline(block),
    grid,
    block.conclusion ? el('p', { class: 'block-conclusion', text: block.conclusion }) : null,
  ]);
});

// ------------------------------------------------------------------ metrics

registerBlock('metrics', (block) => {
  const items = Array.isArray(block.items) ? block.items : [];
  const grid = el('div', { class: 'metrics' });
  for (const metric of items) {
    const tone = metric.tone && metric.tone !== 'neutral' ? ` tone-${metric.tone}` : '';
    grid.appendChild(
      el('div', { class: `metric${tone}` }, [
        el('span', { class: 'metric-label', text: metric.label }),
        el('span', { class: 'metric-value' }, [
          String(metric.value == null ? '' : metric.value),
          metric.unit ? el('span', { class: 'metric-unit', text: metric.unit }) : null,
        ]),
        metric.delta ? el('span', { class: 'metric-delta', text: metric.delta }) : null,
      ]),
    );
  }
  return el('div', { class: 'block block-metrics' }, [headline(block), grid]);
});

// ----------------------------------------------------------------- timeline

registerBlock('timeline', (block) => {
  const items = Array.isArray(block.items) ? block.items : [];
  const list = el('ol', { class: 'timeline' });
  for (const item of items) {
    const tone = item.status ? statusTone(item.status) : 'neutral';
    list.appendChild(
      el('li', { class: 'timeline-item' }, [
        el('span', { class: `timeline-dot tone-${tone}` }),
        el('div', { class: 'timeline-body' }, [
          el('div', { class: 'timeline-head' }, [
            el('span', { class: 'timeline-title', text: item.title }),
            item.at ? el('span', { class: 'timeline-at', text: fmtStamp(item.at) }) : null,
          ]),
          item.detail ? el('p', { class: 'timeline-detail', text: item.detail }) : null,
        ]),
      ]),
    );
  }
  return el('div', { class: 'block block-timeline' }, [headline(block), list]);
});

// ------------------------------------------------------------------- status

registerBlock('status', (block) => {
  return el('div', { class: 'block block-status' }, [
    headline(block),
    el('div', { class: 'status-band' }, [
      statusPill(block.status),
      block.detail ? el('span', { class: 'status-detail', text: block.detail }) : null,
    ]),
  ]);
});

registerBlock('keyvalue', (block) => {
  const items = Array.isArray(block.items) ? block.items : [];
  const dl = el('dl', { class: 'kv' });
  for (const item of items) {
    dl.appendChild(el('dt', { text: item.key }));
    dl.appendChild(el('dd', { class: item.mono ? 'mono' : '', text: item.value == null ? '' : String(item.value) }));
  }
  return el('div', { class: 'block block-kv' }, [headline(block), dl]);
});

// ------------------------------------------------------------------ actions

registerBlock('actions', (block, ctx) => {
  const ids = Array.isArray(block.ids) ? block.ids : [];
  if (!ctx || !ctx.renderActions) return null;
  const node = ctx.renderActions(ids, { compact: true });
  if (!node) return null;
  return el('div', { class: 'block block-actions' }, [headline(block), node]);
});

// -------------------------------------------------------------------- atoms

export function statusPill(status) {
  const tone = statusTone(status);
  return el('span', { class: `status-pill tone-${tone}` }, [
    el('span', { class: 'status-dot' }),
    statusLabel(status),
  ]);
}

export function tagRow(tags) {
  const row = el('div', { class: 'card-tags' });
  for (const tag of tags || []) {
    row.appendChild(el('span', { class: `tag tag-${String(tag).toLowerCase()}`, text: tag }));
  }
  return row;
}

export { append, prettify };
