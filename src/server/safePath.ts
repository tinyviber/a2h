import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { normalizeRel } from '../util/path';

// Route-safety helpers. All filesystem access driven by a URL is funnelled
// through here so path traversal and symlink escape are impossible.

export function isWithin(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/**
 * Resolves a workspace-relative POSIX path to an absolute path strictly
 * inside the workspace root. Returns null on traversal attempts.
 */
export function resolveRelPath(root: string, rel: string): string | null {
  const normalized = normalizeRel(rel);
  if (normalized === null) return null;
  const abs = resolve(root, normalized);
  if (!isWithin(root, abs)) return null;
  return abs;
}

/**
 * Like resolveRelPath, but also resolves symlinks and verifies the final real
 * path stays inside the workspace. Used when serving raw file bytes.
 * Returns the symlinked path (stable, relative to the workspace) on success.
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
