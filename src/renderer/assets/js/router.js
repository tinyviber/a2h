// Hash routing. Three shapes, all readable in a URL:
//
//   #/                 overview
//   #/s/:sectionId     a section
//   #/a/:artifactPath  an artifact (path is URL-encoded)
//   #/tasks #/t/:id    task list / a task
//   #/runs #/actions   runs / action surface

export function parseHash(hash) {
  const raw = (hash || '#/').replace(/^#\/?/, '');
  if (!raw) return { name: 'overview', arg: '' };

  const slash = raw.indexOf('/');
  const head = slash >= 0 ? raw.slice(0, slash) : raw;
  const tail = slash >= 0 ? raw.slice(slash + 1) : '';

  switch (head) {
    case 's':
      return { name: 'section', arg: decode(tail) };
    case 'a':
      return { name: 'artifact', arg: decode(tail) };
    case 'tasks':
      return { name: 'tasks', arg: '' };
    case 't':
      return { name: 'task', arg: decode(tail) };
    case 'runs':
      return { name: 'runs', arg: '' };
    case 'actions':
      return { name: 'actions', arg: '' };
    default:
      return { name: 'overview', arg: '' };
  }
}

export function hrefFor(name, arg) {
  switch (name) {
    case 'section':
      return `#/s/${encodeURIComponent(arg)}`;
    case 'artifact':
      return `#/a/${encodeURIComponent(arg)}`;
    case 'task':
      return `#/t/${encodeURIComponent(arg)}`;
    case 'tasks':
      return '#/tasks';
    case 'runs':
      return '#/runs';
    case 'actions':
      return '#/actions';
    default:
      return '#/';
  }
}

export function navigate(name, arg) {
  location.hash = hrefFor(name, arg);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
