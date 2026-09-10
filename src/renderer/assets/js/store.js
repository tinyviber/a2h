// Application state. Small on purpose: one presentation payload, plus the
// transient state of actions the human just triggered.

import { subscribe as on, emit } from './bus.js';

const state = {
  data: null,
  /** actionId -> last ActionResult */
  actionResults: new Map(),
  /** actionIds currently in flight */
  pending: new Set(),
};

export function getData() {
  return state.data;
}

export function setData(data) {
  state.data = data;
  emit('data');
}

export function getPresentation() {
  return fetchPresentationData();
}

export function getActionResult(id) {
  return state.actionResults.get(id) || null;
}

export function setActionResult(id, result) {
  state.actionResults.set(id, result);
  emit('action');
}

export function isPending(id) {
  return state.pending.has(id);
}

export function setPending(id, value) {
  if (value) state.pending.add(id);
  else state.pending.delete(id);
  emit('action');
}

export function findTask(id) {
  if (!state.data) return null;
  return state.data.tasks.find((t) => t.id === id) || null;
}

export function findAction(id) {
  if (!state.data) return null;
  return state.data.actions.find((a) => a.id === id) || null;
}

export function findArtifact(path) {
  if (!state.data) return null;
  for (const section of state.data.sections) {
    for (const a of section.artifacts) if (a.id === path) return a;
  }
  return null;
}

export function artifactViews() {
  if (!state.data) return [];
  return state.data.sections.flatMap((s) => s.artifacts);
}

export { on as subscribe, emit };
