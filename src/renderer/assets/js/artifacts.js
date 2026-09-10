// Artifact rendering: the reading surfaces a human uses to inspect content.
// Content is always inserted as text (never innerHTML) except for markdown,
// which the server has already rendered with escaping enabled.

import { el, append } from './dom.js';
import { KIND_LABEL, fmtBytes, fmtStamp, kindLabel, relTime, shortPath } from './format.js';
import { loadArtifact } from './api.js';
import { hrefFor } from './router.js';
import { renderBlocks, tagRow } from './blocks.js';
import { renderActions } from './actions.js';
import { findTask } from './store.js';

const CODE_PREVIEW = 600;
const DIFF_PREVIEW = 500;

export function renderArtifactView(payload) {
  const wrap = el('div', {});
  wrap.appendChild(artifactHeader(payload));
  wrap.appendChild(renderBody(payload));

  if (payload.blocks && payload.blocks.length) {
    const extras = el('div', { class: 'artifact-extras' });
    append(extras, renderBlocks(payload.blocks, { renderActions }, { card: true }));
    wrap.appendChild(extras);
  }

  const relations = renderRelations(payload);
  if (relations) wrap.appendChild(relations);

  return wrap;
}

function artifactHeader(payload) {
  const head = el('div', { class: 'artifact-head' });
  head.appendChild(
    el('button', { class: 'back-link', text: '← Overview', onclick: () => { location.hash = '#/'; } }),
  );
  head.appendChild(el('h1', { class: 'artifact-title', text: payload.title }));
  if (payload.path) head.appendChild(el('p', { class: 'artifact-path', text: payload.path }));

  const meta = [];
  meta.push(kindLabel(payload.kind));
  if (payload.meta && payload.meta.size != null) meta.push(fmtBytes(payload.meta.size));
  if (payload.meta && payload.meta.mtimeMs) meta.push(relTime(payload.meta.mtimeMs));
  if (payload.meta && payload.meta.lineCount != null) meta.push(`${payload.meta.lineCount} lines`);
  if (payload.meta && payload.meta.fileCount != null) {
    meta.push(`${payload.meta.fileCount} file${payload.meta.fileCount === 1 ? '' : 's'}`);
  }
  if (payload.meta && payload.meta.language) meta.push(payload.meta.language);
  head.appendChild(el('p', { class: 'artifact-meta', text: meta.join(' · ') }));

  const facts = el('p', { class: 'artifact-meta artifact-provenance' });
  if (payload.kind && KIND_LABEL[payload.kind] == null) {
    facts.appendChild(el('span', { class: 'provenance-item', text: `role: ${payload.kind}` }));
  }
  if (payload.taskId) {
    facts.appendChild(
      el('a', { class: 'provenance-link', href: hrefFor('task', payload.taskId), text: `task: ${taskTitle(payload.taskId)}` }),
    );
  }
  if (payload.blocksNote) facts.appendChild(el('span', { text: payload.blocksNote }));
  if (facts.childNodes.length) head.appendChild(facts);

  if (payload.tags && payload.tags.length) head.appendChild(tagRow(payload.tags));
  return head;
}

function taskTitle(taskId) {
  const task = findTask(taskId);
  return task ? task.title : taskId;
}

function renderBody(payload) {
  const box = el('div', { class: 'artifact-body' });
  const content = payload.content;

  switch (content && content.type) {
    case 'markdown': {
      const prose = el('div', { class: 'prose' });
      prose.innerHTML = content.html || '';
      box.appendChild(prose);
      break;
    }
    case 'code':
      box.appendChild(renderCode(content));
      break;
    case 'diff':
      box.appendChild(renderDiff(content));
      break;
    case 'json':
      box.appendChild(renderJson(content));
      break;
    case 'log':
      box.appendChild(renderLog(content, payload.path));
      break;
    case 'image':
      box.appendChild(renderImage(content, payload));
      break;
    case 'file':
      box.appendChild(renderFile(content));
      break;
    default:
      box.appendChild(el('div', { class: 'notice', text: 'Unsupported content type.' }));
  }
  return box;
}

// --------------------------------------------------------------- code view

function renderCode(content) {
  const box = el('div', {});
  const bar = el('div', { class: 'bar' }, [
    el('span', { text: content.language || 'text' }),
    el('span', { text: `${content.totalLines} lines` }),
  ]);
  if (content.truncated) bar.appendChild(el('span', { class: 'flag-warn', text: 'truncated' }));
  box.appendChild(bar);

  const lines = content.raw ? content.raw.split('\n') : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const wrap = el('div', { class: 'code-wrap' });
  if (lines.length > CODE_PREVIEW) {
    wrap.appendChild(codeLines(lines.slice(0, CODE_PREVIEW), 0));
    wrap.appendChild(
      el('div', { class: 'bar' }, [
        el('button', {
          class: 'btn',
          text: `Show all ${lines.length} lines`,
          onclick: (event) => {
            const parent = event.currentTarget.closest('.code-wrap');
            parent.textContent = '';
            parent.appendChild(codeLines(lines, 0));
          },
        }),
      ]),
    );
  } else {
    wrap.appendChild(codeLines(lines, 0));
  }
  box.appendChild(wrap);
  return box;
}

function codeLines(lines, startNo) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    frag.appendChild(
      el('div', { class: 'code-line' }, [
        el('span', { class: 'ln', text: String(startNo + i + 1) }),
        el('span', { class: 'body', text: lines[i] }),
      ]),
    );
  }
  return frag;
}

// --------------------------------------------------------------- diff view

function renderDiff(content) {
  const box = el('div', {});
  const files = content.files || [];
  const bar = el('div', { class: 'bar' }, [
    el('span', { text: `${files.length} file${files.length === 1 ? '' : 's'}` }),
  ]);
  if (content.truncated) bar.appendChild(el('span', { class: 'flag-warn', text: 'truncated' }));
  box.appendChild(bar);

  let totalLines = 0;
  for (const file of files) for (const hunk of file.hunks) totalLines += hunk.lines.length;

  const body = el('div', { class: 'diff-wrap' });
  if (totalLines > DIFF_PREVIEW) {
    body.appendChild(diffFiles(files, DIFF_PREVIEW));
    box.appendChild(body);
    box.appendChild(
      el('div', { class: 'bar' }, [
        el('button', {
          class: 'btn',
          text: `Show full diff (${totalLines} lines)`,
          onclick: (event) => {
            const target = event.currentTarget;
            const parent = target.closest('.artifact-body');
            const wrap = parent.querySelector('.diff-wrap');
            wrap.textContent = '';
            wrap.appendChild(diffFiles(files, Infinity));
            target.parentNode.remove();
          },
        }),
      ]),
    );
  } else {
    body.appendChild(diffFiles(files, Infinity));
    box.appendChild(body);
  }
  return box;
}

function diffFiles(files, budget) {
  const frag = document.createDocumentFragment();
  let remaining = budget;
  for (const file of files) {
    if (remaining <= 0) break;
    const fileBox = el('div', { class: 'diff-file' }, [
      el('div', { class: 'diff-file-head' }, [
        el('span', { class: 'path', text: file.path }),
        el('span', { class: 'diff-status', text: file.status }),
        el('span', { class: 'diff-stat add', text: `+${file.added}` }),
        el('span', { class: 'diff-stat del', text: `-${file.removed}` }),
      ]),
    ]);
    for (const hunk of file.hunks) {
      if (remaining <= 0) break;
      fileBox.appendChild(el('div', { class: 'diff-hunk-header', text: hunk.header }));
      for (const line of hunk.lines) {
        if (remaining <= 0) break;
        fileBox.appendChild(diffLineRow(line));
        remaining -= 1;
      }
    }
    frag.appendChild(fileBox);
  }
  return frag;
}

function diffLineRow(line) {
  let cls = 'diff-line';
  if (line.type === 'add') cls += ' add';
  else if (line.type === 'del') cls += ' del';
  return el('div', { class: cls }, [
    el('span', { class: 'ln old', text: line.oldNo != null ? String(line.oldNo) : '' }),
    el('span', { class: 'ln new', text: line.newNo != null ? String(line.newNo) : '' }),
    el('span', { class: 'body', text: line.text }),
  ]);
}

// ---------------------------------------------------------------- log view

function renderLog(content, path) {
  const box = el('div', {});
  const head = el('div', { class: 'log-head' }, [
    el('span', { text: `${content.totalLines} lines total` }),
  ]);
  if (content.hasErrors) head.appendChild(el('span', { class: 'log-flag error', text: 'errors' }));
  if (content.hasWarnings) head.appendChild(el('span', { class: 'log-flag warn', text: 'warnings' }));
  head.appendChild(
    el('button', {
      class: 'btn',
      text: 'Show full log',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
          const payload = await loadArtifact(path, 'full');
          const c = payload.content;
          const wrap = box.querySelector('.log-wrap');
          wrap.textContent = '';
          wrap.appendChild(logLines(c.tail, 0, c.errorLines));
          button.remove();
          if (c.truncated) head.appendChild(el('span', { class: 'log-flag warn', text: 'truncated' }));
        } catch {
          button.disabled = false;
          button.textContent = 'Show full log';
        }
      },
    }),
  );
  box.appendChild(head);

  const wrap = el('div', { class: 'log-wrap' });
  wrap.appendChild(logLines(content.tail, content.totalLines - content.tail.length, content.errorLines));
  box.appendChild(wrap);
  return box;
}

function logLines(lines, startNo, errorLines) {
  const errorSet = new Set(errorLines || []);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const lineNo = startNo + i;
    const cls = errorSet.has(lineNo) ? 'log-line is-error' : 'log-line';
    frag.appendChild(
      el('div', { class: cls }, [
        el('span', { class: 'ln', text: String(lineNo + 1) }),
        el('span', { class: 'body', text: lines[i] }),
      ]),
    );
  }
  return frag;
}

// --------------------------------------------------------------- json view

function renderJson(content) {
  const box = el('div', {});
  const bar = el('div', { class: 'bar' }, [
    el('span', { text: content.valid ? 'valid JSON' : 'invalid JSON' }),
  ]);
  if (content.truncated) bar.appendChild(el('span', { class: 'flag-warn', text: 'truncated' }));
  box.appendChild(bar);

  const wrap = el('div', { class: 'json-wrap' });
  const tree = () => {
    wrap.textContent = '';
    if (content.valid) wrap.appendChild(jsonNode(content.data, 0));
    else wrap.appendChild(el('pre', { class: 'raw', text: content.raw }));
  };
  const raw = () => {
    wrap.textContent = '';
    wrap.appendChild(el('pre', { class: 'raw', text: content.raw }));
  };

  let showingRaw = false;
  bar.appendChild(
    el('button', {
      class: 'btn',
      text: 'Raw',
      onclick: (event) => {
        showingRaw = !showingRaw;
        event.currentTarget.textContent = showingRaw ? 'Tree' : 'Raw';
        if (showingRaw) raw();
        else tree();
      },
    }),
  );

  tree();
  box.appendChild(wrap);
  return box;
}

function jsonNode(value, depth) {
  if (depth > 12) return el('span', { class: 'json-collapsed', text: '…' });
  if (value === null) return el('span', { class: 'json-null', text: 'null' });

  const type = typeof value;
  if (type === 'string') return el('span', { class: 'json-str', text: `"${value}"` });
  if (type === 'number') return el('span', { class: 'json-num', text: String(value) });
  if (type === 'boolean') return el('span', { class: 'json-bool', text: String(value) });
  if (type !== 'object') return el('span', { class: 'json-null', text: String(value) });

  const isArray = Array.isArray(value);
  const keys = Object.keys(value);
  const details = el('details', { class: 'json-row' });
  const summary = el('summary', {});
  summary.appendChild(el('span', { class: 'json-collapsed', text: isArray ? `Array(${keys.length}) ` : '{ ' }));
  summary.appendChild(
    el('span', {
      class: 'json-collapsed',
      text: keys.length ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') : '',
    }),
  );
  if (!isArray) summary.appendChild(el('span', { class: 'json-collapsed', text: ' }' }));
  details.appendChild(summary);

  const MAX = 200;
  for (const key of keys.slice(0, MAX)) {
    const row = el('div', { class: 'json-child' });
    if (!isArray) row.appendChild(el('span', { class: 'json-key', text: `${key}: ` }));
    row.appendChild(jsonNode(value[key], depth + 1));
    details.appendChild(row);
  }
  if (keys.length > MAX) {
    details.appendChild(el('div', { class: 'json-child json-collapsed', text: `… ${keys.length - MAX} more` }));
  }
  return details;
}

// -------------------------------------------------------------- image view

function renderImage(content, payload) {
  const wrap = el('div', { class: 'image-wrap' });
  wrap.appendChild(el('img', { src: content.url, alt: payload.title, loading: 'lazy' }));
  const meta = [];
  if (payload.meta && payload.meta.imageWidth) meta.push(`${payload.meta.imageWidth} × ${payload.meta.imageHeight}`);
  if (payload.meta && payload.meta.size != null) meta.push(fmtBytes(payload.meta.size));
  if (payload.path) meta.push(payload.path);
  wrap.appendChild(el('div', { class: 'image-meta', text: meta.join(' · ') }));
  return wrap;
}

// --------------------------------------------------------------- file view

function renderFile(content) {
  const wrap = el('div', { class: 'prose' });
  if (content.note) {
    wrap.appendChild(el('p', { class: 'notice', text: content.note }));
    return wrap;
  }
  if (content.isBinary) {
    wrap.appendChild(el('p', { class: 'notice', text: 'Binary file — no text preview available.' }));
    return wrap;
  }
  if (content.text != null && content.text !== '') {
    wrap.appendChild(el('pre', { class: 'raw', text: content.text }));
    if (content.truncated) wrap.appendChild(el('p', { class: 'notice', text: 'Preview truncated.' }));
  } else {
    wrap.appendChild(el('p', { class: 'empty', text: 'Empty file.' }));
  }
  return wrap;
}

// -------------------------------------------------------------- relations

function renderRelations(payload) {
  const relations = payload.relations;
  if (!relations || relations.length === 0) return null;
  const box = el('div', { class: 'relations' }, [el('h2', { class: 'section-title', text: 'Related' })]);
  const list = el('ul', { class: 'block-list' });
  for (const relation of relations) {
    list.appendChild(
      el('li', { class: 'block-list-item' }, [
        el('a', { class: 'block-list-title link', href: hrefFor('artifact', relation.target), text: shortPath(relation.target) }),
        el('span', { class: 'relation-kind', text: relation.kind }),
        relation.note ? el('span', { class: 'muted', text: relation.note }) : null,
      ]),
    );
  }
  box.appendChild(list);
  return box;
}
