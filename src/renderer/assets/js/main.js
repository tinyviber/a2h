// Entry point: boot the viewer, own the chrome, dispatch routes.
//
// Note there is no bundler and no framework here on purpose — A2H ships as a
// local CLI, so the viewer is plain ES modules served from disk. Extensibility
// comes from the block registry, not from a build step.

import { el, byId } from './dom.js';
import { loadPresentation, invalidate, openEvents } from './api.js';
import { getData, setData, subscribe } from './store.js';
import { parseHash } from './router.js';
import { renderNav, highlightNav, renderFoot } from './nav.js';
import {
  overviewView,
  sectionView,
  tasksView,
  taskView,
  runsView,
  actionsView,
  artifactContainer,
} from './views.js';

const nav = byId('nav');
const content = byId('content');
const foot = byId('sidebarFoot');

async function refresh() {
  invalidate();
  try {
    const data = await loadPresentation(true);
    setData(data);
    renderNav(nav, data);
    renderFoot(foot, data);
    route();
  } catch (err) {
    content.textContent = '';
    content.appendChild(
      el('div', { class: 'notice', text: `Could not load the workspace: ${err.message}` }),
    );
  }
}

function route() {
  const data = getData();
  if (!data) return;
  const { name, arg } = parseHash(location.hash);

  let view;
  switch (name) {
    case 'section':
      view = sectionView(arg);
      break;
    case 'artifact':
      view = artifactContainer(arg);
      break;
    case 'tasks':
      view = tasksView();
      break;
    case 'task':
      view = taskView(arg);
      break;
    case 'runs':
      view = runsView();
      break;
    case 'actions':
      view = actionsView();
      break;
    default:
      view = overviewView();
  }

  content.textContent = '';
  content.appendChild(view);
  highlightNav(nav, location.hash || '#/');
  closeDrawer();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------- chrome

function closeDrawer() {
  const sidebar = byId('sidebar');
  const scrim = byId('scrim');
  const toggle = byId('navToggle');
  sidebar.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  scrim.hidden = true;
}

function bindChrome() {
  const toggle = byId('navToggle');
  const sidebar = byId('sidebar');
  const scrim = byId('scrim');

  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    scrim.hidden = !open;
  });
  scrim.addEventListener('click', closeDrawer);
}

// --------------------------------------------------------------------- boot

function boot() {
  bindChrome();

  window.addEventListener('hashchange', route);
  subscribe('refresh', () => {
    void refresh();
  });

  // Watch mode: the server pushes a change event after a rescan.
  openEvents({
    onChange: () => void refresh(),
    onAction: () => void refresh(),
  });

  void refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
