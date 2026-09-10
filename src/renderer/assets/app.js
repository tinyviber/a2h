(function () {
  'use strict';

  var state = { data: null };

  var KIND_LABEL = {
    readme: 'Overview',
    report: 'Report',
    markdown: 'Note',
    code: 'Code',
    json: 'Data',
    log: 'Log',
    diff: 'Diff',
    image: 'Image',
    file: 'File',
  };

  var CODE_PREVIEW = 600;
  var DIFF_PREVIEW = 500;

  // ------------------------------------------------------------------ utils
  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function relTime(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms;
    if (diff < 0) diff = 0;
    if (diff < 60 * 1000) return 'just now';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 24 * 3600 * 1000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 7 * 24 * 3600 * 1000) return Math.floor(diff / (24 * 3600000)) + 'd ago';
    return new Date(ms).toLocaleDateString();
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ------------------------------------------------------------- data load
  function loadData() {
    return fetch('/api/ir')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.data = d;
        renderNav();
        renderFoot();
      });
  }

  // ------------------------------------------------------------------- nav
  function renderNav() {
    var nav = $('#nav');
    nav.innerHTML = '';
    var d = state.data;

    nav.appendChild(el('a', { class: 'nav-item nav-overview', href: '#/' }, ['Overview']));

    d.sections.forEach(function (section) {
      var group = el('div', { class: 'nav-section' });
      group.appendChild(el('a', {
        class: 'nav-section-title-link nav-item',
        href: '#/s/' + section.id,
        text: section.title,
      }));
      var list = el('div', { class: 'nav-artifacts' });
      section.artifacts.forEach(function (a) {
        list.appendChild(el('a', {
          class: 'nav-item nav-artifact',
          href: '#/a/' + encodeURIComponent(a.id),
          title: a.path || a.title,
        }, [a.title]));
      });
      group.appendChild(list);
      nav.appendChild(group);
    });
    highlightNav();
  }

  function highlightNav() {
    var hash = location.hash || '#/';
    var links = document.querySelectorAll('.nav-item');
    Array.prototype.forEach.call(links, function (l) {
      var active = l.getAttribute('href') === hash;
      l.classList.toggle('is-active', active);
    });
  }

  function renderFoot() {
    var d = state.data;
    var foot = $('#sidebarFoot');
    var lines = [];
    if (d.git && d.git.branch) lines.push('branch ' + d.git.branch);
    lines.push(d.stats.files + ' file' + (d.stats.files === 1 ? '' : 's'));
    lines.push(fmtBytes(d.stats.bytes));
    foot.textContent = lines.join(' · ');
  }

  // ------------------------------------------------------------------ route
  function route() {
    var hash = location.hash || '#/';
    var body = hash.replace(/^#\//, '');
    var slash = body.indexOf('/');
    var kind = slash >= 0 ? body.slice(0, slash) : body;
    var arg = slash >= 0 ? body.slice(slash + 1) : '';

    closeDrawer();

    if (kind === 'a') {
      renderArtifact(decodeURIComponent(arg));
    } else if (kind === 's') {
      renderSection(arg);
    } else {
      renderOverview();
    }
    highlightNav();
    window.scrollTo(0, 0);
  }

  function setContent(node) {
    var content = $('#content');
    content.innerHTML = '';
    content.appendChild(node);
  }

  // --------------------------------------------------------------- overview
  function renderOverview() {
    var d = state.data;
    var wrap = el('div', {});
    wrap.appendChild(headerBlock(d));

    if (d.highlights && d.highlights.length) {
      wrap.appendChild(el('h2', { class: 'section-title', text: 'Start here' }));
      wrap.appendChild(cardGrid(d.highlights));
      wrap.appendChild(el('div', { style: 'height:32px' }));
    }

    d.sections.forEach(function (section) {
      var head = el('div', { class: 'section-head' });
      head.appendChild(el('h2', { class: 'section-title', text: section.title }));
      head.appendChild(el('span', { class: 'section-count', text: section.artifacts.length + ' items' }));
      wrap.appendChild(head);
      if (section.description) {
        wrap.appendChild(el('p', { class: 'section-desc', text: section.description }));
      }
      wrap.appendChild(cardGrid(section.artifacts));
    });

    if (d.warnings && d.warnings.length) {
      wrap.appendChild(renderWarnings(d.warnings));
    }

    setContent(wrap);
  }

  function renderSection(id) {
    var d = state.data;
    var section = null;
    for (var i = 0; i < d.sections.length; i++) {
      if (d.sections[i].id === id) { section = d.sections[i]; break; }
    }
    var wrap = el('div', {});
    if (!section) {
      wrap.appendChild(el('div', { class: 'notice', text: 'Section not found.' }));
      setContent(wrap);
      return;
    }
    wrap.appendChild(el('button', { class: 'back-link', text: '← Overview', onclick: function () { location.hash = '#/'; } }));
    wrap.appendChild(el('h1', { class: 'artifact-title', text: section.title }));
    if (section.description) wrap.appendChild(el('p', { class: 'artifact-meta', text: section.description }));
    wrap.appendChild(el('div', { style: 'height:20px' }));
    wrap.appendChild(cardGrid(section.artifacts));
    setContent(wrap);
  }

  // ---------------------------------------------------------------- artifact
  function renderArtifact(path) {
    var content = $('#content');
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'placeholder', text: 'Loading…' }));

    fetch('/api/artifact?path=' + encodeURIComponent(path))
      .then(function (r) {
        if (!r.ok) throw new Error('artifact not found');
        return r.json();
      })
      .then(function (payload) {
        var wrap = el('div', {});
        wrap.appendChild(artifactHeader(payload));
        wrap.appendChild(renderBody(payload));
        setContent(wrap);
      })
      .catch(function () {
        setContent(el('div', { class: 'notice', text: 'Could not load this artifact.' }));
      });
  }

  function artifactHeader(payload) {
    var head = el('div', { class: 'artifact-head' });
    head.appendChild(el('button', { class: 'back-link', text: '← Overview', onclick: function () { location.hash = '#/'; } }));
    head.appendChild(el('h1', { class: 'artifact-title', text: payload.title }));
    if (payload.path) head.appendChild(el('p', { class: 'artifact-path', text: payload.path }));
    var meta = [];
    if (payload.kind) meta.push(KIND_LABEL[payload.kind] || payload.kind);
    if (payload.meta && payload.meta.size != null) meta.push(fmtBytes(payload.meta.size));
    if (payload.meta && payload.meta.mtimeMs) meta.push(relTime(payload.meta.mtimeMs));
    if (payload.meta && payload.meta.lineCount != null) meta.push(payload.meta.lineCount + ' lines');
    if (meta.length) head.appendChild(el('p', { class: 'artifact-meta', text: meta.join(' · ') }));
    if (payload.tags && payload.tags.length) {
      head.appendChild(tagRow(payload.tags));
    }
    return head;
  }

  function tagRow(tags) {
    var row = el('div', { class: 'card-tags' });
    tags.forEach(function (t) {
      row.appendChild(el('span', { class: 'tag tag-' + t.toLowerCase(), text: t }));
    });
    return row;
  }

  function renderBody(payload) {
    var box = el('div', { class: 'artifact-body' });
    var c = payload.content;

    switch (c.type) {
      case 'markdown': {
        var prose = el('div', { class: 'prose' });
        prose.innerHTML = c.html || '';
        box.appendChild(prose);
        break;
      }
      case 'code':
        box.appendChild(renderCode(c));
        break;
      case 'diff':
        box.appendChild(renderDiff(c));
        break;
      case 'json':
        box.appendChild(renderJson(c));
        break;
      case 'log':
        box.appendChild(renderLog(c, payload.path));
        break;
      case 'image':
        box.appendChild(renderImage(c, payload));
        break;
      case 'file':
        box.appendChild(renderFile(c));
        break;
      default:
        box.appendChild(el('div', { class: 'notice', text: 'Unsupported content type.' }));
    }
    return box;
  }

  // --------------------------------------------------------------- code view
  function renderCode(c) {
    var box = el('div', {});
    var bar = el('div', { class: 'bar' });
    bar.appendChild(el('span', { text: c.language || 'text' }));
    bar.appendChild(el('span', { text: c.totalLines + ' lines' }));
    if (c.truncated) bar.appendChild(el('span', { text: '· truncated', style: 'color:var(--partial)' }));
    box.appendChild(bar);

    var lines = c.raw ? c.raw.split('\n') : [];
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    var wrap = el('div', { class: 'code-wrap' });
    if (lines.length > CODE_PREVIEW) {
      wrap.appendChild(codeLines(lines.slice(0, CODE_PREVIEW), 0));
      wrap.appendChild(el('div', { class: 'bar' },
        [el('button', { class: 'btn', text: 'Show all ' + lines.length + ' lines', onclick: function () {
          box.replaceChild(codeLines(lines, 0), wrap);
        } })]));
    } else {
      wrap.appendChild(codeLines(lines, 0));
    }
    box.appendChild(wrap);
    return box;
  }

  function codeLines(lines, startNo) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var row = el('div', { class: 'code-line' });
      row.appendChild(el('span', { class: 'ln', text: String(startNo + i + 1) }));
      row.appendChild(el('span', { class: 'body', text: lines[i] }));
      frag.appendChild(row);
    }
    return frag;
  }

  // ---------------------------------------------------------------- diff view
  function renderDiff(c) {
    var box = el('div', {});
    var bar = el('div', { class: 'bar' });
    var files = c.files || [];
    bar.appendChild(el('span', { text: files.length + ' file' + (files.length === 1 ? '' : 's') }));
    if (c.truncated) bar.appendChild(el('span', { text: '· truncated', style: 'color:var(--partial)' }));
    box.appendChild(bar);

    var body = el('div', { class: 'diff-wrap' });
    var totalLines = 0;
    files.forEach(function (f) { f.hunks.forEach(function (h) { totalLines += h.lines.length; }); });

    if (totalLines > DIFF_PREVIEW) {
      body.appendChild(diffFiles(files, DIFF_PREVIEW));
      var bar2 = el('div', { class: 'bar' },
        [el('button', { class: 'btn', text: 'Show full diff (' + totalLines + ' lines)', onclick: function () {
          body.replaceChild(diffFiles(files, Infinity), body.firstChild);
          body.removeChild(bar2);
        } })]);
      box.appendChild(body);
      box.appendChild(bar2);
    } else {
      body.appendChild(diffFiles(files, Infinity));
      box.appendChild(body);
    }
    return box;
  }

  function diffFiles(files, budget) {
    var frag = document.createDocumentFragment();
    var remaining = budget;
    for (var i = 0; i < files.length && remaining > 0; i++) {
      var f = files[i];
      var fileBox = el('div', { class: 'diff-file' });
      var head = el('div', { class: 'diff-file-head' });
      head.appendChild(el('span', { class: 'path', text: f.path }));
      head.appendChild(el('span', { class: 'diff-status', text: f.status }));
      head.appendChild(el('span', { class: 'diff-stat add', text: '+' + f.added }));
      head.appendChild(el('span', { class: 'diff-stat del', text: '-' + f.removed }));
      fileBox.appendChild(head);

      for (var h = 0; h < f.hunks.length && remaining > 0; h++) {
        var hunk = f.hunks[h];
        fileBox.appendChild(el('div', { class: 'diff-hunk-header', text: hunk.header }));
        for (var l = 0; l < hunk.lines.length && remaining > 0; l++) {
          fileBox.appendChild(diffLineRow(hunk.lines[l]));
          remaining--;
        }
      }
      frag.appendChild(fileBox);
    }
    return frag;
  }

  function diffLineRow(line) {
    var cls = 'diff-line';
    if (line.type === 'add') cls += ' add';
    else if (line.type === 'del') cls += ' del';
    var row = el('div', { class: cls });
    row.appendChild(el('span', { class: 'ln old', text: line.oldNo != null ? String(line.oldNo) : '' }));
    row.appendChild(el('span', { class: 'ln new', text: line.newNo != null ? String(line.newNo) : '' }));
    row.appendChild(el('span', { class: 'body', text: line.text }));
    return row;
  }

  // ----------------------------------------------------------------- log view
  function renderLog(c, path) {
    var box = el('div', {});
    var head = el('div', { class: 'log-head' });
    head.appendChild(el('span', { text: c.totalLines + ' lines total' }));
    if (c.hasErrors) head.appendChild(el('span', { class: 'log-flag error', text: 'errors' }));
    if (c.hasWarnings) head.appendChild(el('span', { class: 'log-flag warn', text: 'warnings' }));
    var btn = el('button', { class: 'btn', text: 'Show full log', onclick: function () { loadFullLog(box, path, head); } });
    head.appendChild(btn);
    box.appendChild(head);

    var wrap = el('div', { class: 'log-wrap' });
    wrap.appendChild(logLines(c.tail, c.totalLines - c.tail.length, c.errorLines));
    box.appendChild(wrap);
    return box;
  }

  function loadFullLog(box, path, head) {
    fetch('/api/artifact?path=' + encodeURIComponent(path) + '&mode=full')
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var c = p.content;
        var wrap = el('div', { class: 'log-wrap' });
        wrap.appendChild(logLines(c.tail, 0, c.errorLines));
        var oldWrap = box.querySelector('.log-wrap');
        box.replaceChild(wrap, oldWrap);
        head.removeChild(head.querySelector('.btn'));
        if (c.truncated) head.appendChild(el('span', { class: 'log-flag warn', text: 'truncated' }));
      });
  }

  function logLines(lines, startNo, errorLines) {
    var errorSet = {};
    (errorLines || []).forEach(function (n) { errorSet[n] = true; });
    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var lineNo = startNo + i;
      var cls = 'log-line';
      if (errorSet[lineNo]) cls += ' is-error';
      var row = el('div', { class: cls });
      row.appendChild(el('span', { class: 'ln', text: String(lineNo + 1) }));
      row.appendChild(el('span', { class: 'body', text: lines[i] }));
      frag.appendChild(row);
    }
    return frag;
  }

  // ----------------------------------------------------------------- json view
  function renderJson(c) {
    var box = el('div', {});
    var bar = el('div', { class: 'bar' });
    bar.appendChild(el('span', { text: c.valid ? 'valid JSON' : 'invalid JSON' }));
    if (c.truncated) bar.appendChild(el('span', { text: '· truncated', style: 'color:var(--partial)' }));
    var rawBtn = el('button', { class: 'btn', text: 'Raw', onclick: function () { toggleRaw(box, c.raw); } });
    bar.appendChild(rawBtn);
    box.appendChild(bar);

    var wrap = el('div', { class: 'json-wrap', 'data-view': 'tree' });
    if (c.valid) {
      wrap.appendChild(jsonNode(c.data, 0));
    } else {
      wrap.appendChild(el('pre', { class: 'raw', text: c.raw }));
    }
    box.appendChild(wrap);
    return box;
  }

  function toggleRaw(box, raw) {
    var wrap = box.querySelector('.json-wrap');
    if (wrap.getAttribute('data-view') === 'raw') {
      wrap.setAttribute('data-view', 'tree');
      wrap.innerHTML = '';
      // Re-render is not available here; simplest: reload the artifact.
      location.reload();
      return;
    }
    wrap.setAttribute('data-view', 'raw');
    wrap.innerHTML = '';
    wrap.appendChild(el('pre', { class: 'raw', text: raw }));
  }

  function jsonNode(value, depth) {
    if (depth > 12) return el('span', { class: 'json-collapsed', text: '…' });

    if (value === null) return el('span', { class: 'json-null', text: 'null' });
    var t = typeof value;
    if (t === 'string') return el('span', { class: 'json-str', text: '"' + value + '"' });
    if (t === 'number') return el('span', { class: 'json-num', text: String(value) });
    if (t === 'boolean') return el('span', { class: 'json-bool', text: String(value) });

    var isArray = Array.isArray(value);
    var keys = Object.keys(value);
    var preview = isArray ? '[ ]' : '{ }';

    var details = el('details', { class: 'json-row' });
    var summary = el('summary', {});
    summary.appendChild(el('span', { class: 'json-collapsed', text: isArray ? 'Array(' + keys.length + ') ' : '{ ' }));
    summary.appendChild(el('span', { class: 'json-collapsed', text: keys.length ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') : '' }));
    summary.appendChild(el('span', { class: 'json-collapsed', text: isArray ? '' : ' }' }));
    details.appendChild(summary);

    var MAX = 200;
    var shown = keys.slice(0, MAX);
    shown.forEach(function (k) {
      var row = el('div', { style: 'padding-left:20px' });
      if (!isArray) row.appendChild(el('span', { class: 'json-key', text: esc(k) + ': ' }));
      row.appendChild(jsonNode(value[k], depth + 1));
      details.appendChild(row);
    });
    if (keys.length > MAX) {
      details.appendChild(el('div', { class: 'json-collapsed', style: 'padding-left:20px', text: '… ' + (keys.length - MAX) + ' more' }));
    }
    return details;
  }

  // ---------------------------------------------------------------- image view
  function renderImage(c, payload) {
    var wrap = el('div', { class: 'image-wrap' });
    var img = el('img', { src: c.url, alt: payload.title, loading: 'lazy' });
    wrap.appendChild(img);
    var meta = [];
    if (payload.meta && payload.meta.imageWidth) meta.push(payload.meta.imageWidth + ' × ' + payload.meta.imageHeight);
    if (payload.meta && payload.meta.size != null) meta.push(fmtBytes(payload.meta.size));
    if (payload.path) meta.push(payload.path);
    wrap.appendChild(el('div', { class: 'image-meta', text: meta.join(' · ') }));
    return wrap;
  }

  // ----------------------------------------------------------------- file view
  function renderFile(c) {
    var wrap = el('div', { class: 'prose' });
    if (c.note) {
      wrap.appendChild(el('p', { class: 'notice', text: c.note }));
      return wrap;
    }
    if (c.isBinary) {
      wrap.appendChild(el('p', { class: 'notice', text: 'Binary file — no text preview available.' }));
      return wrap;
    }
    if (c.text != null && c.text !== '') {
      wrap.appendChild(el('pre', { class: 'raw', text: c.text }));
      if (c.truncated) wrap.appendChild(el('p', { class: 'notice', text: 'Preview truncated.' }));
    } else {
      wrap.appendChild(el('p', { class: 'empty', text: 'Empty file.' }));
    }
    return wrap;
  }

  // --------------------------------------------------------------- header / cards
  function headerBlock(d) {
    var head = el('header', { class: 'page-head' });
    head.appendChild(el('h1', { class: 'workspace-name', text: d.identity.name }));
    if (d.identity.summary) head.appendChild(el('p', { class: 'workspace-summary', text: d.identity.summary }));

    var meta = el('p', { class: 'meta-line' });
    if (d.git && d.git.isRepo && d.git.branch) {
      meta.appendChild(el('span', { text: 'branch ' + d.git.branch }));
    }
    if (d.git && d.git.lastCommit && d.git.lastCommit.hash) {
      if (meta.childNodes.length) meta.appendChild(el('span', { class: 'dot', text: '·' }));
      meta.appendChild(el('span', { text: d.git.lastCommit.hash + ' ' + d.git.lastCommit.subject }));
    }
    meta.appendChild(el('span', { class: 'dot', text: '·' }));
    meta.appendChild(el('span', { text: d.stats.files + ' files' }));
    meta.appendChild(el('span', { class: 'dot', text: '·' }));
    meta.appendChild(el('span', { text: fmtBytes(d.stats.bytes) }));
    head.appendChild(meta);
    return head;
  }

  function cardGrid(artifacts) {
    var grid = el('div', { class: 'card-grid' });
    artifacts.forEach(function (a) {
      grid.appendChild(card(a));
    });
    return grid;
  }

  function card(a) {
    var c = el('a', { class: 'card', href: '#/a/' + encodeURIComponent(a.id) });
    c.appendChild(el('div', { class: 'card-kind', text: KIND_LABEL[a.kind] || a.kind }));
    if (a.tags && a.tags.length) c.appendChild(tagRow(a.tags));
    c.appendChild(el('h3', { class: 'card-title', text: a.title }));
    if (a.summary) c.appendChild(el('p', { class: 'card-summary', text: a.summary }));
    var foot = el('div', { class: 'card-foot' });
    if (a.meta && a.meta.size != null) foot.appendChild(el('span', { text: fmtBytes(a.meta.size) }));
    if (a.meta && a.meta.mtimeMs) foot.appendChild(el('span', { text: relTime(a.meta.mtimeMs) }));
    c.appendChild(foot);
    return c;
  }

  function renderWarnings(warnings) {
    var box = el('div', { class: 'artifact-body' });
    var bar = el('div', { class: 'bar' });
    bar.appendChild(el('span', { text: warnings.length + ' scanner warning(s)' }));
    box.appendChild(bar);
    var list = el('div', { class: 'warning-list' });
    warnings.forEach(function (w) {
      list.appendChild(el('div', { text: w }));
    });
    box.appendChild(list);
    return box;
  }

  // ---------------------------------------------------------------- SSE / watch
  function connectEvents() {
    var es = new EventSource('/api/events');
    es.addEventListener('change', function () {
      loadData().then(function () {
        // Preserve current view; re-render with fresh data.
        route();
      });
    });
    es.onerror = function () {
      // EventSource auto-reconnects; nothing to do here.
    };
  }

  // ---------------------------------------------------------------- chrome
  function bindChrome() {
    var toggle = $('#navToggle');
    var sidebar = $('#sidebar');
    var scrim = $('#scrim');
    var brand = $('#brand');

    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      scrim.hidden = !open;
    });
    scrim.addEventListener('click', closeDrawer);
    brand.addEventListener('click', function (e) {
      // allow default hash navigation
    });
  }

  function closeDrawer() {
    var sidebar = $('#sidebar');
    var scrim = $('#scrim');
    sidebar.classList.remove('open');
    $('#navToggle').setAttribute('aria-expanded', 'false');
    scrim.hidden = true;
  }

  // ------------------------------------------------------------------- start
  document.addEventListener('DOMContentLoaded', function () {
    bindChrome();
    loadData().then(function () {
      window.addEventListener('hashchange', route);
      connectEvents();
      route();
    });
  });
})();
