import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { normalizeRel } from '../util/path';

// Path containment primitives. These are pure predicates over the filesystem —
// they read metadata only, never content.
//
// They live outside `server/` because containment is not an HTTP concern: a
// workspace-relative path can arrive from a URL, from a manifest, or from a
// block, and every one of those routes has to answer the same question.

export function isWithin(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/**
 * Resolves a workspace-relative POSIX path to an absolute path strictly
 * inside the workspace root. Returns null on traversal attempts.
 *
 * This is a lexical check: it refuses `..`, but says nothing about symlinks.
 * Use `resolveRealPath` when the answer must survive a link in the tree.
 */
export function resolveRelPath(root: string, rel: string): string | null {
  const normalized = normalizeRel(rel);
  if (normalized === null) return null;
  const abs = resolve(root, normalized);
  if (!isWithin(root, abs)) return null;
  return abs;
}

/**
 * Like resolveRelPath, but also resolves symlinks and verifies the *real* path
 * stays inside the workspace. This is the check that catches an intermediate
 * directory which is a link out of the tree — `leak -> /etc` makes
 * `leak/passwd` lexical, but never contained.
 *
 * Returns the lexical absolute path (stable, knows no symlinks) on success.
 */
export function resolveRealPath(root: string, rel: string): string | null {
  const abs = resolveRelPath(root, rel);
  if (abs === null) return null;
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(abs);
    if (!isWithin(realRoot, real)) return null;
    return abs;
  } catch {
    return null;
  }
}
