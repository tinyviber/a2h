import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanResult } from '../types';
import { MANIFEST_DIR } from '../semantics/load';

// `a2h init` scaffolds a producer manifest from what the scanner already sees.
//
// The point is not to guess semantics for the producer — it is to remove every
// excuse for not writing them: the file is valid, complete, and immediately
// reflects the real workspace, so an agent only has to fill in meaning.

export interface InitResult {
  path: string;
  created: boolean;
  reason?: string;
}

export function writeStarterManifest(scan: ScanResult, force = false): InitResult {
  const dir = join(scan.rootDir, MANIFEST_DIR);
  const file = join(dir, 'manifest.json');

  if (existsSync(file) && !force) {
    return { path: file, created: false, reason: 'already exists' };
  }

  const manifest = buildStarter(scan);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { path: file, created: true };
}

function buildStarter(scan: ScanResult): Record<string, unknown> {
  // Surface the workspace's real top-level shape as groups, so the producer
  // starts from a correct skeleton rather than a blank file.
  const dirs = new Map<string, number>();
  for (const f of scan.files) {
    const top = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '';
    const key = top || '(root)';
    dirs.set(key, (dirs.get(key) ?? 0) + 1);
  }

  const groups = [...dirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id], i) => ({
      id: slug(id),
      title: prettify(id),
      order: i,
    }));

  const items = scan.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 200)
    .map((f) => ({
      path: f.path,
      role: f.kind === 'markdown' ? 'markdown' : f.kind,
      group: slug(f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '(root)'),
      // No empty placeholders: a scaffold full of `[]` reads as noise and
      // hides the fields that actually need a decision.
    }));

  return {
    a2h: 1,
    name: scan.identity.name,
    // Omitted rather than written as "" when the workspace has no summary.
    ...(scan.identity.summary ? { summary: scan.identity.summary } : {}),
    groups,
    tasks: [],
    actions: [],
    items,
    panels: [],
  };
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'root'
  );
}

function prettify(s: string): string {
  if (s === '(root)') return 'Root';
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
