// Minimal event bus, so views never import each other.

const listeners = new Map();

export function subscribe(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler();
    } catch (err) {
      console.error(`a2h: listener for "${event}" failed`, err);
    }
  }
}
