// Reusable surfaces: artifact cards, task cards, section headings.
// All of them are quiet containers — one card is one reading unit.

import { el } from './dom.js';
import { fmtBytes, fmtStamp, kindLabel, relTime, statusLabel, statusTone, fmtDuration } from './format.js';
import { statusPill, tagRow } from './blocks.js';
import { hrefFor } from './router.js';
import { renderActions } from './actions.js';

export function artifactCard(view) {
  const card = el('a', { class: 'card', href: hrefFor('artifact', view.id) });
  card.appendChild(el('div', { class: 'card-kind', text: kindLabel(view.kind) }));
  if (view.tags && view.tags.length) card.appendChild(tagRow(view.tags));
  card.appendChild(el('h3', { class: 'card-title', text: view.title }));
  if (view.summary) card.appendChild(el('p', { class: 'card-summary', text: view.summary }));
  const foot = el('div', { class: 'card-foot' });
  if (view.meta && view.meta.size != null) foot.appendChild(el('span', { text: fmtBytes(view.meta.size) }));
  if (view.meta && view.meta.mtimeMs) foot.appendChild(el('span', { text: relTime(view.meta.mtimeMs) }));
  if (foot.childNodes.length) card.appendChild(foot);
  return card;
}

export function cardGrid(views) {
  const grid = el('div', { class: 'card-grid' });
  for (const view of views) grid.appendChild(artifactCard(view));
  return grid;
}

export function sectionHead(title, count, options = {}) {
  const head = el('div', { class: 'section-head' }, [
    el('h2', { class: 'section-title', text: title }),
  ]);
  if (count != null) {
    head.appendChild(el('span', { class: 'section-count', text: `${count} item${count === 1 ? '' : 's'}` }));
  }
  if (options.explicit) {
    head.appendChild(el('span', { class: 'section-flag', text: 'declared' }));
  }
  return head;
}

/**
 * A task is the biggest unit a human judges. The card leads with state and the
 * single most recent run, because that is what "should I look at this?" needs.
 */
export function taskCard(task, options = {}) {
  const card = el('a', { class: 'card card-task', href: hrefFor('task', task.id) });
  const head = el('div', { class: 'task-head' }, [
    el('h3', { class: 'card-title', text: task.title }),
    statusPill(task.status),
  ]);
  card.appendChild(head);
  if (task.summary) card.appendChild(el('p', { class: 'card-summary', text: task.summary }));

  if (task.progress && task.progress.total > 0) {
    card.appendChild(progressBar(task.progress));
  }

  if (task.metrics && task.metrics.length) {
    const row = el('div', { class: 'card-metrics' });
    for (const metric of task.metrics.slice(0, 3)) {
      row.appendChild(
        el('span', { class: 'card-metric' }, [
          el('span', { class: 'card-metric-value', text: String(metric.value) + (metric.unit ? metric.unit : '') }),
          el('span', { class: 'card-metric-label', text: metric.label }),
        ]),
      );
    }
    card.appendChild(row);
  }

  const latest = task.runs && task.runs[0];
  if (latest) {
    card.appendChild(
      el('div', { class: 'card-run' }, [
        el('span', { class: 'card-run-dot ' + `tone-${statusTone(latest.status)}` }),
        el('span', { text: `Last run: ${latest.title}` }),
        latest.startedAt ? el('span', { class: 'muted', text: fmtStamp(latest.startedAt) }) : null,
      ]),
    );
  }

  const foot = el('div', { class: 'card-foot' });
  if (task.artifacts.length) foot.appendChild(el('span', { text: `${task.artifacts.length} artifact${task.artifacts.length === 1 ? '' : 's'}` }));
  if (task.runs.length) foot.appendChild(el('span', { text: `${task.runs.length} run${task.runs.length === 1 ? '' : 's'}` }));
  if (task.owner) foot.appendChild(el('span', { text: task.owner }));
  if (foot.childNodes.length) card.appendChild(foot);
  return card;
}

export function progressBar(progress) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return el('div', { class: 'progress' }, [
    el('div', { class: 'progress-track' }, [
      el('div', { class: 'progress-fill', style: `width:${Math.max(0, Math.min(100, pct))}%` }),
    ]),
    el('span', {
      class: 'progress-label',
      text: `${progress.label ? progress.label + ' ' : ''}${progress.done}/${progress.total}`,
    }),
  ]);
}

export function runRow(run, options = {}) {
  const wrap = el('div', { class: 'run' });
  const head = el('div', { class: 'run-head' }, [
    el('span', { class: 'run-title', text: run.title }),
    statusPill(run.status),
  ]);
  if (run.durationMs != null) head.appendChild(el('span', { class: 'muted', text: fmtDuration(run.durationMs) }));
  if (run.startedAt) head.appendChild(el('span', { class: 'muted', text: fmtStamp(run.startedAt) }));
  if (run.simulated) head.appendChild(el('span', { class: 'run-sim', text: 'simulated' }));
  wrap.appendChild(head);

  if (run.summary) wrap.appendChild(el('p', { class: 'run-summary', text: run.summary }));

  if (run.steps && run.steps.length) {
    const list = el('ol', { class: 'steps' });
    for (const step of run.steps) {
      list.appendChild(
        el('li', { class: 'step' }, [
          el('span', { class: `step-dot tone-${statusTone(step.status)}` }),
          el('span', { class: 'step-title', text: step.title }),
          el('span', { class: 'step-status', text: statusLabel(step.status) }),
          step.detail ? el('span', { class: 'step-detail', text: step.detail }) : null,
        ]),
      );
    }
    wrap.appendChild(list);
  }
  return wrap;
}

export function taskActions(task) {
  if (!task.actions || task.actions.length === 0) return null;
  return renderActions(task.actions.map((a) => a.id));
}
