// Page-level views. Each returns a detached DOM subtree for #content.
//
// The visual language is fixed by design.md: warm, quiet, reading-first. Tasks
// and actions are added without turning the page into a dashboard — state is
// expressed in words first, colour second.

import { el, append, spacer } from './dom.js';
import { fmtBytes, fmtStamp, fmtDuration, statusLabel, statusTone, SOURCE_ORIGIN } from './format.js';
import { cardGrid, sectionHead, taskCard, runRow, progressBar } from './cards.js';
import { renderBlocks, statusPill } from './blocks.js';
import { renderActions, renderAudit } from './actions.js';
import { hrefFor } from './router.js';
import { renderArtifactView } from './artifacts.js';
import { loadArtifact } from './api.js';
import { getData, findTask } from './store.js';

/**
 * What to say about simulation, given that it is a per-action fact.
 *
 * A workspace may hand one action to a real provider and let the next one fall
 * through to the built-in simulator, so "everything here is simulated" would
 * be false in that case — and telling a human a simulated click is real is the
 * failure this whole path exists to prevent.
 */
function simulatedNotice(data) {
  const actions = data.actions || [];
  const simulated = actions.filter((a) => a.simulated).length;
  if (actions.length === 0 || simulated === 0) return '';
  if (simulated === actions.length) {
    return 'No external agent is connected. Every action here is simulated: it changes A2H state only, and says so when it runs.';
  }
  return `${simulated} of ${actions.length} actions fall through to the built-in simulator. Those are marked "simulated" where they appear; the rest run against a connected provider.`;
}

export function overviewView() {
  const data = getData();
  const wrap = el('div', {});
  wrap.appendChild(headerBlock(data));

  if (data.panels && data.panels.length) {
    const panels = el('section', { class: 'panel-region' });
    append(panels, renderBlocks(data.panels, ctx(), { card: true }));
    wrap.appendChild(panels);
    wrap.appendChild(spacer(32));
  }

  if (data.tasks.length > 0) {
    wrap.appendChild(sectionHead('Work in progress', data.tasks.length));
    wrap.appendChild(
      el('p', { class: 'section-desc', text: 'Tasks this workspace is tracking. Each one can be inspected and acted on.' }),
    );
    const grid = el('div', { class: 'card-grid' });
    for (const task of data.tasks) grid.appendChild(taskCard(task));
    wrap.appendChild(grid);
    wrap.appendChild(spacer(32));
  }

  if (data.highlights.length) {
    wrap.appendChild(sectionHead('Start here', null));
    wrap.appendChild(cardGrid(data.highlights));
    wrap.appendChild(spacer(32));
  }

  for (const section of data.sections) {
    wrap.appendChild(sectionHead(section.title, section.artifacts.length, { explicit: section.explicit }));
    if (section.description) wrap.appendChild(el('p', { class: 'section-desc', text: section.description }));
    wrap.appendChild(cardGrid(section.artifacts));
  }

  append(wrap, warningsView(data.warnings));
  return wrap;
}

export function sectionView(id) {
  const data = getData();
  const section = data.sections.find((s) => s.id === id);
  const wrap = el('div', {});
  wrap.appendChild(backLink('Overview'));

  if (!section) {
    wrap.appendChild(el('div', { class: 'notice', text: 'Section not found.' }));
    return wrap;
  }
  wrap.appendChild(el('h1', { class: 'artifact-title', text: section.title }));
  if (section.description) wrap.appendChild(el('p', { class: 'artifact-meta', text: section.description }));
  if (section.explicit) {
    wrap.appendChild(el('p', { class: 'artifact-meta', text: 'Declared by the workspace manifest.' }));
  }
  wrap.appendChild(spacer(16));
  wrap.appendChild(cardGrid(section.artifacts));
  return wrap;
}

export function tasksView() {
  const data = getData();
  const wrap = el('div', {});
  wrap.appendChild(backLink('Overview'));
  wrap.appendChild(el('h1', { class: 'artifact-title', text: 'Tasks' }));
  wrap.appendChild(
    el('p', { class: 'artifact-meta', text: `${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'} declared by this workspace.` }),
  );

  if (data.simulatedActions) {
    wrap.appendChild(
      el('div', { class: 'block-notice tone-info' }, [
        el('span', { class: 'notice-label', text: 'Note' }),
        el('span', { class: 'notice-body', text: simulatedNotice(data) }),
      ]),
    );
  }

  wrap.appendChild(spacer(16));
  const grid = el('div', { class: 'card-grid' });
  for (const task of data.tasks) grid.appendChild(taskCard(task));
  wrap.appendChild(grid);
  return wrap;
}

export function taskView(id) {
  const task = findTask(id);
  const wrap = el('div', {});
  wrap.appendChild(backLink('Tasks', hrefFor('tasks')));

  if (!task) {
    wrap.appendChild(el('div', { class: 'notice', text: 'Task not found.' }));
    return wrap;
  }

  // ---- head
  const head = el('div', { class: 'artifact-head' }, [
    el('div', { class: 'task-title-row' }, [
      el('h1', { class: 'artifact-title', text: task.title }),
      statusPill(task.status),
    ]),
  ]);
  if (task.summary) head.appendChild(el('p', { class: 'workspace-summary', text: task.summary }));

  const meta = [];
  if (task.owner) meta.push(task.owner);
  if (task.updatedAt) meta.push(`updated ${fmtStamp(task.updatedAt)}`);
  meta.push(`declared in ${SOURCE_ORIGIN[task.source] || task.source}`);
  head.appendChild(el('p', { class: 'artifact-meta', text: meta.join(' · ') }));
  wrap.appendChild(head);

  if (task.progress) wrap.appendChild(progressBar(task.progress));
  wrap.appendChild(spacer(16));

  if (task.actions.length) {
    const actions = renderActions(task.actions.map((a) => a.id));
    if (actions) {
      wrap.appendChild(el('section', { class: 'block-card' }, [
        el('h3', { class: 'block-title', text: 'What you can do' }),
        actions,
      ]));
      wrap.appendChild(spacer(24));
    }
  }

  if (task.metrics && task.metrics.length) {
    append(wrap, renderBlocks([{ type: 'metrics', items: task.metrics }], ctx(), { card: true }));
    wrap.appendChild(spacer(24));
  }

  if (task.blocks && task.blocks.length) {
    append(wrap, renderBlocks(task.blocks, ctx(), { card: true }));
    wrap.appendChild(spacer(24));
  }

  // ---- runs
  wrap.appendChild(sectionHead('Runs', task.runs.length));
  if (task.runs.length === 0) {
    wrap.appendChild(el('p', { class: 'empty', text: 'No runs recorded for this task yet.' }));
  } else {
    const list = el('div', { class: 'run-list' });
    for (const run of task.runs) list.appendChild(runCard(run));
    wrap.appendChild(list);
  }
  wrap.appendChild(spacer(24));

  // ---- artifacts
  wrap.appendChild(sectionHead('Artifacts', task.artifacts.length));
  const views = task.artifacts.map((p) => findArtifactView(p)).filter(Boolean);
  if (views.length === 0) {
    wrap.appendChild(el('p', { class: 'empty', text: 'No artifacts are attached to this task.' }));
  } else {
    wrap.appendChild(cardGrid(views));
  }

  return wrap;
}

export function runsView() {
  const data = getData();
  const wrap = el('div', {});
  wrap.appendChild(backLink('Overview'));
  wrap.appendChild(el('h1', { class: 'artifact-title', text: 'Runs' }));
  wrap.appendChild(
    el('p', { class: 'artifact-meta', text: `${data.runs.length} recorded run${data.runs.length === 1 ? '' : 's'}, newest first.` }),
  );
  wrap.appendChild(spacer(16));

  if (data.runs.length === 0) {
    wrap.appendChild(el('p', { class: 'empty', text: 'No runs have been recorded in this workspace.' }));
    return wrap;
  }
  const list = el('div', { class: 'run-list' });
  for (const run of data.runs) list.appendChild(runCard(run));
  wrap.appendChild(list);
  return wrap;
}

export function actionsView() {
  const data = getData();
  const wrap = el('div', {});
  wrap.appendChild(backLink('Overview'));
  wrap.appendChild(el('h1', { class: 'artifact-title', text: 'Actions' }));
  wrap.appendChild(
    el('p', { class: 'artifact-meta', text: 'Everything this workspace lets a human do, and what happened when it was tried.' }),
  );

  if (data.simulatedActions) {
    wrap.appendChild(
      el('div', { class: 'block-notice tone-info' }, [
        el('span', { class: 'notice-label', text: 'Note' }),
        el('span', { class: 'notice-body', text: simulatedNotice(data) }),
      ]),
    );
  }

  wrap.appendChild(spacer(16));

  if (data.actions.length === 0) {
    wrap.appendChild(
      el('p', { class: 'empty', text: 'This workspace declares no actions. Add an "actions" array to .a2h/manifest.json to give a human something to do.' }),
    );
    return wrap;
  }

  const byTask = new Map();
  for (const action of data.actions) {
    const key = action.taskId || '';
    if (!byTask.has(key)) byTask.set(key, []);
    byTask.get(key).push(action);
  }

  for (const [taskId, actions] of byTask) {
    const task = taskId ? findTask(taskId) : null;
    const card = el('section', { class: 'block-card' });
    card.appendChild(el('h3', { class: 'block-title', text: task ? task.title : 'Workspace' }));
    if (task) card.appendChild(el('p', { class: 'section-desc', text: `task ${task.id} · ${statusLabel(task.status)}` }));
    card.appendChild(renderActions(actions.map((a) => a.id)));
    wrap.appendChild(card);
    wrap.appendChild(spacer(16));
  }

  wrap.appendChild(sectionHead('Action audit', null));
  wrap.appendChild(
    el('p', { class: 'section-desc', text: 'This session, newest first, then the decisions recorded on disk under .a2h/decisions/.' }),
  );
  wrap.appendChild(
    el('p', { class: 'section-desc', text: 'A decision on disk is the record of what the human did; task status still comes from the manifest until a real provider writes it back.' }),
  );
  wrap.appendChild(el('div', { class: 'artifact-body' }, [renderAudit(data.audit)]));
  return wrap;
}

// ------------------------------------------------------------------ artifact

export function artifactContainer(path) {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'placeholder', text: 'Loading…' }));

  loadArtifact(path)
    .then((payload) => {
      wrap.textContent = '';
      wrap.appendChild(renderArtifactView(payload));
    })
    .catch(() => {
      wrap.textContent = '';
      wrap.appendChild(backLink('Overview'));
      wrap.appendChild(el('div', { class: 'notice', text: 'Could not load this artifact.' }));
    });

  return wrap;
}

// ------------------------------------------------------------------ helpers

export function ctx() {
  return { data: getData(), renderActions };
}

function runCard(run) {
  const card = el('div', { class: 'run-card' });
  card.appendChild(runRow(run));
  if (run.artifacts && run.artifacts.length) {
    const links = el('div', { class: 'run-artifacts' });
    for (const path of run.artifacts) {
      links.appendChild(el('a', { class: 'provenance-link', href: hrefFor('artifact', path), text: path }));
    }
    card.appendChild(links);
  }
  if (run.blocks && run.blocks.length) {
    append(card, renderBlocks(run.blocks, ctx(), { card: false }));
  }
  return card;
}

function findArtifactView(path) {
  const data = getData();
  for (const section of data.sections) {
    for (const artifact of section.artifacts) if (artifact.id === path) return artifact;
  }
  return null;
}

function headerBlock(data) {
  const head = el('header', { class: 'page-head' });
  head.appendChild(el('h1', { class: 'workspace-name', text: data.identity.name }));
  if (data.identity.summary) head.appendChild(el('p', { class: 'workspace-summary', text: data.identity.summary }));

  const meta = el('p', { class: 'meta-line' });
  const push = (text) => {
    if (meta.childNodes.length) meta.appendChild(el('span', { class: 'dot', text: '·' }));
    meta.appendChild(el('span', { text }));
  };
  if (data.git && data.git.branch) push(`branch ${data.git.branch}`);
  if (data.git && data.git.lastCommit && data.git.lastCommit.hash) {
    push(`${data.git.lastCommit.hash} ${data.git.lastCommit.subject}`);
  }
  push(`${data.stats.files} files`);
  push(fmtBytes(data.stats.bytes));
  if (data.semantics !== 'inferred') push(`semantics: ${data.semantics}`);
  head.appendChild(meta);
  return head;
}

export function backLink(label, href) {
  return el('button', {
    class: 'back-link',
    text: `← ${label}`,
    onclick: () => {
      location.hash = href || '#/';
    },
  });
}

function warningsView(warnings) {
  if (!warnings || warnings.length === 0) return null;
  const box = el('div', { class: 'artifact-body' }, [
    el('div', { class: 'bar' }, [el('span', { text: `${warnings.length} notice(s) from the scanner and manifest` })]),
  ]);
  const list = el('div', { class: 'warning-list' });
  for (const warning of warnings) list.appendChild(el('div', { text: warning }));
  box.appendChild(list);
  return box;
}

export { statusTone, fmtDuration };
