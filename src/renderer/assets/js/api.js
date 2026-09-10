// Server communication. The viewer talks to exactly four endpoints; keeping
// them in one file makes the surface easy to audit.

let presentationPromise = null;

export function loadPresentation(force) {
  if (!force && presentationPromise) return presentationPromise;
  presentationPromise = fetchJson('/api/presentation');
  return presentationPromise;
}

export function invalidate() {
  presentationPromise = null;
}

export function loadArtifact(path, mode) {
  const suffix = mode === 'full' ? '&mode=full' : '';
  return fetchJson(`/api/artifact?path=${encodeURIComponent(path)}${suffix}`);
}

/**
 * Executes a declared action. The server owns the allowlist and the
 * confirmation boundary; this function only carries the request.
 */
export async function executeAction(payload) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, error: 'bad_response', message: 'The server returned an unreadable response.' };
  }
  return body;
}

/** Subscribes to workspace change / action events. Returns a close function. */
export function openEvents(handlers) {
  let source;
  try {
    source = new EventSource('/api/events');
  } catch {
    return () => {};
  }
  source.addEventListener('change', () => handlers.onChange && handlers.onChange());
  source.addEventListener('action', () => handlers.onAction && handlers.onAction());
  source.onerror = () => {
    /* EventSource reconnects on its own. */
  };
  return () => source.close();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const error = new Error(`${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
