import type { ArtifactKind, FileEntry } from '../types';

// Heuristic scoring: turns a file into a presentation priority plus a few
// human tags. Deterministic — no model involved. The idea is to surface what
// a human should read *first* in a messy agent workspace.

const KIND_BASE: Record<ArtifactKind, number> = {
  readme: 1000,
  report: 500,
  diff: 450,
  markdown: 320,
  image: 260,
  log: 210,
  json: 190,
  code: 110,
  file: 60,
};

const HIGH_SIGNAL = [
  { re: /final/i, delta: 80 },
  { re: /latest/i, delta: 60 },
  { re: /summary/i, delta: 50 },
  { re: /report/i, delta: 40 },
  { re: /result/i, delta: 30 },
  { re: /conclusion/i, delta: 30 },
  { re: /decision/i, delta: 30 },
  { re: /answer/i, delta: 20 },
];

const LOW_SIGNAL = [
  { re: /(^|\/|[-_])tmp($|\/|[-_])/i, delta: -120 },
  { re: /(^|\/|[-_])scratch($|\/|[-_])/i, delta: -100 },
  { re: /draft/i, delta: -80 },
  { re: /wip/i, delta: -80 },
  { re: /backup/i, delta: -70 },
  { re: /\.bak/i, delta: -70 },
  { re: /old/i, delta: -50 },
  { re: /deprecated/i, delta: -50 },
];

export interface Score {
  priority: number;
  tags: string[];
}

export function scoreArtifact(kind: ArtifactKind, entry: FileEntry, nowMs: number): Score {
  let priority = KIND_BASE[kind];
  const tags: string[] = [];

  const name = entry.path.split('/').pop() ?? entry.path;
  const dirPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';

  for (const { re, delta } of HIGH_SIGNAL) {
    if (re.test(name)) priority += delta;
  }
  for (const { re, delta } of LOW_SIGNAL) {
    if (re.test(entry.path)) priority += delta;
  }

  // Directory conventions.
  if (/(^|\/)(outputs|reports|results|artifacts|deliverables|docs)(\/|$)/i.test(dirPath)) priority += 30;
  if (/(^|\/)(notes|radar|daily|summaries)(\/|$)/i.test(dirPath)) priority += 15;

  // Recency: what's new deserves a small lift.
  const ageMs = nowMs - entry.mtimeMs;
  if (ageMs >= 0) {
    if (ageMs < 24 * 3600 * 1000) priority += 25;
    else if (ageMs < 7 * 24 * 3600 * 1000) priority += 12;
  }

  // Tiny files are usually trivial.
  if (entry.size < 24) priority -= 8;

  // Tags.
  if (/final/i.test(name)) tags.push('final');
  if (/latest/i.test(name) || /-new/i.test(name)) tags.push('latest');
  if (/(backup|\.bak|old)/i.test(name)) tags.push('stale');
  if (/(draft|wip)/i.test(name)) tags.push('draft');
  if (/(^|\/|[-_])tmp($|\/|[-_])/i.test(entry.path)) tags.push('tmp');

  return { priority, tags };
}
