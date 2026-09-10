// Sidebar navigation. The nav mirrors the same information architecture the
// presentation layer produced: tasks first (they are what a human acts on),
// then the producer's groups, then inferred sections.

import { el } from './dom.js';
import { statusTone, statusLabel } from './format.js';
import { hrefFor } from './router.js';

export function renderNav(nav, data) {
  nav.textContent = '';

  nav.appendChild(navLink('Overview', '#/', 'nav-overview'));

  if (data.tasks.length > 0) {
    const group = el('div', { class: 'nav-section' });
    group.appendChild(navLink('Tasks', '#/tasks', 'nav-section-title-link'));
    const list = el('div', { class: 'nav-artifacts' });
    for (const task of data.tasks) {
      const link = navLink(task.title, hrefFor('task', task.id), 'nav-artifact', task.summary);
      link.prepend(
        el('span', { class: `nav-dot tone-${statusTone(task.status)}`, title: statusLabel(task.status) }),
      );
      if (task.runs.length) link.appendChild(el('span', { class: 'nav-count', text: String(task.runs.length) }));
      list.appendChild(link);
    }
    group.appendChild(list);
    nav.appendChild(group);
  }

  if (data.runs.length > 0 || data.actions.length > 0) {
    const group = el('div', { class: 'nav-section' });
    if (data.runs.length > 0) group.appendChild(navLink('Runs', '#/runs', 'nav-section-title-link'));
    if (data.actions.length > 0) {
      const link = navLink('Actions', '#/actions', 'nav-section-title-link');
      link.appendChild(el('span', { class: 'nav-count', text: String(data.actions.length) }));
      group.appendChild(link);
    }
    nav.appendChild(group);
  }

  for (const section of data.sections) {
    const group = el('div', { class: 'nav-section' });
    // No "declared" flag here: it repeated on every producer section, crowded
    // the labels into an ellipsis, and the section page already says it once.
    group.appendChild(navLink(section.title, hrefFor('section', section.id), 'nav-section-title-link'));

    const list = el('div', { class: 'nav-artifacts' });
    for (const artifact of section.artifacts) {
      list.appendChild(
        navLink(artifact.title, hrefFor('artifact', artifact.id), 'nav-artifact', artifact.path || artifact.title),
      );
    }
    group.appendChild(list);
    nav.appendChild(group);
  }
}

function navLink(label, href, className, title) {
  return el('a', {
    class: `nav-item ${className || ''}`.trim(),
    href,
    title: title || label,
    text: label,
  });
}

export function highlightNav(nav, hash) {
  const current = hash || '#/';
  for (const link of nav.querySelectorAll('.nav-item')) {
    link.classList.toggle('is-active', link.getAttribute('href') === current);
  }
}

export function renderFoot(foot, data) {
  const lines = [];
  if (data.git && data.git.branch) lines.push(`branch ${data.git.branch}`);
  lines.push(`${data.stats.files} file${data.stats.files === 1 ? '' : 's'}`);
  if (data.semantics !== 'inferred') lines.push(`semantics: ${data.semantics}`);
  foot.textContent = lines.join(' · ');
}
